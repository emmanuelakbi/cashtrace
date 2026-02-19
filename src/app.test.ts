/**
 * Unit tests for the Express application factory (src/app.ts).
 *
 * Uses lightweight stubs for all dependencies to verify:
 * - Middleware wiring order (JSON parser, cookie parser, CSRF, rate limiter)
 * - Route registration and delegation to controllers
 * - Error handling middleware catches unhandled errors
 * - HTTP status codes match response types
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp, type AppDependencies } from './app.js';
import { CSRF_COOKIE_NAME } from './middleware/csrfProtection.js';
import { REFRESH_TOKEN_COOKIE } from './utils/cookies.js';

// ─── Stub Factories ──────────────────────────────────────────────────────────

function stubUser() {
  return {
    id: 'user-1',
    email: 'test@example.com',
    passwordHash: '$2b$12$hash',
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: null,
    status: 'ACTIVE' as const,
  };
}

function stubAuditLog() {
  return {
    id: 'audit-1',
    eventType: 'SIGNUP' as const,
    userId: 'user-1',
    ipAddress: '127.0.0.1',
    userAgent: 'test',
    requestId: 'req-1',
    success: true,
    errorCode: null,
    metadata: {},
    createdAt: new Date(),
  };
}

function stubConsentRecord() {
  return {
    id: 'consent-1',
    userId: 'user-1',
    consentType: 'TERMS_OF_SERVICE' as const,
    consentVersion: '1.0',
    ipAddress: '127.0.0.1',
    userAgent: 'test',
    grantedAt: new Date(),
    revokedAt: null,
  };
}

function stubTokenPair() {
  // Build a fake JWT with a decodable payload so extractUserIdFromAccessToken works
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ userId: 'user-1', sub: 'user-1' })).toString(
    'base64url',
  );
  const signature = 'fakesig';

  return {
    accessToken: `${header}.${payload}.${signature}`,
    refreshToken: 'refresh-token-here',
    accessTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    refreshTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };
}

/** Create a minimal Redis stub that always allows requests (no rate limiting). */
function stubRedis() {
  return {
    eval: vi.fn().mockResolvedValue(0),
    zremrangebyscore: vi.fn().mockResolvedValue(0),
    zcard: vi.fn().mockResolvedValue(0),
    del: vi.fn().mockResolvedValue(1),
  } as unknown as AppDependencies['redis'];
}

/** Create a Redis stub that blocks requests (rate limit exceeded). */
function stubRedisRateLimited() {
  return {
    eval: vi.fn().mockResolvedValue(5),
    zremrangebyscore: vi.fn().mockResolvedValue(0),
    zcard: vi.fn().mockResolvedValue(5),
    del: vi.fn().mockResolvedValue(1),
  } as unknown as AppDependencies['redis'];
}

