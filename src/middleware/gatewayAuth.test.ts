/**
 * Unit tests for the gateway authentication middleware.
 *
 * @module middleware/gatewayAuth.test
 * @see Requirements: 3.1, 3.2
 */

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { makeJWTPayload, makeAPIKeyPayload } from '../gateway/testHelpers.js';
import type { APIKeyPayload } from '../gateway/types.js';
import { contextBuilderMiddleware } from './contextBuilder.js';
import {
  createAuthMiddleware,
  extractToken,
  verifyJWT,
  type GatewayAuthConfig,
} from './gatewayAuth.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const JWT_SECRET = 'test-secret-key-for-gateway-auth';
const ISSUER = 'cashtrace';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Sign a JWT with the test secret. */
function signToken(payload: Record<string, unknown>, options: jwt.SignOptions = {}): string {
  return jwt.sign(payload, JWT_SECRET, {
    issuer: ISSUER,
    expiresIn: '1h',
    algorithm: 'HS256',
    ...options,
  });
}

/** Create a test Express app with the gateway auth middleware. */
function createTestApp(
  authRequirement: 'none' | 'jwt' | 'api_key' | 'jwt_or_api_key' = 'jwt',
  configOverrides: Partial<GatewayAuthConfig> = {},
): express.Express {
  const app = express();
  app.use(cookieParser());
  app.use(contextBuilderMiddleware());

  const config: GatewayAuthConfig = {
    jwtSecret: JWT_SECRET,
    issuer: ISSUER,
    ...configOverrides,
  };

  // Set routeConfig on request before auth middleware
  app.use((req, _res, next) => {
    req.routeConfig = { auth: authRequirement } as express.Request['routeConfig'];
    next();
  });

  app.use(createAuthMiddleware(config));

  app.get('/test', (req, res) => {
    res.json({
      success: true,
      context: req.context,
      authPayload: req.authPayload,
    });
  });

  return app;
}

// ─── extractToken ────────────────────────────────────────────────────────────

describe('extractToken', () => {
  it('extracts token from Authorization Bearer header', () => {
    const req = {
      headers: { authorization: 'Bearer my-jwt-token' },
      cookies: {},
    } as unknown as express.Request;
    expect(extractToken(req)).toBe('my-jwt-token');
  });

  it('returns null when Authorization header is missing', () => {
    const req = {
      headers: {},
      cookies: {},
    } as unknown as express.Request;
    expect(extractToken(req)).toBeNull();
  });

  it('returns null when Authorization header is not Bearer scheme', () => {
    const req = {
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
      cookies: {},
    } as unknown as express.Request;
    expect(extractToken(req)).toBeNull();
  });

  it('returns null when Bearer token is empty', () => {
    const req = {
      headers: { authorization: 'Bearer ' },
      cookies: {},
    } as unknown as express.Request;
    expect(extractToken(req)).toBeNull();
  });

  it('extracts token from cookies when no Authorization header', () => {
    const req = {
      headers: {},
      cookies: { token: 'cookie-jwt-token' },
    } as unknown as express.Request;
    expect(extractToken(req)).toBe('cookie-jwt-token');
  });

  it('extracts token from custom cookie name', () => {
    const req = {
      headers: {},
      cookies: { 'auth-token': 'custom-cookie-token' },
    } as unknown as express.Request;
    expect(extractToken(req, 'auth-token')).toBe('custom-cookie-token');
  });

  it('prefers Authorization header over cookies', () => {
    const req = {
      headers: { authorization: 'Bearer header-token' },
      cookies: { token: 'cookie-token' },
    } as unknown as express.Request;
    expect(extractToken(req)).toBe('header-token');
  });

  it('returns null when no token source is available', () => {
    const req = {
      headers: {},
    } as unknown as express.Request;
    expect(extractToken(req)).toBeNull();
  });
});

// ─── verifyJWT ───────────────────────────────────────────────────────────────

