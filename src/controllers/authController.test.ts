/**
 * Unit tests for the signup function in authController.
 *
 * All dependencies are injected as plain objects — no vi.mock needed.
 * Tests cover the full signup flow: validation, consent checks,
 * email uniqueness, user creation, consent recording, audit logging,
 * and error responses.
 *
 * @module controllers/authController.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  signup,
  login,
  requestMagicLink,
  verifyMagicLink,
  requestPasswordReset,
  resetPassword,
  MAGIC_LINK_REQUEST_MESSAGE,
  EMAIL_SERVICE_UNAVAILABLE_MESSAGE,
  PASSWORD_RESET_EMAIL_UNAVAILABLE_MESSAGE,
} from './authController.js';
import type {
  SignupDependencies,
  LoginDependencies,
  MagicLinkDependencies,
  PasswordResetRequestDependencies,
  ResetPasswordDependencies,
  RequestContext,
} from './authController.js';
import type {
  SignupRequest,
  LoginRequest,
  MagicLinkRequest,
  MagicLinkVerifyRequest,
  PasswordResetRequest,
  ResetPasswordRequest,
  AuthResponse,
  GenericResponse,
  ErrorResponse,
  User,
  ConsentRecord,
  AuditLog,
  TokenPair,
  MagicTokenPayload,
  ResetTokenPayload,
} from '../types/index.js';
import { UserStatus, ConsentType, AuthEventType, AUTH_ERROR_CODES } from '../types/index.js';
import {
  LOGIN_FAILURE_MESSAGE,
  PASSWORD_RESET_REQUEST_MESSAGE,
} from '../utils/securityResponses.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const NOW = new Date('2024-06-01T12:00:00Z');

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-uuid-001',
    email: 'test@example.com',
    passwordHash: '$2b$12$hashedvalue',
    emailVerified: false,
    createdAt: NOW,
    updatedAt: NOW,
    lastLoginAt: null,
    status: UserStatus.ACTIVE,
    ...overrides,
  };
}

function fakeConsentRecord(overrides: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    id: 'consent-uuid-001',
    userId: 'user-uuid-001',
    consentType: ConsentType.TERMS_OF_SERVICE,
    consentVersion: '1.0',
    ipAddress: '127.0.0.1',
    userAgent: 'TestAgent/1.0',
    grantedAt: NOW,
    revokedAt: null,
    ...overrides,
  };
}

function fakeAuditLog(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: 'audit-uuid-001',
    eventType: AuthEventType.SIGNUP,
    userId: null,
    ipAddress: '127.0.0.1',
    userAgent: 'TestAgent/1.0',
    requestId: 'req-001',
    success: false,
    errorCode: null,
    metadata: {},
    createdAt: NOW,
    ...overrides,
  };
}

function validRequest(overrides: Partial<SignupRequest> = {}): SignupRequest {
  return {
    email: 'newuser@example.com',
    password: 'securePass1',
    consentToTerms: true,
    consentToPrivacy: true,
    ...overrides,
  };
}

const defaultContext: RequestContext = {
  ipAddress: '192.168.1.1',
  userAgent: 'Mozilla/5.0 TestBrowser',
};

function createDeps(overrides: Partial<SignupDependencies> = {}): SignupDependencies {
  return {
    emailValidator: {
      validateEmail: vi.fn().mockReturnValue({ valid: true, errors: [] }),
    },
    passwordValidator: {
      validatePassword: vi.fn().mockReturnValue({ valid: true, errors: [] }),
    },
    userRepository: {
      findByEmail: vi.fn().mockResolvedValue(null),
      createUser: vi.fn().mockResolvedValue(fakeUser()),
    },
    passwordService: {
      hashPassword: vi.fn().mockResolvedValue('$2b$12$hashedvalue'),
    },
    consentRepository: {
      createConsent: vi.fn().mockResolvedValue(fakeConsentRecord()),
    },
    auditRepository: {
      createAuditLog: vi.fn().mockResolvedValue(fakeAuditLog()),
    },
    ...overrides,
  };
}

function isErrorResponse(res: AuthResponse | ErrorResponse): res is ErrorResponse {
  return res.success === false && 'error' in res;
}

function isAuthResponse(res: AuthResponse | ErrorResponse): res is AuthResponse {
  return res.success === true && 'user' in res;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('signup', () => {
  // ── Successful signup ──────────────────────────────────────────────────

  describe('successful signup', () => {
    it('should return AuthResponse with user data on success', async () => {
      const deps = createDeps();
      const result = await signup(validRequest(), defaultContext, deps);

      expect(isAuthResponse(result)).toBe(true);
      if (!isAuthResponse(result)) return;

      expect(result.success).toBe(true);
      expect(result.user.id).toBe('user-uuid-001');
      expect(result.user.email).toBe('test@example.com');
      expect(result.user.emailVerified).toBe(false);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('should hash the password before creating the user', async () => {
      const deps = createDeps();
      await signup(validRequest({ password: 'myPassword1' }), defaultContext, deps);

      expect(deps.passwordService.hashPassword).toHaveBeenCalledWith('myPassword1');
      expect(deps.userRepository.createUser).toHaveBeenCalledWith(
        'newuser@example.com',
        '$2b$12$hashedvalue',
      );
    });

    it('should record three consent types on successful signup', async () => {
      const deps = createDeps();
      await signup(validRequest(), defaultContext, deps);

      expect(deps.consentRepository.createConsent).toHaveBeenCalledTimes(3);

      const calls = (deps.consentRepository.createConsent as ReturnType<typeof vi.fn>).mock.calls;
      const consentTypes = calls.map((c: unknown[]) => c[1]);

      expect(consentTypes).toContain(ConsentType.TERMS_OF_SERVICE);
      expect(consentTypes).toContain(ConsentType.PRIVACY_POLICY);
      expect(consentTypes).toContain(ConsentType.DATA_PROCESSING);

      // All consent calls should include IP and user agent
      for (const call of calls) {
        expect(call[3]).toBe(defaultContext.ipAddress);
        expect(call[4]).toBe(defaultContext.userAgent);
      }
    });

    it('should log a successful audit event', async () => {
      const deps = createDeps();
      await signup(validRequest(), defaultContext, deps);

      // The last audit call should be the success one
      const calls = (deps.auditRepository.createAuditLog as ReturnType<typeof vi.fn>).mock.calls;
      const successCall = calls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>).success === true,
      );

      expect(successCall).toBeDefined();
      const event = successCall![0] as Record<string, unknown>;
      expect(event.eventType).toBe(AuthEventType.SIGNUP);
      expect(event.userId).toBe('user-uuid-001');
      expect(event.ipAddress).toBe(defaultContext.ipAddress);
      expect(event.userAgent).toBe(defaultContext.userAgent);
    });

    it('should set expiresAt to approximately 15 minutes from now', async () => {
      const deps = createDeps();
      const before = Date.now();
      const result = await signup(validRequest(), defaultContext, deps);
      const after = Date.now();

      if (!isAuthResponse(result)) return;

      const fifteenMinMs = 15 * 60 * 1000;
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + fifteenMinMs);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + fifteenMinMs);
    });
  });

  // ── Email validation failure ───────────────────────────────────────────

  describe('email validation failure', () => {
    it('should return AUTH_INVALID_EMAIL when email is invalid', async () => {
      const deps = createDeps({
        emailValidator: {
          validateEmail: vi.fn().mockReturnValue({
            valid: false,
            errors: ['Invalid email format'],
          }),
        },
      });

      const result = await signup(validRequest({ email: 'not-an-email' }), defaultContext, deps);

      expect(isErrorResponse(result)).toBe(true);
      if (!isErrorResponse(result)) return;

      expect(result.error.code).toBe(AUTH_ERROR_CODES.INVALID_EMAIL);
      expect(result.error.fields?.email).toContain('Invalid email format');
    });

    it('should not create a user when email is invalid', async () => {
      const deps = createDeps({
        emailValidator: {
          validateEmail: vi.fn().mockReturnValue({
            valid: false,
            errors: ['Invalid email format'],
          }),
        },
      });

      await signup(validRequest({ email: 'bad' }), defaultContext, deps);

      expect(deps.userRepository.createUser).not.toHaveBeenCalled();
      expect(deps.passwordService.hashPassword).not.toHaveBeenCalled();
    });

    it('should log a failed audit event for invalid email', async () => {
      const deps = createDeps({
        emailValidator: {
          validateEmail: vi.fn().mockReturnValue({
            valid: false,
            errors: ['Invalid email format'],
          }),
        },
      });

      await signup(validRequest({ email: 'bad' }), defaultContext, deps);

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.SIGNUP,
          success: false,
          errorCode: AUTH_ERROR_CODES.INVALID_EMAIL,
        }),
      );
    });
  });

  // ── Password validation failure ────────────────────────────────────────

  describe('password validation failure', () => {
    it('should return AUTH_WEAK_PASSWORD when password is weak', async () => {
      const deps = createDeps({
        passwordValidator: {
          validatePassword: vi.fn().mockReturnValue({
            valid: false,
            errors: ['Password must be at least 8 characters'],
          }),
        },
      });

      const result = await signup(validRequest({ password: 'short' }), defaultContext, deps);

      expect(isErrorResponse(result)).toBe(true);
      if (!isErrorResponse(result)) return;

      expect(result.error.code).toBe(AUTH_ERROR_CODES.WEAK_PASSWORD);
      expect(result.error.fields?.password).toContain('Password must be at least 8 characters');
    });

    it('should not create a user when password is weak', async () => {
      const deps = createDeps({
        passwordValidator: {
          validatePassword: vi.fn().mockReturnValue({
            valid: false,
            errors: ['Password must contain at least 1 number'],
          }),
        },
      });

      await signup(validRequest({ password: 'nodigits!' }), defaultContext, deps);

      expect(deps.userRepository.createUser).not.toHaveBeenCalled();
    });
  });

  // ── Consent check failure ──────────────────────────────────────────────

  describe('consent check failure', () => {
    it('should return AUTH_CONSENT_REQUIRED when terms not accepted', async () => {
      const deps = createDeps();
      const result = await signup(validRequest({ consentToTerms: false }), defaultContext, deps);

      expect(isErrorResponse(result)).toBe(true);
      if (!isErrorResponse(result)) return;

      expect(result.error.code).toBe(AUTH_ERROR_CODES.CONSENT_REQUIRED);
    });

    it('should return AUTH_CONSENT_REQUIRED when privacy not accepted', async () => {
      const deps = createDeps();
      const result = await signup(validRequest({ consentToPrivacy: false }), defaultContext, deps);

      expect(isErrorResponse(result)).toBe(true);
      if (!isErrorResponse(result)) return;

      expect(result.error.code).toBe(AUTH_ERROR_CODES.CONSENT_REQUIRED);
    });

    it('should return AUTH_CONSENT_REQUIRED when both not accepted', async () => {
      const deps = createDeps();
      const result = await signup(
        validRequest({ consentToTerms: false, consentToPrivacy: false }),
        defaultContext,
        deps,
      );

      expect(isErrorResponse(result)).toBe(true);
      if (!isErrorResponse(result)) return;

      expect(result.error.code).toBe(AUTH_ERROR_CODES.CONSENT_REQUIRED);
    });

    it('should not create a user when consent is missing', async () => {
      const deps = createDeps();
      await signup(validRequest({ consentToTerms: false }), defaultContext, deps);

      expect(deps.userRepository.createUser).not.toHaveBeenCalled();
    });
  });

  // ── Email uniqueness failure ───────────────────────────────────────────

  describe('email uniqueness failure', () => {
    it('should return AUTH_EMAIL_EXISTS when email is taken', async () => {
      const deps = createDeps({
        userRepository: {
          findByEmail: vi.fn().mockResolvedValue(fakeUser()),
          createUser: vi.fn(),
        },
      });

      const result = await signup(validRequest(), defaultContext, deps);

      expect(isErrorResponse(result)).toBe(true);
      if (!isErrorResponse(result)) return;

      expect(result.error.code).toBe(AUTH_ERROR_CODES.EMAIL_EXISTS);
    });

    it('should not create a user when email already exists', async () => {
      const deps = createDeps({
        userRepository: {
          findByEmail: vi.fn().mockResolvedValue(fakeUser()),
          createUser: vi.fn(),
        },
      });

      await signup(validRequest(), defaultContext, deps);

      expect(deps.userRepository.createUser).not.toHaveBeenCalled();
    });

    it('should log a failed audit event for duplicate email', async () => {
      const deps = createDeps({
        userRepository: {
          findByEmail: vi.fn().mockResolvedValue(fakeUser()),
          createUser: vi.fn(),
        },
      });

      await signup(validRequest(), defaultContext, deps);

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorCode: AUTH_ERROR_CODES.EMAIL_EXISTS,
        }),
      );
    });
  });

  // ── Validation order ──────────────────────────────────────────────────

  describe('validation order', () => {
    it('should check email before password', async () => {
      const deps = createDeps({
        emailValidator: {
          validateEmail: vi.fn().mockReturnValue({
            valid: false,
            errors: ['Invalid email format'],
          }),
        },
        passwordValidator: {
          validatePassword: vi.fn().mockReturnValue({
            valid: false,
            errors: ['Password too short'],
          }),
        },
      });

      const result = await signup(
        validRequest({ email: 'bad', password: 'x' }),
        defaultContext,
        deps,
      );

      if (!isErrorResponse(result)) return;
      // Email error should be returned first
      expect(result.error.code).toBe(AUTH_ERROR_CODES.INVALID_EMAIL);
      // Password validator should not even be called
      expect(deps.passwordValidator.validatePassword).not.toHaveBeenCalled();
    });

    it('should check password before consent', async () => {
      const deps = createDeps({
        passwordValidator: {
          validatePassword: vi.fn().mockReturnValue({
            valid: false,
            errors: ['Password too short'],
          }),
        },
      });

      const result = await signup(
        validRequest({ password: 'x', consentToTerms: false }),
        defaultContext,
        deps,
      );

      if (!isErrorResponse(result)) return;
      expect(result.error.code).toBe(AUTH_ERROR_CODES.WEAK_PASSWORD);
    });

    it('should check consent before email uniqueness', async () => {
      const deps = createDeps({
        userRepository: {
          findByEmail: vi.fn().mockResolvedValue(fakeUser()),
          createUser: vi.fn(),
        },
      });

      const result = await signup(validRequest({ consentToTerms: false }), defaultContext, deps);

      if (!isErrorResponse(result)) return;
      expect(result.error.code).toBe(AUTH_ERROR_CODES.CONSENT_REQUIRED);
      // Should not even check email uniqueness
      expect(deps.userRepository.findByEmail).not.toHaveBeenCalled();
    });
  });

  // ── Response structure ─────────────────────────────────────────────────

  describe('response structure', () => {
    it('should include requestId in error responses', async () => {
      const deps = createDeps({
        emailValidator: {
          validateEmail: vi.fn().mockReturnValue({
            valid: false,
            errors: ['Invalid email format'],
          }),
        },
      });

      const result = await signup(validRequest({ email: 'bad' }), defaultContext, deps);

      if (!isErrorResponse(result)) return;
      expect(result.requestId).toBeDefined();
      expect(typeof result.requestId).toBe('string');
      expect(result.requestId.length).toBeGreaterThan(0);
    });

    it('should not include passwordHash in the user response', async () => {
      const deps = createDeps();
      const result = await signup(validRequest(), defaultContext, deps);

      if (!isAuthResponse(result)) return;
      // UserPublic should only have id, email, emailVerified
      expect(result.user).toEqual({
        id: 'user-uuid-001',
        email: 'test@example.com',
        emailVerified: false,
      });
      expect('passwordHash' in result.user).toBe(false);
    });
  });
});

// ─── Login Tests ─────────────────────────────────────────────────────────────

function fakeTokenPair(): TokenPair {
  return {
    accessToken: 'access-jwt-token',
    refreshToken: 'refresh-token-value',
    accessTokenExpiresAt: new Date('2024-06-01T12:15:00Z'),
    refreshTokenExpiresAt: new Date('2024-06-08T12:00:00Z'),
  };
}

function validLoginRequest(overrides: Partial<LoginRequest> = {}): LoginRequest {
  return {
    email: 'user@example.com',
    password: 'securePass1',
    deviceFingerprint: 'abc123fingerprint',
    ...overrides,
  };
}

function createLoginDeps(overrides: Partial<LoginDependencies> = {}): LoginDependencies {
  return {
    userRepository: {
      findByEmail: vi.fn().mockResolvedValue(fakeUser()),
      createUser: vi.fn(),
    },
    passwordService: {
      hashPassword: vi.fn().mockResolvedValue('$2b$12$hashedvalue'),
      verifyPassword: vi.fn().mockResolvedValue(true),
    },
    tokenService: {
      generateTokenPair: vi.fn().mockResolvedValue(fakeTokenPair()),
    },
    auditRepository: {
      createAuditLog: vi.fn().mockResolvedValue(fakeAuditLog()),
    },
    ...overrides,
  };
}

describe('login', () => {
  // ── Successful login ───────────────────────────────────────────────────

  describe('successful login', () => {
    it('should return AuthResponse with user data on valid credentials', async () => {
      const deps = createLoginDeps();
      const result = await login(validLoginRequest(), defaultContext, deps);

      expect(isAuthResponse(result)).toBe(true);
      if (!isAuthResponse(result)) return;

      expect(result.success).toBe(true);
      expect(result.user.id).toBe('user-uuid-001');
      expect(result.user.email).toBe('test@example.com');
      expect(result.user.emailVerified).toBe(false);
    });

    it('should use the token pair expiration as expiresAt', async () => {
      const deps = createLoginDeps();
      const result = await login(validLoginRequest(), defaultContext, deps);

      if (!isAuthResponse(result)) return;
      expect(result.expiresAt).toEqual(new Date('2024-06-01T12:15:00Z'));
    });

    it('should look up user by email', async () => {
      const deps = createLoginDeps();
      await login(validLoginRequest({ email: 'me@test.com' }), defaultContext, deps);

      expect(deps.userRepository.findByEmail).toHaveBeenCalledWith('me@test.com');
    });

    it('should verify password against stored hash', async () => {
      const deps = createLoginDeps();
      await login(validLoginRequest({ password: 'myPass99' }), defaultContext, deps);

      expect(deps.passwordService.verifyPassword).toHaveBeenCalledWith(
        'myPass99',
        '$2b$12$hashedvalue',
      );
    });

    it('should generate token pair with userId and deviceFingerprint', async () => {
      const deps = createLoginDeps();
      await login(validLoginRequest({ deviceFingerprint: 'device-fp-xyz' }), defaultContext, deps);

      expect(deps.tokenService.generateTokenPair).toHaveBeenCalledWith(
        'user-uuid-001',
        'device-fp-xyz',
      );
    });

    it('should log a successful audit event (Req 2.5)', async () => {
      const deps = createLoginDeps();
      await login(validLoginRequest({ deviceFingerprint: 'fp-123' }), defaultContext, deps);

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.LOGIN_PASSWORD,
          userId: 'user-uuid-001',
          ipAddress: defaultContext.ipAddress,
          userAgent: defaultContext.userAgent,
          success: true,
          metadata: { deviceFingerprint: 'fp-123' },
        }),
      );
    });

    it('should not include passwordHash in the user response', async () => {
      const deps = createLoginDeps();
      const result = await login(validLoginRequest(), defaultContext, deps);

      if (!isAuthResponse(result)) return;
      expect('passwordHash' in result.user).toBe(false);
    });
  });

  // ── User not found ─────────────────────────────────────────────────────

  describe('user not found', () => {
    it('should return uniform login failure when email does not exist (Req 2.4)', async () => {
      const deps = createLoginDeps({
        userRepository: {
          findByEmail: vi.fn().mockResolvedValue(null),
          createUser: vi.fn(),
        },
      });

      const result = await login(validLoginRequest(), defaultContext, deps);

      expect(isErrorResponse(result)).toBe(true);
      if (!isErrorResponse(result)) return;

      expect(result.error.code).toBe(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
      expect(result.error.message).toBe(LOGIN_FAILURE_MESSAGE);
    });

    it('should not attempt password verification when user not found', async () => {
      const deps = createLoginDeps({
        userRepository: {
          findByEmail: vi.fn().mockResolvedValue(null),
          createUser: vi.fn(),
        },
      });

      await login(validLoginRequest(), defaultContext, deps);

      expect(deps.passwordService.verifyPassword).not.toHaveBeenCalled();
    });

    it('should not generate tokens when user not found', async () => {
      const deps = createLoginDeps({
        userRepository: {
          findByEmail: vi.fn().mockResolvedValue(null),
          createUser: vi.fn(),
        },
      });

      await login(validLoginRequest(), defaultContext, deps);

      expect(deps.tokenService.generateTokenPair).not.toHaveBeenCalled();
    });

    it('should log a failed audit event for user not found', async () => {
      const deps = createLoginDeps({
        userRepository: {
          findByEmail: vi.fn().mockResolvedValue(null),
          createUser: vi.fn(),
        },
      });

      await login(validLoginRequest(), defaultContext, deps);

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.LOGIN_PASSWORD,
          userId: null,
          success: false,
          errorCode: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
        }),
      );
    });
  });

  // ── Wrong password ─────────────────────────────────────────────────────

  describe('wrong password', () => {
    it('should return uniform login failure when password is wrong (Req 2.4)', async () => {
      const deps = createLoginDeps({
        passwordService: {
          hashPassword: vi.fn(),
          verifyPassword: vi.fn().mockResolvedValue(false),
        },
      });

      const result = await login(validLoginRequest(), defaultContext, deps);

      expect(isErrorResponse(result)).toBe(true);
      if (!isErrorResponse(result)) return;

      expect(result.error.code).toBe(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
      expect(result.error.message).toBe(LOGIN_FAILURE_MESSAGE);
    });

    it('should return identical error for wrong password and non-existent email', async () => {
      // Wrong password case
      const wrongPwDeps = createLoginDeps({
        passwordService: {
          hashPassword: vi.fn(),
          verifyPassword: vi.fn().mockResolvedValue(false),
        },
      });
      const wrongPwResult = await login(validLoginRequest(), defaultContext, wrongPwDeps);

      // Non-existent email case
      const noUserDeps = createLoginDeps({
        userRepository: {
          findByEmail: vi.fn().mockResolvedValue(null),
          createUser: vi.fn(),
        },
      });
      const noUserResult = await login(validLoginRequest(), defaultContext, noUserDeps);

      // Both should be error responses with identical code and message
      expect(isErrorResponse(wrongPwResult)).toBe(true);
      expect(isErrorResponse(noUserResult)).toBe(true);
      if (!isErrorResponse(wrongPwResult) || !isErrorResponse(noUserResult)) return;

      expect(wrongPwResult.error.code).toBe(noUserResult.error.code);
      expect(wrongPwResult.error.message).toBe(noUserResult.error.message);
    });

    it('should not generate tokens when password is wrong', async () => {
      const deps = createLoginDeps({
        passwordService: {
          hashPassword: vi.fn(),
          verifyPassword: vi.fn().mockResolvedValue(false),
        },
      });

      await login(validLoginRequest(), defaultContext, deps);

      expect(deps.tokenService.generateTokenPair).not.toHaveBeenCalled();
    });

    it('should log a failed audit event for wrong password', async () => {
      const deps = createLoginDeps({
        passwordService: {
          hashPassword: vi.fn(),
          verifyPassword: vi.fn().mockResolvedValue(false),
        },
      });

      await login(validLoginRequest(), defaultContext, deps);

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.LOGIN_PASSWORD,
          userId: 'user-uuid-001',
          success: false,
          errorCode: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
        }),
      );
    });
  });

  // ── User with null passwordHash ────────────────────────────────────────

  describe('user with null passwordHash (magic-link-only)', () => {
    it('should pass empty string to verifyPassword when passwordHash is null', async () => {
      const deps = createLoginDeps({
        userRepository: {
          findByEmail: vi.fn().mockResolvedValue(fakeUser({ passwordHash: null })),
          createUser: vi.fn(),
        },
        passwordService: {
          hashPassword: vi.fn(),
          verifyPassword: vi.fn().mockResolvedValue(false),
        },
      });

      await login(validLoginRequest(), defaultContext, deps);

      expect(deps.passwordService.verifyPassword).toHaveBeenCalledWith('securePass1', '');
    });
  });

  // ── Response structure ─────────────────────────────────────────────────

  describe('response structure', () => {
    it('should include requestId in error responses', async () => {
      const deps = createLoginDeps({
        userRepository: {
          findByEmail: vi.fn().mockResolvedValue(null),
          createUser: vi.fn(),
        },
      });

      const result = await login(validLoginRequest(), defaultContext, deps);

      if (!isErrorResponse(result)) return;
      expect(result.requestId).toBeDefined();
      expect(typeof result.requestId).toBe('string');
      expect(result.requestId.length).toBeGreaterThan(0);
    });
  });
});

// ─── Magic Link Tests ────────────────────────────────────────────────────────

function fakeMagicTokenPayload(overrides: Partial<MagicTokenPayload> = {}): MagicTokenPayload {
  return {
    userId: 'user-uuid-001',
    tokenId: 'magic-token-id-001',
    ...overrides,
  };
}

function validMagicLinkRequest(overrides: Partial<MagicLinkRequest> = {}): MagicLinkRequest {
  return {
    email: 'user@example.com',
    ...overrides,
  };
}

function validMagicLinkVerifyRequest(
  overrides: Partial<MagicLinkVerifyRequest> = {},
): MagicLinkVerifyRequest {
  return {
    token: 'magic-token-abc123',
    deviceFingerprint: 'device-fp-xyz',
    ...overrides,
  };
}

function createMagicLinkDeps(
  overrides: Partial<MagicLinkDependencies> = {},
): MagicLinkDependencies {
  return {
    userRepository: {
      findByEmail: vi.fn().mockResolvedValue(fakeUser()),
      findById: vi.fn().mockResolvedValue(fakeUser()),
    },
    tokenService: {
      generateTokenPair: vi.fn().mockResolvedValue(fakeTokenPair()),
      generateMagicToken: vi.fn().mockResolvedValue('generated-magic-token'),
      validateMagicToken: vi.fn().mockResolvedValue(fakeMagicTokenPayload()),
      invalidateMagicToken: vi.fn().mockResolvedValue(undefined),
    },
    emailService: {
      sendMagicLink: vi.fn().mockResolvedValue(undefined),
    },
    auditRepository: {
      createAuditLog: vi.fn().mockResolvedValue(fakeAuditLog()),
    },
    ...overrides,
  };
}

function isGenericResponse(res: GenericResponse | ErrorResponse): res is GenericResponse {
  return res.success === true && 'message' in res;
}

// ─── requestMagicLink Tests ──────────────────────────────────────────────────

describe('requestMagicLink', () => {
  describe('successful request (user exists)', () => {
    it('should return generic success response', async () => {
      const deps = createMagicLinkDeps();
      const result = await requestMagicLink(validMagicLinkRequest(), defaultContext, deps);

      expect(isGenericResponse(result)).toBe(true);
      if (!isGenericResponse(result)) return;

      expect(result.success).toBe(true);
      expect(result.message).toBe(MAGIC_LINK_REQUEST_MESSAGE);
    });

    it('should look up user by email', async () => {
      const deps = createMagicLinkDeps();
      await requestMagicLink(
        validMagicLinkRequest({ email: 'test@example.com' }),
        defaultContext,
        deps,
      );

      expect(deps.userRepository.findByEmail).toHaveBeenCalledWith('test@example.com');
    });

    it('should generate a magic token for the user', async () => {
      const deps = createMagicLinkDeps();
      await requestMagicLink(validMagicLinkRequest(), defaultContext, deps);

      expect(deps.tokenService.generateMagicToken).toHaveBeenCalledWith('user-uuid-001');
    });

    it('should send magic link email with the generated token', async () => {
      const deps = createMagicLinkDeps();
      await requestMagicLink(validMagicLinkRequest(), defaultContext, deps);

      expect(deps.emailService.sendMagicLink).toHaveBeenCalledWith(
        'test@example.com',
        'generated-magic-token',
      );
    });

    it('should log a successful audit event', async () => {
      const deps = createMagicLinkDeps();
      await requestMagicLink(validMagicLinkRequest(), defaultContext, deps);

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.LOGIN_MAGIC_LINK,
          userId: 'user-uuid-001',
          ipAddress: defaultContext.ipAddress,
          userAgent: defaultContext.userAgent,
          success: true,
          metadata: { email: 'test@example.com' },
        }),
      );
    });
  });

  describe('user not found', () => {
    it('should return the same generic success to prevent email enumeration', async () => {
      const deps = createMagicLinkDeps({
        userRepository: {
          findByEmail: vi.fn().mockResolvedValue(null),
          findById: vi.fn(),
        },
      });

      const result = await requestMagicLink(validMagicLinkRequest(), defaultContext, deps);

      expect(isGenericResponse(result)).toBe(true);
      if (!isGenericResponse(result)) return;

      expect(result.success).toBe(true);
      expect(result.message).toBe(MAGIC_LINK_REQUEST_MESSAGE);
    });

    it('should not generate a magic token when user not found', async () => {
      const deps = createMagicLinkDeps({
        userRepository: {
          findByEmail: vi.fn().mockResolvedValue(null),
          findById: vi.fn(),
        },
      });

      await requestMagicLink(validMagicLinkRequest(), defaultContext, deps);

      expect(deps.tokenService.generateMagicToken).not.toHaveBeenCalled();
    });

    it('should not send email when user not found', async () => {
      const deps = createMagicLinkDeps({
        userRepository: {
          findByEmail: vi.fn().mockResolvedValue(null),
          findById: vi.fn(),
        },
      });

      await requestMagicLink(validMagicLinkRequest(), defaultContext, deps);

      expect(deps.emailService.sendMagicLink).not.toHaveBeenCalled();
    });

    it('should log a failed audit event for user not found', async () => {
      const deps = createMagicLinkDeps({
        userRepository: {
          findByEmail: vi.fn().mockResolvedValue(null),
          findById: vi.fn(),
        },
      });

      await requestMagicLink(validMagicLinkRequest(), defaultContext, deps);

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.LOGIN_MAGIC_LINK,
          userId: null,
          success: false,
          metadata: { reason: 'user_not_found' },
        }),
      );
    });

    it('should return identical response for existing and non-existing emails', async () => {
      // Existing user
      const existsDeps = createMagicLinkDeps();
      const existsResult = await requestMagicLink(
        validMagicLinkRequest(),
        defaultContext,
        existsDeps,
      );

      // Non-existing user
      const noUserDeps = createMagicLinkDeps({
        userRepository: {
          findByEmail: vi.fn().mockResolvedValue(null),
          findById: vi.fn(),
        },
      });
      const noUserResult = await requestMagicLink(
        validMagicLinkRequest(),
        defaultContext,
        noUserDeps,
      );

      // Both should be generic success with the same message
      expect(isGenericResponse(existsResult)).toBe(true);
      expect(isGenericResponse(noUserResult)).toBe(true);
      if (!isGenericResponse(existsResult) || !isGenericResponse(noUserResult)) return;

      expect(existsResult.message).toBe(noUserResult.message);
      expect(existsResult.success).toBe(noUserResult.success);
    });
  });

  describe('email service failure (Req 3.7)', () => {
    it('should return EMAIL_SERVICE_ERROR when email service throws', async () => {
      const deps = createMagicLinkDeps({
        emailService: {
          sendMagicLink: vi.fn().mockRejectedValue(new Error('SMTP connection failed')),
        },
      });

      const result = await requestMagicLink(validMagicLinkRequest(), defaultContext, deps);

      expect(isErrorResponse(result)).toBe(true);
      if (!isErrorResponse(result)) return;

      expect(result.error.code).toBe(AUTH_ERROR_CODES.EMAIL_SERVICE_ERROR);
      expect(result.error.message).toBe(EMAIL_SERVICE_UNAVAILABLE_MESSAGE);
    });

    it('should suggest password login in the error message', async () => {
      const deps = createMagicLinkDeps({
        emailService: {
          sendMagicLink: vi.fn().mockRejectedValue(new Error('timeout')),
        },
      });

      const result = await requestMagicLink(validMagicLinkRequest(), defaultContext, deps);

      if (!isErrorResponse(result)) return;
      expect(result.error.message).toContain('password');
    });

    it('should log a failed audit event for email service failure', async () => {
      const deps = createMagicLinkDeps({
        emailService: {
          sendMagicLink: vi.fn().mockRejectedValue(new Error('SMTP down')),
        },
      });

      await requestMagicLink(validMagicLinkRequest(), defaultContext, deps);

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.LOGIN_MAGIC_LINK,
          userId: 'user-uuid-001',
          success: false,
          errorCode: AUTH_ERROR_CODES.EMAIL_SERVICE_ERROR,
          metadata: { reason: 'email_service_failure' },
        }),
      );
    });

    it('should include requestId in the error response', async () => {
      const deps = createMagicLinkDeps({
        emailService: {
          sendMagicLink: vi.fn().mockRejectedValue(new Error('fail')),
        },
      });

      const result = await requestMagicLink(validMagicLinkRequest(), defaultContext, deps);

      if (!isErrorResponse(result)) return;
      expect(result.requestId).toBeDefined();
      expect(typeof result.requestId).toBe('string');
      expect(result.requestId.length).toBeGreaterThan(0);
    });
  });
});

// ─── verifyMagicLink Tests ───────────────────────────────────────────────────

describe('verifyMagicLink', () => {
  describe('successful verification', () => {
    it('should return AuthResponse with user data on valid token', async () => {
      const deps = createMagicLinkDeps();
      const result = await verifyMagicLink(validMagicLinkVerifyRequest(), defaultContext, deps);

      expect(isAuthResponse(result)).toBe(true);
      if (!isAuthResponse(result)) return;

      expect(result.success).toBe(true);
      expect(result.user.id).toBe('user-uuid-001');
      expect(result.user.email).toBe('test@example.com');
    });

    it('should use the token pair expiration as expiresAt', async () => {
      const deps = createMagicLinkDeps();
      const result = await verifyMagicLink(validMagicLinkVerifyRequest(), defaultContext, deps);

      if (!isAuthResponse(result)) return;
      expect(result.expiresAt).toEqual(new Date('2024-06-01T12:15:00Z'));
    });

    it('should validate the magic token', async () => {
      const deps = createMagicLinkDeps();
      await verifyMagicLink(
        validMagicLinkVerifyRequest({ token: 'my-magic-token' }),
        defaultContext,
        deps,
      );

      expect(deps.tokenService.validateMagicToken).toHaveBeenCalledWith('my-magic-token');
    });

    it('should invalidate the token after validation (single-use, Req 3.5)', async () => {
      const deps = createMagicLinkDeps();
      await verifyMagicLink(
        validMagicLinkVerifyRequest({ token: 'my-magic-token' }),
        defaultContext,
        deps,
      );

      expect(deps.tokenService.invalidateMagicToken).toHaveBeenCalledWith('my-magic-token');
    });

    it('should look up user by ID from token payload', async () => {
      const deps = createMagicLinkDeps();
      await verifyMagicLink(validMagicLinkVerifyRequest(), defaultContext, deps);

      expect(deps.userRepository.findById).toHaveBeenCalledWith('user-uuid-001');
    });

    it('should generate token pair with userId and deviceFingerprint', async () => {
      const deps = createMagicLinkDeps();
      await verifyMagicLink(
        validMagicLinkVerifyRequest({ deviceFingerprint: 'fp-abc' }),
        defaultContext,
        deps,
      );

      expect(deps.tokenService.generateTokenPair).toHaveBeenCalledWith('user-uuid-001', 'fp-abc');
    });

    it('should log a successful audit event', async () => {
      const deps = createMagicLinkDeps();
      await verifyMagicLink(
        validMagicLinkVerifyRequest({ deviceFingerprint: 'fp-abc' }),
        defaultContext,
        deps,
      );

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.LOGIN_MAGIC_LINK,
          userId: 'user-uuid-001',
          ipAddress: defaultContext.ipAddress,
          userAgent: defaultContext.userAgent,
          success: true,
          metadata: { deviceFingerprint: 'fp-abc' },
        }),
      );
    });

    it('should not include passwordHash in the user response', async () => {
      const deps = createMagicLinkDeps();
      const result = await verifyMagicLink(validMagicLinkVerifyRequest(), defaultContext, deps);

      if (!isAuthResponse(result)) return;
      expect('passwordHash' in result.user).toBe(false);
    });
  });

  describe('invalid/expired/used token', () => {
    it('should return AUTH_TOKEN_INVALID when token is invalid', async () => {
      const deps = createMagicLinkDeps({
        tokenService: {
          generateTokenPair: vi.fn(),
          generateMagicToken: vi.fn(),
          validateMagicToken: vi.fn().mockResolvedValue(null),
          invalidateMagicToken: vi.fn(),
        },
      });

      const result = await verifyMagicLink(validMagicLinkVerifyRequest(), defaultContext, deps);

      expect(isErrorResponse(result)).toBe(true);
      if (!isErrorResponse(result)) return;

      expect(result.error.code).toBe(AUTH_ERROR_CODES.TOKEN_INVALID);
    });

    it('should not invalidate token when validation fails', async () => {
      const deps = createMagicLinkDeps({
        tokenService: {
          generateTokenPair: vi.fn(),
          generateMagicToken: vi.fn(),
          validateMagicToken: vi.fn().mockResolvedValue(null),
          invalidateMagicToken: vi.fn(),
        },
      });

      await verifyMagicLink(validMagicLinkVerifyRequest(), defaultContext, deps);

      expect(deps.tokenService.invalidateMagicToken).not.toHaveBeenCalled();
    });

    it('should not generate tokens when magic token is invalid', async () => {
      const deps = createMagicLinkDeps({
        tokenService: {
          generateTokenPair: vi.fn(),
          generateMagicToken: vi.fn(),
          validateMagicToken: vi.fn().mockResolvedValue(null),
          invalidateMagicToken: vi.fn(),
        },
      });

      await verifyMagicLink(validMagicLinkVerifyRequest(), defaultContext, deps);

      expect(deps.tokenService.generateTokenPair).not.toHaveBeenCalled();
    });

    it('should log a failed audit event for invalid token', async () => {
      const deps = createMagicLinkDeps({
        tokenService: {
          generateTokenPair: vi.fn(),
          generateMagicToken: vi.fn(),
          validateMagicToken: vi.fn().mockResolvedValue(null),
          invalidateMagicToken: vi.fn(),
        },
      });

      await verifyMagicLink(validMagicLinkVerifyRequest(), defaultContext, deps);

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.LOGIN_MAGIC_LINK,
          userId: null,
          success: false,
          errorCode: AUTH_ERROR_CODES.TOKEN_INVALID,
          metadata: { reason: 'invalid_magic_token' },
        }),
      );
    });

    it('should include requestId in error response', async () => {
      const deps = createMagicLinkDeps({
        tokenService: {
          generateTokenPair: vi.fn(),
          generateMagicToken: vi.fn(),
          validateMagicToken: vi.fn().mockResolvedValue(null),
          invalidateMagicToken: vi.fn(),
        },
      });

      const result = await verifyMagicLink(validMagicLinkVerifyRequest(), defaultContext, deps);

      if (!isErrorResponse(result)) return;
      expect(result.requestId).toBeDefined();
      expect(typeof result.requestId).toBe('string');
      expect(result.requestId.length).toBeGreaterThan(0);
    });
  });

  describe('user not found for valid token', () => {
    it('should return AUTH_TOKEN_INVALID when user no longer exists', async () => {
      const deps = createMagicLinkDeps({
        userRepository: {
          findByEmail: vi.fn(),
          findById: vi.fn().mockResolvedValue(null),
        },
      });

      const result = await verifyMagicLink(validMagicLinkVerifyRequest(), defaultContext, deps);

      expect(isErrorResponse(result)).toBe(true);
      if (!isErrorResponse(result)) return;

      expect(result.error.code).toBe(AUTH_ERROR_CODES.TOKEN_INVALID);
    });

    it('should still invalidate the token even if user not found', async () => {
      const deps = createMagicLinkDeps({
        userRepository: {
          findByEmail: vi.fn(),
          findById: vi.fn().mockResolvedValue(null),
        },
      });

      await verifyMagicLink(
        validMagicLinkVerifyRequest({ token: 'some-token' }),
        defaultContext,
        deps,
      );

      expect(deps.tokenService.invalidateMagicToken).toHaveBeenCalledWith('some-token');
    });

    it('should not generate tokens when user not found', async () => {
      const deps = createMagicLinkDeps({
        userRepository: {
          findByEmail: vi.fn(),
          findById: vi.fn().mockResolvedValue(null),
        },
      });

      await verifyMagicLink(validMagicLinkVerifyRequest(), defaultContext, deps);

      expect(deps.tokenService.generateTokenPair).not.toHaveBeenCalled();
    });
  });
});

// ─── Password Reset Request Tests ────────────────────────────────────────────

function fakeResetTokenPayload(overrides: Partial<ResetTokenPayload> = {}): ResetTokenPayload {
  return {
    userId: 'user-uuid-001',
    tokenId: 'reset-token-id-001',
    ...overrides,
  };
}

function validPasswordResetRequest(
  overrides: Partial<PasswordResetRequest> = {},
): PasswordResetRequest {
  return {
    email: 'user@example.com',
    ...overrides,
  };
}

function validResetPasswordRequest(
  overrides: Partial<ResetPasswordRequest> = {},
): ResetPasswordRequest {
  return {
    token: 'reset-token-abc123',
    newPassword: 'newSecure1Pass',
    ...overrides,
  };
}

function createPasswordResetRequestDeps(
  overrides: Partial<PasswordResetRequestDependencies> = {},
): PasswordResetRequestDependencies {
  return {
    userRepository: {
      findByEmail: vi.fn().mockResolvedValue(fakeUser()),
      findById: vi.fn().mockResolvedValue(fakeUser()),
    },
    passwordService: {
      hashPassword: vi.fn().mockResolvedValue('$2b$12$newHashValue'),
      generateResetToken: vi.fn().mockResolvedValue('generated-reset-token'),
      validateResetToken: vi.fn().mockResolvedValue(fakeResetTokenPayload()),
    },
    emailService: {
      sendPasswordReset: vi.fn().mockResolvedValue(undefined),
    },
    auditRepository: {
      createAuditLog: vi.fn().mockResolvedValue(fakeAuditLog()),
    },
    ...overrides,
  };
}

function createResetPasswordDeps(
  overrides: Partial<ResetPasswordDependencies> = {},
): ResetPasswordDependencies {
  return {
    passwordValidator: {
      validatePassword: vi.fn().mockReturnValue({ valid: true, errors: [] }),
    },
    passwordService: {
      hashPassword: vi.fn().mockResolvedValue('$2b$12$newHashValue'),
      generateResetToken: vi.fn().mockResolvedValue('generated-reset-token'),
      validateResetToken: vi.fn().mockResolvedValue(fakeResetTokenPayload()),
    },
    userRepository: {
      findByEmail: vi.fn().mockResolvedValue(fakeUser()),
      updatePassword: vi.fn().mockResolvedValue(undefined),
    },
    sessionService: {
      invalidateAllUserSessions: vi.fn().mockResolvedValue(undefined),
    },
    auditRepository: {
      createAuditLog: vi.fn().mockResolvedValue(fakeAuditLog()),
    },
    ...overrides,
  };
}

describe('requestPasswordReset', () => {
  describe('successful request (user exists)', () => {
    it('should return generic success response (Req 5.6)', async () => {
      const deps = createPasswordResetRequestDeps();
      const result = await requestPasswordReset(validPasswordResetRequest(), defaultContext, deps);

      expect(isGenericResponse(result)).toBe(true);
      if (!isGenericResponse(result)) return;

      expect(result.success).toBe(true);
      expect(result.message).toBe(PASSWORD_RESET_REQUEST_MESSAGE);
    });

    it('should look up user by email', async () => {
      const deps = createPasswordResetRequestDeps();
      await requestPasswordReset(
        validPasswordResetRequest({ email: 'test@example.com' }),
        defaultContext,
        deps,
      );

      expect(deps.userRepository.findByEmail).toHaveBeenCalledWith('test@example.com');
    });

    it('should generate a reset token for the user (Req 5.1)', async () => {
      const deps = createPasswordResetRequestDeps();
      await requestPasswordReset(validPasswordResetRequest(), defaultContext, deps);

      expect(deps.passwordService.generateResetToken).toHaveBeenCalledWith('user-uuid-001');
    });

    it('should send password reset email with the generated token (Req 5.3)', async () => {
      const deps = createPasswordResetRequestDeps();
      await requestPasswordReset(validPasswordResetRequest(), defaultContext, deps);

      expect(deps.emailService.sendPasswordReset).toHaveBeenCalledWith(
        'test@example.com',
        'generated-reset-token',
      );
    });

    it('should log a successful audit event', async () => {
      const deps = createPasswordResetRequestDeps();
      await requestPasswordReset(validPasswordResetRequest(), defaultContext, deps);

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.PASSWORD_RESET_REQUEST,
          userId: 'user-uuid-001',
          ipAddress: defaultContext.ipAddress,
          userAgent: defaultContext.userAgent,
          success: true,
          metadata: { email: 'test@example.com' },
        }),
      );
    });
  });

  describe('user not found (Req 5.6)', () => {
    it('should return the same generic success to prevent email enumeration', async () => {
      const deps = createPasswordResetRequestDeps({
        userRepository: {
          findByEmail: vi.fn().mockResolvedValue(null),
          findById: vi.fn(),
        },
      });

      const result = await requestPasswordReset(validPasswordResetRequest(), defaultContext, deps);

      expect(isGenericResponse(result)).toBe(true);
      if (!isGenericResponse(result)) return;

      expect(result.success).toBe(true);
      expect(result.message).toBe(PASSWORD_RESET_REQUEST_MESSAGE);
    });

    it('should not generate a reset token when user not found', async () => {
      const deps = createPasswordResetRequestDeps({
        userRepository: {
          findByEmail: vi.fn().mockResolvedValue(null),
          findById: vi.fn(),
        },
      });

      await requestPasswordReset(validPasswordResetRequest(), defaultContext, deps);

      expect(deps.passwordService.generateResetToken).not.toHaveBeenCalled();
    });

    it('should not send email when user not found', async () => {
      const deps = createPasswordResetRequestDeps({
        userRepository: {
          findByEmail: vi.fn().mockResolvedValue(null),
          findById: vi.fn(),
        },
      });

      await requestPasswordReset(validPasswordResetRequest(), defaultContext, deps);

      expect(deps.emailService.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('should log a failed audit event for user not found', async () => {
      const deps = createPasswordResetRequestDeps({
        userRepository: {
          findByEmail: vi.fn().mockResolvedValue(null),
          findById: vi.fn(),
        },
      });

      await requestPasswordReset(validPasswordResetRequest(), defaultContext, deps);

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.PASSWORD_RESET_REQUEST,
          userId: null,
          success: false,
          metadata: { reason: 'user_not_found' },
        }),
      );
    });

    it('should return identical response for existing and non-existing emails', async () => {
      // Existing user
      const existsDeps = createPasswordResetRequestDeps();
      const existsResult = await requestPasswordReset(
        validPasswordResetRequest(),
        defaultContext,
        existsDeps,
      );

      // Non-existing user
      const noUserDeps = createPasswordResetRequestDeps({
        userRepository: {
          findByEmail: vi.fn().mockResolvedValue(null),
          findById: vi.fn(),
        },
      });
      const noUserResult = await requestPasswordReset(
        validPasswordResetRequest(),
        defaultContext,
        noUserDeps,
      );

      // Both should be generic success with the same message
      expect(isGenericResponse(existsResult)).toBe(true);
      expect(isGenericResponse(noUserResult)).toBe(true);
      if (!isGenericResponse(existsResult) || !isGenericResponse(noUserResult)) return;

      expect(existsResult.message).toBe(noUserResult.message);
      expect(existsResult.success).toBe(noUserResult.success);
    });
  });

  describe('email service failure', () => {
    it('should return EMAIL_SERVICE_ERROR when email service throws', async () => {
      const deps = createPasswordResetRequestDeps({
        emailService: {
          sendPasswordReset: vi.fn().mockRejectedValue(new Error('SMTP connection failed')),
        },
      });

      const result = await requestPasswordReset(validPasswordResetRequest(), defaultContext, deps);

      expect(isErrorResponse(result)).toBe(true);
      if (!isErrorResponse(result)) return;

      expect(result.error.code).toBe(AUTH_ERROR_CODES.EMAIL_SERVICE_ERROR);
      expect(result.error.message).toBe(PASSWORD_RESET_EMAIL_UNAVAILABLE_MESSAGE);
    });

    it('should log a failed audit event for email service failure', async () => {
      const deps = createPasswordResetRequestDeps({
        emailService: {
          sendPasswordReset: vi.fn().mockRejectedValue(new Error('SMTP down')),
        },
      });

      await requestPasswordReset(validPasswordResetRequest(), defaultContext, deps);

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.PASSWORD_RESET_REQUEST,
          userId: 'user-uuid-001',
          success: false,
          errorCode: AUTH_ERROR_CODES.EMAIL_SERVICE_ERROR,
          metadata: { reason: 'email_service_failure' },
        }),
      );
    });

    it('should include requestId in the error response', async () => {
      const deps = createPasswordResetRequestDeps({
        emailService: {
          sendPasswordReset: vi.fn().mockRejectedValue(new Error('fail')),
        },
      });

      const result = await requestPasswordReset(validPasswordResetRequest(), defaultContext, deps);

      if (!isErrorResponse(result)) return;
      expect(result.requestId).toBeDefined();
      expect(typeof result.requestId).toBe('string');
      expect(result.requestId.length).toBeGreaterThan(0);
    });
  });
});

// ─── resetPassword Tests ─────────────────────────────────────────────────────

describe('resetPassword', () => {
  describe('successful reset', () => {
    it('should return generic success response', async () => {
      const deps = createResetPasswordDeps();
      const result = await resetPassword(validResetPasswordRequest(), defaultContext, deps);

      expect(isGenericResponse(result)).toBe(true);
      if (!isGenericResponse(result)) return;

      expect(result.success).toBe(true);
      expect(result.message).toBe('Your password has been reset successfully.');
    });

    it('should validate the reset token', async () => {
      const deps = createResetPasswordDeps();
      await resetPassword(
        validResetPasswordRequest({ token: 'my-reset-token' }),
        defaultContext,
        deps,
      );

      expect(deps.passwordService.validateResetToken).toHaveBeenCalledWith('my-reset-token');
    });

    it('should validate new password strength', async () => {
      const deps = createResetPasswordDeps();
      await resetPassword(
        validResetPasswordRequest({ newPassword: 'strongPass1' }),
        defaultContext,
        deps,
      );

      expect(deps.passwordValidator.validatePassword).toHaveBeenCalledWith('strongPass1');
    });

    it('should hash the new password', async () => {
      const deps = createResetPasswordDeps();
      await resetPassword(
        validResetPasswordRequest({ newPassword: 'newSecure1Pass' }),
        defaultContext,
        deps,
      );

      expect(deps.passwordService.hashPassword).toHaveBeenCalledWith('newSecure1Pass');
    });

    it('should update the user password with the new hash (Req 5.4)', async () => {
      const deps = createResetPasswordDeps();
      await resetPassword(validResetPasswordRequest(), defaultContext, deps);

      expect(deps.userRepository.updatePassword).toHaveBeenCalledWith(
        'user-uuid-001',
        '$2b$12$newHashValue',
      );
    });

    it('should invalidate all user sessions (Req 5.5)', async () => {
      const deps = createResetPasswordDeps();
      await resetPassword(validResetPasswordRequest(), defaultContext, deps);

      expect(deps.sessionService.invalidateAllUserSessions).toHaveBeenCalledWith('user-uuid-001');
    });

    it('should log a successful audit event', async () => {
      const deps = createResetPasswordDeps();
      await resetPassword(validResetPasswordRequest(), defaultContext, deps);

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.PASSWORD_RESET_COMPLETE,
          userId: 'user-uuid-001',
          ipAddress: defaultContext.ipAddress,
          userAgent: defaultContext.userAgent,
          success: true,
        }),
      );
    });
  });

  describe('invalid/expired token', () => {
    it('should return AUTH_TOKEN_INVALID when token is invalid', async () => {
      const deps = createResetPasswordDeps({
        passwordService: {
          hashPassword: vi.fn(),
          generateResetToken: vi.fn(),
          validateResetToken: vi.fn().mockResolvedValue(null),
        },
      });

      const result = await resetPassword(validResetPasswordRequest(), defaultContext, deps);

      expect(isErrorResponse(result)).toBe(true);
      if (!isErrorResponse(result)) return;

      expect(result.error.code).toBe(AUTH_ERROR_CODES.TOKEN_INVALID);
    });

    it('should not validate password when token is invalid', async () => {
      const deps = createResetPasswordDeps({
        passwordService: {
          hashPassword: vi.fn(),
          generateResetToken: vi.fn(),
          validateResetToken: vi.fn().mockResolvedValue(null),
        },
      });

      await resetPassword(validResetPasswordRequest(), defaultContext, deps);

      expect(deps.passwordValidator.validatePassword).not.toHaveBeenCalled();
    });

    it('should not update password when token is invalid', async () => {
      const deps = createResetPasswordDeps({
        passwordService: {
          hashPassword: vi.fn(),
          generateResetToken: vi.fn(),
          validateResetToken: vi.fn().mockResolvedValue(null),
        },
      });

      await resetPassword(validResetPasswordRequest(), defaultContext, deps);

      expect(deps.userRepository.updatePassword).not.toHaveBeenCalled();
    });

    it('should not invalidate sessions when token is invalid', async () => {
      const deps = createResetPasswordDeps({
        passwordService: {
          hashPassword: vi.fn(),
          generateResetToken: vi.fn(),
          validateResetToken: vi.fn().mockResolvedValue(null),
        },
      });

      await resetPassword(validResetPasswordRequest(), defaultContext, deps);

      expect(deps.sessionService.invalidateAllUserSessions).not.toHaveBeenCalled();
    });

    it('should log a failed audit event for invalid token', async () => {
      const deps = createResetPasswordDeps({
        passwordService: {
          hashPassword: vi.fn(),
          generateResetToken: vi.fn(),
          validateResetToken: vi.fn().mockResolvedValue(null),
        },
      });

      await resetPassword(validResetPasswordRequest(), defaultContext, deps);

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.PASSWORD_RESET_COMPLETE,
          userId: null,
          success: false,
          errorCode: AUTH_ERROR_CODES.TOKEN_INVALID,
          metadata: { reason: 'invalid_reset_token' },
        }),
      );
    });

    it('should include requestId in error response', async () => {
      const deps = createResetPasswordDeps({
        passwordService: {
          hashPassword: vi.fn(),
          generateResetToken: vi.fn(),
          validateResetToken: vi.fn().mockResolvedValue(null),
        },
      });

      const result = await resetPassword(validResetPasswordRequest(), defaultContext, deps);

      if (!isErrorResponse(result)) return;
      expect(result.requestId).toBeDefined();
      expect(typeof result.requestId).toBe('string');
      expect(result.requestId.length).toBeGreaterThan(0);
    });
  });

  describe('weak password', () => {
    it('should return AUTH_WEAK_PASSWORD when new password is weak', async () => {
      const deps = createResetPasswordDeps({
        passwordValidator: {
          validatePassword: vi.fn().mockReturnValue({
            valid: false,
            errors: ['Password must be at least 8 characters'],
          }),
        },
      });

      const result = await resetPassword(validResetPasswordRequest(), defaultContext, deps);

      expect(isErrorResponse(result)).toBe(true);
      if (!isErrorResponse(result)) return;

      expect(result.error.code).toBe(AUTH_ERROR_CODES.WEAK_PASSWORD);
      expect(result.error.fields?.password).toContain('Password must be at least 8 characters');
    });

    it('should not update password when new password is weak', async () => {
      const deps = createResetPasswordDeps({
        passwordValidator: {
          validatePassword: vi.fn().mockReturnValue({
            valid: false,
            errors: ['Password must contain at least 1 number'],
          }),
        },
      });

      await resetPassword(validResetPasswordRequest(), defaultContext, deps);

      expect(deps.userRepository.updatePassword).not.toHaveBeenCalled();
    });

    it('should not invalidate sessions when new password is weak', async () => {
      const deps = createResetPasswordDeps({
        passwordValidator: {
          validatePassword: vi.fn().mockReturnValue({
            valid: false,
            errors: ['Password too short'],
          }),
        },
      });

      await resetPassword(validResetPasswordRequest(), defaultContext, deps);

      expect(deps.sessionService.invalidateAllUserSessions).not.toHaveBeenCalled();
    });

    it('should log a failed audit event for weak password', async () => {
      const deps = createResetPasswordDeps({
        passwordValidator: {
          validatePassword: vi.fn().mockReturnValue({
            valid: false,
            errors: ['Password too short'],
          }),
        },
      });

      await resetPassword(validResetPasswordRequest(), defaultContext, deps);

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.PASSWORD_RESET_COMPLETE,
          userId: 'user-uuid-001',
          success: false,
          errorCode: AUTH_ERROR_CODES.WEAK_PASSWORD,
          metadata: { reason: 'weak_password' },
        }),
      );
    });
  });

  describe('validation order', () => {
    it('should check token before password strength', async () => {
      const deps = createResetPasswordDeps({
        passwordService: {
          hashPassword: vi.fn(),
          generateResetToken: vi.fn(),
          validateResetToken: vi.fn().mockResolvedValue(null),
        },
        passwordValidator: {
          validatePassword: vi.fn().mockReturnValue({
            valid: false,
            errors: ['Password too short'],
          }),
        },
      });

      const result = await resetPassword(validResetPasswordRequest(), defaultContext, deps);

      if (!isErrorResponse(result)) return;
      expect(result.error.code).toBe(AUTH_ERROR_CODES.TOKEN_INVALID);
      expect(deps.passwordValidator.validatePassword).not.toHaveBeenCalled();
    });
  });
});

// ─── Session Management Tests ────────────────────────────────────────────────

import { refresh, logout, logoutAll } from './authController.js';
import type {
  RefreshDependencies,
  LogoutDependencies,
  LogoutAllDependencies,
  SessionManagementTokenService,
} from './authController.js';
import type { RefreshRequest } from '../types/index.js';
import type { CookieResponse } from '../utils/cookies.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a fake JWT access token with a userId in the payload.
 * The token is a valid 3-part base64url-encoded JWT structure.
 */