function createStubDeps(overrides?: Partial<AppDependencies>): AppDependencies {
  const user = stubUser();
  const auditLog = stubAuditLog();
  const consentRecord = stubConsentRecord();
  const tokenPair = stubTokenPair();

  return {
    redis: stubRedis(),
    signup: {
      emailValidator: { validateEmail: vi.fn().mockReturnValue({ valid: true, errors: [] }) },
      passwordValidator: {
        validatePassword: vi.fn().mockReturnValue({ valid: true, errors: [] }),
      },
      userRepository: {
        findByEmail: vi.fn().mockResolvedValue(null),
        createUser: vi.fn().mockResolvedValue(user),
      },
      passwordService: { hashPassword: vi.fn().mockResolvedValue('$2b$12$hash') },
      consentRepository: { createConsent: vi.fn().mockResolvedValue(consentRecord) },
      auditRepository: { createAuditLog: vi.fn().mockResolvedValue(auditLog) },
    },
    login: {
      userRepository: { findByEmail: vi.fn().mockResolvedValue(user) },
      passwordService: { verifyPassword: vi.fn().mockResolvedValue(true) },
      tokenService: { generateTokenPair: vi.fn().mockResolvedValue(tokenPair) },
      auditRepository: { createAuditLog: vi.fn().mockResolvedValue(auditLog) },
    },
    magicLink: {
      userRepository: {
        findByEmail: vi.fn().mockResolvedValue(user),
        findById: vi.fn().mockResolvedValue(user),
      },
      tokenService: {
        generateTokenPair: vi.fn().mockResolvedValue(tokenPair),
        generateMagicToken: vi.fn().mockResolvedValue('magic-token-123'),
        validateMagicToken: vi.fn().mockResolvedValue({ userId: 'user-1', tokenId: 'token-1' }),
        invalidateMagicToken: vi.fn().mockResolvedValue(undefined),
      },
      emailService: { sendMagicLink: vi.fn().mockResolvedValue(undefined) },
      auditRepository: { createAuditLog: vi.fn().mockResolvedValue(auditLog) },
    },
    passwordResetRequest: {
      userRepository: {
        findByEmail: vi.fn().mockResolvedValue(user),
        findById: vi.fn().mockResolvedValue(user),
      },
      passwordService: {
        hashPassword: vi.fn().mockResolvedValue('$2b$12$hash'),
        generateResetToken: vi.fn().mockResolvedValue('reset-token-123'),
        validateResetToken: vi.fn().mockResolvedValue({ userId: 'user-1', tokenId: 'token-1' }),
      },
      emailService: { sendPasswordReset: vi.fn().mockResolvedValue(undefined) },
      auditRepository: { createAuditLog: vi.fn().mockResolvedValue(auditLog) },
    },
    resetPassword: {
      passwordValidator: {
        validatePassword: vi.fn().mockReturnValue({ valid: true, errors: [] }),
      },
      passwordService: {
        hashPassword: vi.fn().mockResolvedValue('$2b$12$newhash'),
        generateResetToken: vi.fn().mockResolvedValue('reset-token-123'),
        validateResetToken: vi.fn().mockResolvedValue({ userId: 'user-1', tokenId: 'token-1' }),
      },
      userRepository: {
        findByEmail: vi.fn().mockResolvedValue(user),
        updatePassword: vi.fn().mockResolvedValue(undefined),
      },
      sessionService: { invalidateAllUserSessions: vi.fn().mockResolvedValue(undefined) },
      auditRepository: { createAuditLog: vi.fn().mockResolvedValue(auditLog) },
    },
    refresh: {
      tokenService: {
        refreshTokens: vi.fn().mockResolvedValue(tokenPair),
        revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
        revokeAllUserTokens: vi.fn().mockResolvedValue(undefined),
      },
      userRepository: { findById: vi.fn().mockResolvedValue(user) },
      auditRepository: { createAuditLog: vi.fn().mockResolvedValue(auditLog) },
    },
    logout: {
      tokenService: {
        refreshTokens: vi.fn().mockResolvedValue(tokenPair),
        revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
        revokeAllUserTokens: vi.fn().mockResolvedValue(undefined),
      },
      auditRepository: { createAuditLog: vi.fn().mockResolvedValue(auditLog) },
    },
    logoutAll: {
      tokenService: {
        refreshTokens: vi.fn().mockResolvedValue(tokenPair),
        revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
        revokeAllUserTokens: vi.fn().mockResolvedValue(undefined),
      },
      auditRepository: { createAuditLog: vi.fn().mockResolvedValue(auditLog) },
    },
    ...overrides,
  };
}

/**
 * Helper: make a POST request with a valid CSRF token.
 * The CSRF middleware requires a matching cookie + header.
 */