describe('verifyJWT', () => {
  it('returns payload for a valid token', () => {
    const jwtPayload = makeJWTPayload();
    const token = signToken({
      userId: jwtPayload.userId,
      email: jwtPayload.email,
      businessId: jwtPayload.businessId,
      permissions: jwtPayload.permissions,
    });

    const result = verifyJWT(token, JWT_SECRET, ISSUER);
    expect(result).not.toBeNull();
    expect(result?.userId).toBe(jwtPayload.userId);
    expect(result?.email).toBe(jwtPayload.email);
    expect(result?.businessId).toBe(jwtPayload.businessId);
    expect(result?.permissions).toEqual(jwtPayload.permissions);
  });

  it('returns null for an expired token', () => {
    const token = signToken(
      {
        userId: 'user-1',
        email: 'test@example.com',
        businessId: 'biz-1',
        permissions: ['read'],
      },
      { expiresIn: '-1s' },
    );

    expect(verifyJWT(token, JWT_SECRET, ISSUER)).toBeNull();
  });

  it('returns null for an invalid signature', () => {
    const token = signToken({
      userId: 'user-1',
      email: 'test@example.com',
      businessId: 'biz-1',
      permissions: ['read'],
    });

    expect(verifyJWT(token, 'wrong-secret', ISSUER)).toBeNull();
  });

  it('returns null for wrong issuer', () => {
    const token = jwt.sign(
      {
        userId: 'user-1',
        email: 'test@example.com',
        businessId: 'biz-1',
        permissions: ['read'],
      },
      JWT_SECRET,
      { issuer: 'wrong-issuer', expiresIn: '1h' },
    );

    expect(verifyJWT(token, JWT_SECRET, ISSUER)).toBeNull();
  });

  it('returns null for a malformed token', () => {
    expect(verifyJWT('not.a.valid.token', JWT_SECRET, ISSUER)).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    const token = jwt.sign({ foo: 'bar' }, JWT_SECRET, { issuer: ISSUER, expiresIn: '1h' });
    expect(verifyJWT(token, JWT_SECRET, ISSUER)).toBeNull();
  });
});

// ─── createAuthMiddleware (integration via supertest) ────────────────────────