function fakeAccessToken(userId = 'user-uuid-001'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ userId, exp: 9999999999 })).toString('base64url');
  const signature = 'fakesignature';
  return `${header}.${payload}.${signature}`;
}

function fakeRefreshTokenPair(userId = 'user-uuid-001'): TokenPair {
  return {
    accessToken: fakeAccessToken(userId),
    refreshToken: 'new-refresh-token-value',
    accessTokenExpiresAt: new Date('2024-06-01T12:15:00Z'),
    refreshTokenExpiresAt: new Date('2024-06-08T12:00:00Z'),
  };
}

function validRefreshRequest(overrides: Partial<RefreshRequest> = {}): RefreshRequest {
  return {
    deviceFingerprint: 'abc123fingerprint',
    ...overrides,
  };
}

function createRefreshDeps(overrides: Partial<RefreshDependencies> = {}): RefreshDependencies {
  return {
    tokenService: {
      refreshTokens: vi.fn().mockResolvedValue(fakeRefreshTokenPair()),
      revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
      revokeAllUserTokens: vi.fn().mockResolvedValue(undefined),
    },
    userRepository: {
      findById: vi.fn().mockResolvedValue(fakeUser()),
    },
    auditRepository: {
      createAuditLog: vi.fn().mockResolvedValue(fakeAuditLog()),
    },
    ...overrides,
  };
}

