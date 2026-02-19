/**
 * Integration tests for full auth flows through the Express app.
 *
 * Tests the complete HTTP request/response cycle through the Express
 * middleware stack (JSON parser → cookie parser → CSRF → rate limiter → controller)
 * using injected stubs for all dependencies.
 *
 * @see Requirements: All
 * @see Design: Integration Test Scenarios
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp, type AppDependencies } from './app.js';
import { CSRF_COOKIE_NAME } from './middleware/csrfProtection.js';
import { REFRESH_TOKEN_COOKIE } from './utils/cookies.js';

// ─── Stub Factories ──────────────────────────────────────────────────────────

function stubUser(overrides?: Record<string, unknown>) {
  return {
    id: 'user-1',
    email: 'test@example.com',
    passwordHash: '$2b$12$hash',
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: null,
    status: 'ACTIVE' as const,
    ...overrides,
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
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ userId: 'user-1', sub: 'user-1' })).toString(
    'base64url',
  );
  const signature = 'fakesig';

  return {
    accessToken: `${header}.${payload}.${signature}`,
    refreshToken: 'refresh-token-abc',
    accessTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    refreshTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };
}

function stubRedis() {
  return {
    eval: vi.fn().mockResolvedValue(0),
    zremrangebyscore: vi.fn().mockResolvedValue(0),
    zcard: vi.fn().mockResolvedValue(0),
    del: vi.fn().mockResolvedValue(1),
  } as unknown as AppDependencies['redis'];
}

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
 * Helper: POST with valid CSRF token (double-submit cookie pattern).
 */