async function postWithCsrf(
  app: Express,
  path: string,
  body: Record<string, unknown>,
  extraCookies?: string,
): Promise<request.Response> {
  // First, do a GET to obtain the CSRF cookie
  const getRes = await request(app).get('/api/auth/health').set('Accept', 'application/json');
  const cookies = getRes.headers['set-cookie'] as string[] | undefined;
  const csrfCookie = cookies?.find((c: string) => c.startsWith(`${CSRF_COOKIE_NAME}=`));
  const csrfToken = csrfCookie?.split('=')[1]?.split(';')[0] ?? '';

  let cookieHeader = `${CSRF_COOKIE_NAME}=${csrfToken}`;
  if (extraCookies) {
    cookieHeader += `; ${extraCookies}`;
  }

  return request(app)
    .post(path)
    .set('x-csrf-token', csrfToken)
    .set('Cookie', cookieHeader)
    .send(body);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createApp', () => {
  let deps: AppDependencies;
  let app: Express;

  beforeEach(() => {
    deps = createStubDeps();
    app = createApp(deps);
    // Add a simple GET endpoint for CSRF token retrieval
    app.get('/api/auth/health', (_req, res) => {
      res.json({ ok: true });
    });
  });

  describe('CSRF protection', () => {
    it('rejects POST requests without CSRF token with 403', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ email: 'test@example.com', password: 'pass1234' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_CSRF_INVALID');
    });

    it('allows POST requests with valid CSRF token', async () => {
      const res = await postWithCsrf(app, '/api/auth/signup', {
        email: 'test@example.com',
        password: 'pass1234',
        consentToTerms: true,
        consentToPrivacy: true,
      });

      expect(res.status).not.toBe(403);
    });
  });

  describe('POST /api/auth/signup', () => {
    it('returns 201 on successful signup', async () => {
      const res = await postWithCsrf(app, '/api/auth/signup', {
        email: 'new@example.com',
        password: 'password1',
        consentToTerms: true,
        consentToPrivacy: true,
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toBeDefined();
    });

    it('returns 400 when email validation fails', async () => {
      deps.signup.emailValidator.validateEmail = vi
        .fn()
        .mockReturnValue({ valid: false, errors: ['Invalid email'] });
      app = createApp(deps);

      const res = await postWithCsrf(app, '/api/auth/signup', {
        email: 'bad',
        password: 'password1',
        consentToTerms: true,
        consentToPrivacy: true,
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/login', () => {
    it('returns 200 on successful login', async () => {
      const res = await postWithCsrf(app, '/api/auth/login', {
        email: 'test@example.com',
        password: 'password1',
        deviceFingerprint: 'abc123',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toBeDefined();
    });

    it('returns 401 on invalid credentials', async () => {
      deps.login.passwordService.verifyPassword = vi.fn().mockResolvedValue(false);
      app = createApp(deps);

      const res = await postWithCsrf(app, '/api/auth/login', {
        email: 'test@example.com',
        password: 'wrong',
        deviceFingerprint: 'abc123',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 429 when rate limited', async () => {
      deps.redis = stubRedisRateLimited();
      app = createApp(deps);

      const res = await postWithCsrf(app, '/api/auth/login', {
        email: 'test@example.com',
        password: 'password1',
        deviceFingerprint: 'abc123',
      });

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('AUTH_RATE_LIMITED');
      expect(res.headers['retry-after']).toBeDefined();
    });
  });

  describe('POST /api/auth/magic-link/request', () => {
    it('returns 200 on successful magic link request', async () => {
      const res = await postWithCsrf(app, '/api/auth/magic-link/request', {
        email: 'test@example.com',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 429 when rate limited', async () => {
      deps.redis = stubRedisRateLimited();
      app = createApp(deps);

      const res = await postWithCsrf(app, '/api/auth/magic-link/request', {
        email: 'test@example.com',
      });

      expect(res.status).toBe(429);
    });
  });

  describe('POST /api/auth/magic-link/verify', () => {
    it('returns 200 on successful verification', async () => {
      const res = await postWithCsrf(app, '/api/auth/magic-link/verify', {
        token: 'valid-magic-token',
        deviceFingerprint: 'abc123',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 401 on invalid token', async () => {
      deps.magicLink.tokenService.validateMagicToken = vi.fn().mockResolvedValue(null);
      app = createApp(deps);

      const res = await postWithCsrf(app, '/api/auth/magic-link/verify', {
        token: 'invalid-token',
        deviceFingerprint: 'abc123',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/password/reset-request', () => {
    it('returns 200 on password reset request', async () => {
      const res = await postWithCsrf(app, '/api/auth/password/reset-request', {
        email: 'test@example.com',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /api/auth/password/reset', () => {
    it('returns 200 on successful password reset', async () => {
      const res = await postWithCsrf(app, '/api/auth/password/reset', {
        token: 'valid-reset-token',
        newPassword: 'newpass123',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 401 on invalid reset token', async () => {
      deps.resetPassword.passwordService.validateResetToken = vi.fn().mockResolvedValue(null);
      app = createApp(deps);

      const res = await postWithCsrf(app, '/api/auth/password/reset', {
        token: 'expired-token',
        newPassword: 'newpass123',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('returns 200 on successful token refresh', async () => {
      // Need to provide the refresh token via cookie
      const getRes = await request(app).get('/api/auth/health');
      const cookies = getRes.headers['set-cookie'] as string[] | undefined;
      const csrfCookie = cookies?.find((c: string) => c.startsWith(`${CSRF_COOKIE_NAME}=`));
      const csrfToken = csrfCookie?.split('=')[1]?.split(';')[0] ?? '';

      const res = await request(app)
        .post('/api/auth/refresh')
        .set('x-csrf-token', csrfToken)
        .set('Cookie', `${CSRF_COOKIE_NAME}=${csrfToken}; ${REFRESH_TOKEN_COOKIE}=valid-refresh`)
        .send({ deviceFingerprint: 'abc123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 401 when no refresh token cookie', async () => {
      const res = await postWithCsrf(app, '/api/auth/refresh', {
        deviceFingerprint: 'abc123',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('returns 200 on logout', async () => {
      const res = await postWithCsrf(app, '/api/auth/logout', {});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Logged out');
    });
  });

  describe('POST /api/auth/logout-all', () => {
    it('returns 200 on logout-all with userId', async () => {
      const res = await postWithCsrf(app, '/api/auth/logout-all', {
        userId: 'user-1',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Error handling middleware', () => {
    it('catches unhandled errors and returns 500 with INTERNAL_ERROR', async () => {
      // Make signup throw an unhandled error
      deps.signup.userRepository.findByEmail = vi.fn().mockRejectedValue(new Error('DB down'));
      app = createApp(deps);

      const res = await postWithCsrf(app, '/api/auth/signup', {
        email: 'test@example.com',
        password: 'password1',
        consentToTerms: true,
        consentToPrivacy: true,
      });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.requestId).toBeDefined();
    });
  });
});