function createLogoutDeps(overrides: Partial<LogoutDependencies> = {}): LogoutDependencies {
  return {
    tokenService: {
      refreshTokens: vi.fn().mockResolvedValue(fakeRefreshTokenPair()),
      revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
      revokeAllUserTokens: vi.fn().mockResolvedValue(undefined),
    },
    auditRepository: {
      createAuditLog: vi.fn().mockResolvedValue(fakeAuditLog()),
    },
    ...overrides,
  };
}

function createLogoutAllDeps(
  overrides: Partial<LogoutAllDependencies> = {},
): LogoutAllDependencies {
  return {
    tokenService: {
      refreshTokens: vi.fn().mockResolvedValue(fakeRefreshTokenPair()),
      revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
      revokeAllUserTokens: vi.fn().mockResolvedValue(undefined),
    },
    auditRepository: {
      createAuditLog: vi.fn().mockResolvedValue(fakeAuditLog()),
    },
    ...overrides,
  };
}

function createMockCookieResponse(): CookieResponse & {
  cookie: ReturnType<typeof vi.fn>;
  clearCookie: ReturnType<typeof vi.fn>;
} {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  };
}

// ─── refresh Tests ───────────────────────────────────────────────────────────

describe('refresh', () => {
  describe('successful refresh', () => {
    it('should return AuthResponse with user data on valid refresh', async () => {
      const deps = createRefreshDeps();
      const result = await refresh(
        validRefreshRequest(),
        'valid-refresh-token',
        defaultContext,
        deps,
      );

      expect(isAuthResponse(result)).toBe(true);
      if (!isAuthResponse(result)) return;

      expect(result.success).toBe(true);
      expect(result.user.id).toBe('user-uuid-001');
      expect(result.user.email).toBe('test@example.com');
    });

    it('should use the new token pair expiration as expiresAt', async () => {
      const deps = createRefreshDeps();
      const result = await refresh(
        validRefreshRequest(),
        'valid-refresh-token',
        defaultContext,
        deps,
      );

      if (!isAuthResponse(result)) return;
      expect(result.expiresAt).toEqual(new Date('2024-06-01T12:15:00Z'));
    });

    it('should call tokenService.refreshTokens with the refresh token and device fingerprint', async () => {
      const deps = createRefreshDeps();
      await refresh(
        validRefreshRequest({ deviceFingerprint: 'my-device' }),
        'my-refresh-token',
        defaultContext,
        deps,
      );

      expect(deps.tokenService.refreshTokens).toHaveBeenCalledWith('my-refresh-token', 'my-device');
    });

    it('should look up user by ID extracted from the new access token', async () => {
      const deps = createRefreshDeps();
      await refresh(validRefreshRequest(), 'valid-refresh-token', defaultContext, deps);

      expect(deps.userRepository.findById).toHaveBeenCalledWith('user-uuid-001');
    });

    it('should log a successful TOKEN_REFRESH audit event', async () => {
      const deps = createRefreshDeps();
      await refresh(
        validRefreshRequest({ deviceFingerprint: 'fp123' }),
        'valid-refresh-token',
        defaultContext,
        deps,
      );

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.TOKEN_REFRESH,
          userId: 'user-uuid-001',
          ipAddress: defaultContext.ipAddress,
          userAgent: defaultContext.userAgent,
          success: true,
          metadata: { deviceFingerprint: 'fp123' },
        }),
      );
    });
  });

  describe('missing refresh token', () => {
    it('should return AUTH_TOKEN_INVALID when refresh token is undefined', async () => {
      const deps = createRefreshDeps();
      const result = await refresh(validRefreshRequest(), undefined, defaultContext, deps);

      expect(isErrorResponse(result)).toBe(true);
      if (!isErrorResponse(result)) return;

      expect(result.error.code).toBe(AUTH_ERROR_CODES.TOKEN_INVALID);
    });

    it('should return AUTH_TOKEN_INVALID when refresh token is empty string', async () => {
      const deps = createRefreshDeps();
      const result = await refresh(validRefreshRequest(), '', defaultContext, deps);

      expect(isErrorResponse(result)).toBe(true);
      if (!isErrorResponse(result)) return;

      expect(result.error.code).toBe(AUTH_ERROR_CODES.TOKEN_INVALID);
    });

    it('should not call tokenService.refreshTokens when token is missing', async () => {
      const deps = createRefreshDeps();
      await refresh(validRefreshRequest(), undefined, defaultContext, deps);

      expect(deps.tokenService.refreshTokens).not.toHaveBeenCalled();
    });

    it('should log a failed audit event for missing token', async () => {
      const deps = createRefreshDeps();
      await refresh(validRefreshRequest(), undefined, defaultContext, deps);

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.TOKEN_REFRESH,
          success: false,
          errorCode: AUTH_ERROR_CODES.TOKEN_INVALID,
          metadata: { reason: 'missing_refresh_token' },
        }),
      );
    });
  });

  describe('invalid/expired token', () => {
    it('should return AUTH_TOKEN_INVALID when tokenService throws generic error', async () => {
      const deps = createRefreshDeps({
        tokenService: {
          refreshTokens: vi.fn().mockRejectedValue(new Error('invalid token')),
          revokeRefreshToken: vi.fn(),
          revokeAllUserTokens: vi.fn(),
        },
      });

      const result = await refresh(validRefreshRequest(), 'bad-token', defaultContext, deps);

      expect(isErrorResponse(result)).toBe(true);
      if (!isErrorResponse(result)) return;

      expect(result.error.code).toBe(AUTH_ERROR_CODES.TOKEN_INVALID);
    });

    it('should return AUTH_TOKEN_EXPIRED when tokenService throws expired error', async () => {
      const expiredError = Object.assign(new Error('token expired'), {
        code: AUTH_ERROR_CODES.TOKEN_EXPIRED,
      });
      const deps = createRefreshDeps({
        tokenService: {
          refreshTokens: vi.fn().mockRejectedValue(expiredError),
          revokeRefreshToken: vi.fn(),
          revokeAllUserTokens: vi.fn(),
        },
      });

      const result = await refresh(validRefreshRequest(), 'expired-token', defaultContext, deps);

      expect(isErrorResponse(result)).toBe(true);
      if (!isErrorResponse(result)) return;

      expect(result.error.code).toBe(AUTH_ERROR_CODES.TOKEN_EXPIRED);
    });

    it('should log a failed audit event for token refresh failure', async () => {
      const deps = createRefreshDeps({
        tokenService: {
          refreshTokens: vi.fn().mockRejectedValue(new Error('invalid')),
          revokeRefreshToken: vi.fn(),
          revokeAllUserTokens: vi.fn(),
        },
      });

      await refresh(validRefreshRequest(), 'bad-token', defaultContext, deps);

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.TOKEN_REFRESH,
          success: false,
          errorCode: AUTH_ERROR_CODES.TOKEN_INVALID,
        }),
      );
    });
  });

  describe('device fingerprint mismatch (Req 4.6)', () => {
    it('should return AUTH_DEVICE_MISMATCH when device fingerprint does not match', async () => {
      const mismatchError = Object.assign(new Error('device mismatch'), {
        code: AUTH_ERROR_CODES.DEVICE_MISMATCH,
      });
      const deps = createRefreshDeps({
        tokenService: {
          refreshTokens: vi.fn().mockRejectedValue(mismatchError),
          revokeRefreshToken: vi.fn(),
          revokeAllUserTokens: vi.fn(),
        },
      });

      const result = await refresh(validRefreshRequest(), 'valid-token', defaultContext, deps);

      expect(isErrorResponse(result)).toBe(true);
      if (!isErrorResponse(result)) return;

      expect(result.error.code).toBe(AUTH_ERROR_CODES.DEVICE_MISMATCH);
    });

    it('should log a failed audit event with device_mismatch reason', async () => {
      const mismatchError = Object.assign(new Error('device mismatch'), {
        code: AUTH_ERROR_CODES.DEVICE_MISMATCH,
      });
      const deps = createRefreshDeps({
        tokenService: {
          refreshTokens: vi.fn().mockRejectedValue(mismatchError),
          revokeRefreshToken: vi.fn(),
          revokeAllUserTokens: vi.fn(),
        },
      });

      await refresh(validRefreshRequest(), 'valid-token', defaultContext, deps);

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.TOKEN_REFRESH,
          success: false,
          errorCode: AUTH_ERROR_CODES.DEVICE_MISMATCH,
          metadata: { reason: 'device_mismatch' },
        }),
      );
    });
  });

  describe('user not found after refresh', () => {
    it('should return AUTH_TOKEN_INVALID when user is not found', async () => {
      const deps = createRefreshDeps({
        userRepository: {
          findById: vi.fn().mockResolvedValue(null),
        },
      });

      const result = await refresh(validRefreshRequest(), 'valid-token', defaultContext, deps);

      expect(isErrorResponse(result)).toBe(true);
      if (!isErrorResponse(result)) return;

      expect(result.error.code).toBe(AUTH_ERROR_CODES.TOKEN_INVALID);
    });
  });
});