async function postWithCsrf(
  app: Express,
  path: string,
  body: Record<string, unknown>,
  extraCookies?: string,
): Promise<request.Response> {
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

// ─── Integration Tests ───────────────────────────────────────────────────────

describe('Integration: Full Auth Flows', () => {
  let deps: AppDependencies;
  let app: Express;

  beforeEach(() => {
    deps = createStubDeps();
    app = createApp(deps);
    app.get('/api/auth/health', (_req, res) => {
      res.json({ ok: true });
    });
  });

  // ── 1. Signup → Login Flow ──────────────────────────────────────────────

  describe('Signup → Login flow', () => {
    it('signs up a new user then logs in with the same credentials', async () => {
      // Step 1: Signup
      const signupRes = await postWithCsrf(app, '/api/auth/signup', {
        email: 'new@example.com',
        password: 'password1',
        consentToTerms: true,
        consentToPrivacy: true,
      });

      expect(signupRes.status).toBe(201);
      expect(signupRes.body.success).toBe(true);
      expect(signupRes.body.user).toBeDefined();
      expect(signupRes.body.user.email).toBe('test@example.com');

      // Step 2: Login with the same credentials
      const loginRes = await postWithCsrf(app, '/api/auth/login', {
        email: 'test@example.com',
        password: 'password1',
        deviceFingerprint: 'device-abc',
      });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.success).toBe(true);
      expect(loginRes.body.user).toBeDefined();
      expect(loginRes.body.user.id).toBe('user-1');
      expect(loginRes.body.expiresAt).toBeDefined();
    });

    it('returns consistent error for login with wrong password', async () => {
      deps.login.passwordService.verifyPassword = vi.fn().mockResolvedValue(false);
      app = createApp(deps);
      app.get('/api/auth/health', (_req, res) => res.json({ ok: true }));

      const res = await postWithCsrf(app, '/api/auth/login', {
        email: 'test@example.com',
        password: 'wrongpass1',
        deviceFingerprint: 'device-abc',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('returns consistent error for login with non-existent email', async () => {
      deps.login.userRepository.findByEmail = vi.fn().mockResolvedValue(null);
      app = createApp(deps);
      app.get('/api/auth/health', (_req, res) => res.json({ ok: true }));

      const res = await postWithCsrf(app, '/api/auth/login', {
        email: 'nobody@example.com',
        password: 'password1',
        deviceFingerprint: 'device-abc',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      // Same error code as wrong password — prevents email enumeration
      expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('rejects signup when email validation fails', async () => {
      deps.signup.emailValidator.validateEmail = vi
        .fn()
        .mockReturnValue({ valid: false, errors: ['Invalid email format'] });
      app = createApp(deps);
      app.get('/api/auth/health', (_req, res) => res.json({ ok: true }));

      const res = await postWithCsrf(app, '/api/auth/signup', {
        email: 'bad-email',
        password: 'password1',
        consentToTerms: true,
        consentToPrivacy: true,
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });

    it('rejects signup when consent is missing', async () => {
      const res = await postWithCsrf(app, '/api/auth/signup', {
        email: 'new@example.com',
        password: 'password1',
        consentToTerms: false,
        consentToPrivacy: true,
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTH_CONSENT_REQUIRED');
    });
  });

  // ── 2. Magic Link Flow ─────────────────────────────────────────────────

  describe('Magic link flow', () => {
    it('requests a magic link then verifies it to get authenticated', async () => {
      // Step 1: Request magic link
      const requestRes = await postWithCsrf(app, '/api/auth/magic-link/request', {
        email: 'test@example.com',
      });

      expect(requestRes.status).toBe(200);
      expect(requestRes.body.success).toBe(true);
      expect(requestRes.body.message).toBeDefined();

      // Verify email service was called
      expect(deps.magicLink.emailService.sendMagicLink).toHaveBeenCalledWith(
        'test@example.com',
        'magic-token-123',
      );

      // Step 2: Verify magic link token
      const verifyRes = await postWithCsrf(app, '/api/auth/magic-link/verify', {
        token: 'magic-token-123',
        deviceFingerprint: 'device-abc',
      });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.success).toBe(true);
      expect(verifyRes.body.user).toBeDefined();
      expect(verifyRes.body.user.id).toBe('user-1');

      // Verify token was invalidated after use
      expect(deps.magicLink.tokenService.invalidateMagicToken).toHaveBeenCalled();
    });

    it('rejects verification with invalid magic link token', async () => {
      deps.magicLink.tokenService.validateMagicToken = vi.fn().mockResolvedValue(null);
      app = createApp(deps);
      app.get('/api/auth/health', (_req, res) => res.json({ ok: true }));

      const res = await postWithCsrf(app, '/api/auth/magic-link/verify', {
        token: 'invalid-token',
        deviceFingerprint: 'device-abc',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rate limits magic link requests', async () => {
      deps.redis = stubRedisRateLimited();
      app = createApp(deps);
      app.get('/api/auth/health', (_req, res) => res.json({ ok: true }));

      const res = await postWithCsrf(app, '/api/auth/magic-link/request', {
        email: 'test@example.com',
      });

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('AUTH_RATE_LIMITED');
      expect(res.headers['retry-after']).toBeDefined();
    });

    it('returns success even for non-existent email (prevents enumeration)', async () => {
      deps.magicLink.userRepository.findByEmail = vi.fn().mockResolvedValue(null);
      app = createApp(deps);
      app.get('/api/auth/health', (_req, res) => res.json({ ok: true }));

      const res = await postWithCsrf(app, '/api/auth/magic-link/request', {
        email: 'nobody@example.com',
      });

      // Should still return 200 to prevent email enumeration
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── 3. Password Reset Flow ─────────────────────────────────────────────

  describe('Password reset flow', () => {
    it('requests password reset then resets password and invalidates sessions', async () => {
      // Step 1: Request password reset
      const requestRes = await postWithCsrf(app, '/api/auth/password/reset-request', {
        email: 'test@example.com',
      });

      expect(requestRes.status).toBe(200);
      expect(requestRes.body.success).toBe(true);
      expect(requestRes.body.message).toBeDefined();

      // Verify email service was called
      expect(deps.passwordResetRequest.emailService.sendPasswordReset).toHaveBeenCalledWith(
        'test@example.com',
        'reset-token-123',
      );

      // Step 2: Reset password with the token
      const resetRes = await postWithCsrf(app, '/api/auth/password/reset', {
        token: 'reset-token-123',
        newPassword: 'newpass123',
      });

      expect(resetRes.status).toBe(200);
      expect(resetRes.body.success).toBe(true);

      // Verify password was updated
      expect(deps.resetPassword.userRepository.updatePassword).toHaveBeenCalled();

      // Verify all sessions were invalidated (Req 5.5)
      expect(deps.resetPassword.sessionService.invalidateAllUserSessions).toHaveBeenCalledWith(
        'user-1',
      );
    });

    it('returns same response for non-existent email (prevents enumeration)', async () => {
      deps.passwordResetRequest.userRepository.findByEmail = vi.fn().mockResolvedValue(null);
      app = createApp(deps);
      app.get('/api/auth/health', (_req, res) => res.json({ ok: true }));

      const res = await postWithCsrf(app, '/api/auth/password/reset-request', {
        email: 'nobody@example.com',
      });

      // Same 200 response as for existing email
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects password reset with invalid token', async () => {
      deps.resetPassword.passwordService.validateResetToken = vi.fn().mockResolvedValue(null);
      app = createApp(deps);
      app.get('/api/auth/health', (_req, res) => res.json({ ok: true }));

      const res = await postWithCsrf(app, '/api/auth/password/reset', {
        token: 'expired-token',
        newPassword: 'newpass123',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects password reset with weak new password', async () => {
      deps.resetPassword.passwordValidator.validatePassword = vi
        .fn()
        .mockReturnValue({ valid: false, errors: ['Password must contain at least 1 number'] });
      app = createApp(deps);
      app.get('/api/auth/health', (_req, res) => res.json({ ok: true }));

      const res = await postWithCsrf(app, '/api/auth/password/reset', {
        token: 'valid-token',
        newPassword: 'nodigits',
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ── 4. Token Refresh Flow ──────────────────────────────────────────────

  describe('Token refresh flow', () => {
    it('logs in then refreshes tokens using the refresh token cookie', async () => {
      // Step 1: Login to get tokens
      const loginRes = await postWithCsrf(app, '/api/auth/login', {
        email: 'test@example.com',
        password: 'password1',
        deviceFingerprint: 'device-abc',
      });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.success).toBe(true);

      // Step 2: Refresh using the refresh token cookie
      const getRes = await request(app).get('/api/auth/health');
      const cookies = getRes.headers['set-cookie'] as string[] | undefined;
      const csrfCookie = cookies?.find((c: string) => c.startsWith(`${CSRF_COOKIE_NAME}=`));
      const csrfToken = csrfCookie?.split('=')[1]?.split(';')[0] ?? '';

      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('x-csrf-token', csrfToken)
        .set(
          'Cookie',
          `${CSRF_COOKIE_NAME}=${csrfToken}; ${REFRESH_TOKEN_COOKIE}=refresh-token-abc`,
        )
        .send({ deviceFingerprint: 'device-abc' });

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.success).toBe(true);
      expect(refreshRes.body.user).toBeDefined();
      expect(refreshRes.body.expiresAt).toBeDefined();

      // Verify token service was called with the refresh token
      expect(deps.refresh.tokenService.refreshTokens).toHaveBeenCalledWith(
        'refresh-token-abc',
        'device-abc',
      );
    });

    it('rejects refresh when no refresh token cookie is present', async () => {
      const res = await postWithCsrf(app, '/api/auth/refresh', {
        deviceFingerprint: 'device-abc',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects refresh when token service throws (expired/revoked token)', async () => {
      deps.refresh.tokenService.refreshTokens = vi
        .fn()
        .mockRejectedValue(new Error('Token expired or revoked'));
      app = createApp(deps);
      app.get('/api/auth/health', (_req, res) => res.json({ ok: true }));

      const getRes = await request(app).get('/api/auth/health');
      const cookies = getRes.headers['set-cookie'] as string[] | undefined;
      const csrfCookie = cookies?.find((c: string) => c.startsWith(`${CSRF_COOKIE_NAME}=`));
      const csrfToken = csrfCookie?.split('=')[1]?.split(';')[0] ?? '';

      const res = await request(app)
        .post('/api/auth/refresh')
        .set('x-csrf-token', csrfToken)
        .set('Cookie', `${CSRF_COOKIE_NAME}=${csrfToken}; ${REFRESH_TOKEN_COOKIE}=expired-token`)
        .send({ deviceFingerprint: 'device-abc' });

      // Should return an error (either 401 from controller or 500 from error handler)
      expect(res.body.success).toBe(false);
    });
  });

  // ── 5. Logout and Logout-All Flows ─────────────────────────────────────

  describe('Logout and logout-all flows', () => {
    it('logs out a single session and clears cookies', async () => {
      // Provide a refresh token cookie for logout
      const getRes = await request(app).get('/api/auth/health');
      const cookies = getRes.headers['set-cookie'] as string[] | undefined;
      const csrfCookie = cookies?.find((c: string) => c.startsWith(`${CSRF_COOKIE_NAME}=`));
      const csrfToken = csrfCookie?.split('=')[1]?.split(';')[0] ?? '';

      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('x-csrf-token', csrfToken)
        .set(
          'Cookie',
          `${CSRF_COOKIE_NAME}=${csrfToken}; ${REFRESH_TOKEN_COOKIE}=refresh-token-abc`,
        )
        .send({});

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);
      expect(logoutRes.body.message).toContain('Logged out');

      // Verify the refresh token was revoked
      expect(deps.logout.tokenService.revokeRefreshToken).toHaveBeenCalledWith('refresh-token-abc');
    });

    it('logout succeeds even without a refresh token (idempotent)', async () => {
      const res = await postWithCsrf(app, '/api/auth/logout', {});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Logged out');
    });

    it('logout-all revokes all tokens for the user', async () => {
      const res = await postWithCsrf(app, '/api/auth/logout-all', {
        userId: 'user-1',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('all devices');

      // Verify all tokens were revoked
      expect(deps.logoutAll.tokenService.revokeAllUserTokens).toHaveBeenCalledWith('user-1');
    });

    it('logout-all fails when no userId is provided', async () => {
      const res = await postWithCsrf(app, '/api/auth/logout-all', {});

      expect(res.status).toBe(200);
      // The controller returns an error response but the route always sends 200
      // Check the body for the actual error
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTH_SESSION_INVALID');
    });

    it('audit log is created on logout-all', async () => {
      await postWithCsrf(app, '/api/auth/logout-all', {
        userId: 'user-1',
      });

      expect(deps.logoutAll.auditRepository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'LOGOUT_ALL',
          userId: 'user-1',
          success: true,
        }),
      );
    });
  });

  // ── 6. CSRF Protection ─────────────────────────────────────────────────

  describe('CSRF protection across flows', () => {
    it('rejects all POST endpoints without CSRF token', async () => {
      const endpoints = [
        { path: '/api/auth/signup', body: { email: 'a@b.com', password: 'pass1234' } },
        { path: '/api/auth/login', body: { email: 'a@b.com', password: 'pass1234' } },
        { path: '/api/auth/magic-link/request', body: { email: 'a@b.com' } },
        { path: '/api/auth/magic-link/verify', body: { token: 'tok' } },
        { path: '/api/auth/password/reset-request', body: { email: 'a@b.com' } },
        { path: '/api/auth/password/reset', body: { token: 'tok', newPassword: 'pass1234' } },
        { path: '/api/auth/refresh', body: { deviceFingerprint: 'abc' } },
        { path: '/api/auth/logout', body: {} },
        { path: '/api/auth/logout-all', body: { userId: 'u1' } },
      ];

      for (const { path, body } of endpoints) {
        const res = await request(app).post(path).send(body);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('AUTH_CSRF_INVALID');
      }
    });
  });

  // ── 7. Rate Limiting ───────────────────────────────────────────────────

  describe('Rate limiting across flows', () => {
    it('rate limits login endpoint independently', async () => {
      deps.redis = stubRedisRateLimited();
      app = createApp(deps);
      app.get('/api/auth/health', (_req, res) => res.json({ ok: true }));

      const loginRes = await postWithCsrf(app, '/api/auth/login', {
        email: 'test@example.com',
        password: 'password1',
        deviceFingerprint: 'abc',
      });

      expect(loginRes.status).toBe(429);
      expect(loginRes.body.error.code).toBe('AUTH_RATE_LIMITED');
      expect(loginRes.headers['retry-after']).toBeDefined();
    });

    it('rate limits magic link endpoint independently', async () => {
      deps.redis = stubRedisRateLimited();
      app = createApp(deps);
      app.get('/api/auth/health', (_req, res) => res.json({ ok: true }));

      const magicRes = await postWithCsrf(app, '/api/auth/magic-link/request', {
        email: 'test@example.com',
      });

      expect(magicRes.status).toBe(429);
      expect(magicRes.body.error.code).toBe('AUTH_RATE_LIMITED');
    });

    it('does not rate limit non-rate-limited endpoints', async () => {
      deps.redis = stubRedisRateLimited();
      app = createApp(deps);
      app.get('/api/auth/health', (_req, res) => res.json({ ok: true }));

      // Signup is not rate limited
      const signupRes = await postWithCsrf(app, '/api/auth/signup', {
        email: 'new@example.com',
        password: 'password1',
        consentToTerms: true,
        consentToPrivacy: true,
      });

      expect(signupRes.status).not.toBe(429);
    });
  });

  // ── 8. Response Structure Consistency ──────────────────────────────────

  describe('Response structure consistency', () => {
    it('success auth responses have user and expiresAt fields', async () => {
      const res = await postWithCsrf(app, '/api/auth/login', {
        email: 'test@example.com',
        password: 'password1',
        deviceFingerprint: 'device-abc',
      });

      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('user');
      expect(res.body.user).toHaveProperty('id');
      expect(res.body.user).toHaveProperty('email');
      expect(res.body.user).toHaveProperty('emailVerified');
      expect(res.body).toHaveProperty('expiresAt');
    });

    it('error responses have error object with code and message', async () => {
      deps.login.passwordService.verifyPassword = vi.fn().mockResolvedValue(false);
      app = createApp(deps);
      app.get('/api/auth/health', (_req, res) => res.json({ ok: true }));

      const res = await postWithCsrf(app, '/api/auth/login', {
        email: 'test@example.com',
        password: 'wrong',
        deviceFingerprint: 'device-abc',
      });

      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toHaveProperty('code');
      expect(res.body.error).toHaveProperty('message');
    });

    it('generic success responses have success and message fields', async () => {
      const res = await postWithCsrf(app, '/api/auth/password/reset-request', {
        email: 'test@example.com',
      });

      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('message');
      expect(typeof res.body.message).toBe('string');
    });
  });
});