describe('createAuthMiddleware', () => {
  describe('auth: none', () => {
    it('skips authentication and passes through', async () => {
      const app = createTestApp('none');
      const res = await request(app).get('/test');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('auth: jwt', () => {
    it('passes through with a valid JWT in Authorization header', async () => {
      const app = createTestApp('jwt');
      const payload = makeJWTPayload();
      const token = signToken({
        userId: payload.userId,
        email: payload.email,
        businessId: payload.businessId,
        permissions: payload.permissions,
      });

      const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.context.userId).toBe(payload.userId);
      expect(res.body.context.businessId).toBe(payload.businessId);
      expect(res.body.context.permissions).toEqual(payload.permissions);
    });

    it('passes through with a valid JWT in cookies', async () => {
      const app = createTestApp('jwt');
      const payload = makeJWTPayload();
      const token = signToken({
        userId: payload.userId,
        email: payload.email,
        businessId: payload.businessId,
        permissions: payload.permissions,
      });

      const res = await request(app).get('/test').set('Cookie', `token=${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.context.userId).toBe(payload.userId);
    });

    it('returns 401 when no token is provided', async () => {
      const app = createTestApp('jwt');
      const res = await request(app).get('/test');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('GW_AUTH_REQUIRED');
    });

    it('returns 401 for an expired JWT', async () => {
      const app = createTestApp('jwt');
      const token = signToken(
        {
          userId: 'user-1',
          email: 'test@example.com',
          businessId: 'biz-1',
          permissions: ['read'],
        },
        { expiresIn: '-1s' },
      );

      const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('GW_AUTH_REQUIRED');
    });

    it('returns 401 for an invalid JWT signature', async () => {
      const app = createTestApp('jwt');
      const token = jwt.sign(
        {
          userId: 'user-1',
          email: 'test@example.com',
          businessId: 'biz-1',
          permissions: ['read'],
        },
        'wrong-secret',
        { issuer: ISSUER, expiresIn: '1h' },
      );

      const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('includes correlationId in error response', async () => {
      const app = createTestApp('jwt');
      const res = await request(app).get('/test');

      expect(res.status).toBe(401);
      expect(res.body.error.correlationId).toBeDefined();
      expect(typeof res.body.error.correlationId).toBe('string');
    });
  });

  describe('auth: api_key', () => {
    const testApiKeys = new Map<string, APIKeyPayload>([
      [
        'valid-api-key-123',
        makeAPIKeyPayload({ serviceId: 'svc-1', serviceName: 'transaction-engine' }),
      ],
    ]);

    it('passes through with a valid API key', async () => {
      const app = createTestApp('api_key', { apiKeys: testApiKeys });
      const res = await request(app).get('/test').set('x-api-key', 'valid-api-key-123');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.context.permissions).toEqual(['internal:read', 'internal:write']);
    });

    it('returns 401 when API key is missing', async () => {
      const app = createTestApp('api_key', { apiKeys: testApiKeys });
      const res = await request(app).get('/test');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('GW_AUTH_REQUIRED');
    });

    it('returns 401 for an invalid API key', async () => {
      const app = createTestApp('api_key', { apiKeys: testApiKeys });
      const res = await request(app).get('/test').set('x-api-key', 'invalid-key');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('GW_AUTH_REQUIRED');
    });
  });

  describe('auth: jwt_or_api_key', () => {
    const testApiKeys = new Map<string, APIKeyPayload>([
      [
        'valid-api-key-456',
        makeAPIKeyPayload({ serviceId: 'svc-2', serviceName: 'insight-engine' }),
      ],
    ]);

    it('accepts a valid JWT', async () => {
      const app = createTestApp('jwt_or_api_key', { apiKeys: testApiKeys });
      const payload = makeJWTPayload();
      const token = signToken({
        userId: payload.userId,
        email: payload.email,
        businessId: payload.businessId,
        permissions: payload.permissions,
      });

      const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.context.userId).toBe(payload.userId);
    });

    it('falls back to API key when JWT is absent', async () => {
      const app = createTestApp('jwt_or_api_key', { apiKeys: testApiKeys });
      const res = await request(app).get('/test').set('x-api-key', 'valid-api-key-456');

      expect(res.status).toBe(200);
      expect(res.body.context.permissions).toEqual(['internal:read', 'internal:write']);
    });

    it('returns 401 when neither JWT nor API key is provided', async () => {
      const app = createTestApp('jwt_or_api_key', { apiKeys: testApiKeys });
      const res = await request(app).get('/test');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('GW_AUTH_REQUIRED');
    });
  });

  describe('onAuthFailure callback (Req 3.7)', () => {
    it('calls onAuthFailure with "missing_token" when no JWT is provided', async () => {
      const onAuthFailure = vi.fn();
      const app = createTestApp('jwt', { onAuthFailure });

      await request(app).get('/test');

      expect(onAuthFailure).toHaveBeenCalledOnce();
      expect(onAuthFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'missing_token',
          authRequirement: 'jwt',
        }),
      );
      expect(onAuthFailure.mock.calls[0][0].timestamp).toBeInstanceOf(Date);
      expect(onAuthFailure.mock.calls[0][0].correlationId).toBeDefined();
    });

    it('calls onAuthFailure with "invalid_token" for an expired JWT', async () => {
      const onAuthFailure = vi.fn();
      const app = createTestApp('jwt', { onAuthFailure });
      const token = signToken(
        {
          userId: 'user-1',
          email: 'test@example.com',
          businessId: 'biz-1',
          permissions: ['read'],
        },
        { expiresIn: '-1s' },
      );

      await request(app).get('/test').set('Authorization', `Bearer ${token}`);

      expect(onAuthFailure).toHaveBeenCalledOnce();
      expect(onAuthFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'invalid_token',
          authRequirement: 'jwt',
        }),
      );
    });

    it('calls onAuthFailure with "missing_api_key" when no API key is provided', async () => {
      const onAuthFailure = vi.fn();
      const app = createTestApp('api_key', {
        apiKeys: new Map(),
        onAuthFailure,
      });

      await request(app).get('/test');

      expect(onAuthFailure).toHaveBeenCalledOnce();
      expect(onAuthFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'missing_api_key',
          authRequirement: 'api_key',
        }),
      );
    });

    it('calls onAuthFailure with "invalid_api_key" for an unrecognized API key', async () => {
      const onAuthFailure = vi.fn();
      const app = createTestApp('api_key', {
        apiKeys: new Map(),
        onAuthFailure,
      });

      await request(app).get('/test').set('x-api-key', 'bad-key');

      expect(onAuthFailure).toHaveBeenCalledOnce();
      expect(onAuthFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'invalid_api_key',
          authRequirement: 'api_key',
        }),
      );
    });

    it('does not call onAuthFailure on successful authentication', async () => {
      const onAuthFailure = vi.fn();
      const payload = makeJWTPayload();
      const token = signToken({
        userId: payload.userId,
        email: payload.email,
        businessId: payload.businessId,
        permissions: payload.permissions,
      });
      const app = createTestApp('jwt', { onAuthFailure });

      const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(onAuthFailure).not.toHaveBeenCalled();
    });

    it('does not call onAuthFailure for auth: none', async () => {
      const onAuthFailure = vi.fn();
      const app = createTestApp('none', { onAuthFailure });

      const res = await request(app).get('/test');

      expect(res.status).toBe(200);
      expect(onAuthFailure).not.toHaveBeenCalled();
    });
  });
});