// ─── logout Tests ────────────────────────────────────────────────────────────

describe('logout', () => {
  describe('successful logout with token', () => {
    it('should return generic success response', async () => {
      const deps = createLogoutDeps();
      const result = await logout('valid-refresh-token', defaultContext, deps);

      expect(isGenericResponse(result)).toBe(true);
      if (!isGenericResponse(result)) return;

      expect(result.success).toBe(true);
      expect(result.message).toBe('Logged out successfully.');
    });

    it('should revoke the refresh token (Req 6.1)', async () => {
      const deps = createLogoutDeps();
      await logout('my-refresh-token', defaultContext, deps);

      expect(deps.tokenService.revokeRefreshToken).toHaveBeenCalledWith('my-refresh-token');
    });

    it('should log a LOGOUT audit event (Req 6.1)', async () => {
      const deps = createLogoutDeps();
      await logout('valid-refresh-token', defaultContext, deps);

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.LOGOUT,
          ipAddress: defaultContext.ipAddress,
          userAgent: defaultContext.userAgent,
          success: true,
        }),
      );
    });

    it('should clear auth cookies when response object is provided (Req 6.3)', async () => {
      const deps = createLogoutDeps();
      const mockRes = createMockCookieResponse();
      await logout('valid-refresh-token', defaultContext, deps, mockRes);

      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'access-token',
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
        }),
      );
      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'refresh-token',
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
        }),
      );
    });
  });

  describe('logout without token (idempotent)', () => {
    it('should return success even when no refresh token is provided', async () => {
      const deps = createLogoutDeps();
      const result = await logout(undefined, defaultContext, deps);

      expect(isGenericResponse(result)).toBe(true);
      if (!isGenericResponse(result)) return;

      expect(result.success).toBe(true);
      expect(result.message).toBe('Logged out successfully.');
    });

    it('should not call revokeRefreshToken when no token is provided', async () => {
      const deps = createLogoutDeps();
      await logout(undefined, defaultContext, deps);

      expect(deps.tokenService.revokeRefreshToken).not.toHaveBeenCalled();
    });

    it('should still log an audit event when no token is provided', async () => {
      const deps = createLogoutDeps();
      await logout(undefined, defaultContext, deps);

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.LOGOUT,
          success: true,
          metadata: { reason: 'no_refresh_token' },
        }),
      );
    });

    it('should still clear cookies when no token is provided (Req 6.3)', async () => {
      const deps = createLogoutDeps();
      const mockRes = createMockCookieResponse();
      await logout(undefined, defaultContext, deps, mockRes);

      expect(mockRes.clearCookie).toHaveBeenCalledTimes(2);
    });
  });
});

// ─── logoutAll Tests ─────────────────────────────────────────────────────────

describe('logoutAll', () => {
  describe('successful logout-all', () => {
    it('should return generic success response', async () => {
      const deps = createLogoutAllDeps();
      const result = await logoutAll('user-uuid-001', defaultContext, deps);

      expect(isGenericResponse(result)).toBe(true);
      if (!isGenericResponse(result)) return;

      expect(result.success).toBe(true);
      expect(result.message).toBe('Logged out from all devices successfully.');
    });

    it('should revoke all refresh tokens for the user (Req 6.2)', async () => {
      const deps = createLogoutAllDeps();
      await logoutAll('user-uuid-001', defaultContext, deps);

      expect(deps.tokenService.revokeAllUserTokens).toHaveBeenCalledWith('user-uuid-001');
    });

    it('should log a LOGOUT_ALL security event with timestamp and reason (Req 6.4)', async () => {
      const deps = createLogoutAllDeps();
      await logoutAll('user-uuid-001', defaultContext, deps);

      expect(deps.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuthEventType.LOGOUT_ALL,
          userId: 'user-uuid-001',
          ipAddress: defaultContext.ipAddress,
          userAgent: defaultContext.userAgent,
          success: true,
          metadata: expect.objectContaining({
            reason: 'user_requested_logout_all',
            timestamp: expect.any(String),
          }),
        }),
      );
    });

    it('should clear auth cookies when response object is provided (Req 6.3)', async () => {
      const deps = createLogoutAllDeps();
      const mockRes = createMockCookieResponse();
      await logoutAll('user-uuid-001', defaultContext, deps, mockRes);

      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'access-token',
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
        }),
      );
      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'refresh-token',
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
        }),
      );
    });
  });

  describe('missing userId', () => {
    it('should return AUTH_SESSION_INVALID when userId is empty', async () => {
      const deps = createLogoutAllDeps();
      const result = await logoutAll('', defaultContext, deps);

      expect(isErrorResponse(result)).toBe(true);
      if (!isErrorResponse(result)) return;

      expect(result.error.code).toBe(AUTH_ERROR_CODES.SESSION_INVALID);
    });

    it('should not call revokeAllUserTokens when userId is empty', async () => {
      const deps = createLogoutAllDeps();
      await logoutAll('', defaultContext, deps);

      expect(deps.tokenService.revokeAllUserTokens).not.toHaveBeenCalled();
    });
  });
});
