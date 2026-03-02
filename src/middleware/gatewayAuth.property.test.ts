/**
 * Property-based tests for the gateway authentication middleware.
 *
 * **Property 3: Authentication Enforcement**
 * For any protected endpoint, requests without valid authentication
 * SHALL be rejected with 401 status.
 *
 * **Validates: Requirements 3.1, 3.2, 3.4**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import jwt from 'jsonwebtoken';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { makeJWTPayload } from '../gateway/testHelpers.js';
import { contextBuilderMiddleware } from './contextBuilder.js';
import { createAuthMiddleware, verifyJWT, type GatewayAuthConfig } from './gatewayAuth.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const JWT_SECRET = 'property-test-secret-key-for-gateway';
const ISSUER = 'cashtrace';

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid UUID v4 string. */
const uuidArb = fc
  .tuple(
    fc.hexaString({ minLength: 8, maxLength: 8 }),
    fc.hexaString({ minLength: 4, maxLength: 4 }),
    fc.hexaString({ minLength: 4, maxLength: 4 }),
    fc.hexaString({ minLength: 4, maxLength: 4 }),
    fc.hexaString({ minLength: 12, maxLength: 12 }),
  )
  .map(
    ([a, b, c, d, e]) =>
      `${a}-${b}-4${c.slice(1)}-${['8', '9', 'a', 'b'][parseInt(d[0], 16) % 4]}${d.slice(1)}-${e}`,
  );

/** Generate a random email address. */
const emailArb = fc.emailAddress();

/** Generate a random permissions array. */
const permissionsArb = fc.array(fc.constantFrom('read', 'write', 'admin', 'delete', 'manage'), {
  minLength: 0,
  maxLength: 4,
});

/** Generate a random JWT payload with valid structure. */
const jwtPayloadArb = fc
  .tuple(uuidArb, emailArb, uuidArb, permissionsArb)
  .map(([userId, email, businessId, permissions]) =>
    makeJWTPayload({ userId, email, businessId, permissions }),
  );

/**
 * Generate random strings that are NOT valid JWTs.
 * Includes empty strings, plain text, partial JWT structures, etc.
 */
const invalidTokenArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 200 }),
  fc.constant('not-a-jwt'),
  fc.constant('a.b.c'),
  fc.constant('eyJhbGciOiJIUzI1NiJ9.invalid.signature'),
  fc.stringMatching(/^[a-zA-Z0-9._-]{1,100}$/),
  fc
    .tuple(fc.base64String(), fc.base64String(), fc.base64String())
    .map(([a, b, c]) => `${a}.${b}.${c}`),
);

/** Generate a random secret that differs from the correct one. */
const wrongSecretArb = fc.string({ minLength: 10, maxLength: 64 }).filter((s) => s !== JWT_SECRET);

/** Generate a past expiration timestamp (expired token). */
const pastExpArb = fc
  .integer({ min: 1, max: 86400 * 365 })
  .map((secondsAgo) => Math.floor(Date.now() / 1000) - secondsAgo);

/** Generate a protected auth requirement (excludes 'none'). */
const protectedAuthArb = fc.constantFrom(
  'jwt' as const,
  'api_key' as const,
  'jwt_or_api_key' as const,
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Sign a JWT with the given payload and options. */
function signToken(
  payload: Record<string, unknown>,
  secret: string = JWT_SECRET,
  options: jwt.SignOptions = {},
): string {
  return jwt.sign(payload, secret, {
    issuer: ISSUER,
    expiresIn: '1h',
    algorithm: 'HS256',
    ...options,
  });
}

/** Create a test Express app with the gateway auth middleware. */
function createTestApp(
  authRequirement: 'none' | 'jwt' | 'api_key' | 'jwt_or_api_key' = 'jwt',
): express.Express {
  const app = express();
  app.use(cookieParser());
  app.use(contextBuilderMiddleware());

  const config: GatewayAuthConfig = {
    jwtSecret: JWT_SECRET,
    issuer: ISSUER,
  };

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

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Authentication Enforcement (Property 3)', { timeout: 60_000 }, () => {
  /**
   * **Validates: Requirements 3.1, 3.2, 3.4**
   * For any random string that is not a valid JWT, authentication always fails with 401.
   */
  it('rejects any invalid token string with 401', async () => {
    const app = createTestApp('jwt');

    await fc.assert(
      fc.asyncProperty(invalidTokenArb, async (invalidToken) => {
        const res = await request(app).get('/test').set('Authorization', `Bearer ${invalidToken}`);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('GW_AUTH_REQUIRED');
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.2**
   * For any valid JWT payload signed with the correct secret, authentication succeeds.
   */
  it('accepts any valid JWT signed with the correct secret', async () => {
    const app = createTestApp('jwt');

    await fc.assert(
      fc.asyncProperty(jwtPayloadArb, async (payload) => {
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
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 3.2, 3.4**
   * For any JWT signed with a wrong secret, authentication always fails with 401.
   */
  it('rejects any JWT signed with a wrong secret', async () => {
    const app = createTestApp('jwt');

    await fc.assert(
      fc.asyncProperty(jwtPayloadArb, wrongSecretArb, async (payload, wrongSecret) => {
        const token = signToken(
          {
            userId: payload.userId,
            email: payload.email,
            businessId: payload.businessId,
            permissions: payload.permissions,
          },
          wrongSecret,
        );

        const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('GW_AUTH_REQUIRED');
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 3.2, 3.4**
   * For any expired JWT (exp in the past), authentication always fails with 401.
   */
  it('rejects any expired JWT', async () => {
    const app = createTestApp('jwt');

    await fc.assert(
      fc.asyncProperty(jwtPayloadArb, pastExpArb, async (payload, pastExp) => {
        // Sign with explicit exp in the past, overriding expiresIn
        const iat = pastExp - 3600;
        const token = jwt.sign(
          {
            userId: payload.userId,
            email: payload.email,
            businessId: payload.businessId,
            permissions: payload.permissions,
            iat,
            exp: pastExp,
          },
          JWT_SECRET,
          { issuer: ISSUER, algorithm: 'HS256' },
        );

        const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('GW_AUTH_REQUIRED');
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.4**
   * For any request to a protected endpoint without any auth header, it returns 401.
   */
  it('rejects requests without any auth header on any protected endpoint', async () => {
    await fc.assert(
      fc.asyncProperty(protectedAuthArb, async (authReq) => {
        const app = createTestApp(authReq);

        const res = await request(app).get('/test');

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('GW_AUTH_REQUIRED');
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 3.2**
   * verifyJWT returns null for any random string that is not a valid JWT.
   * (Unit-level property test for the core verification function.)
   */
  it('verifyJWT returns null for any arbitrary non-JWT string', () => {
    fc.assert(
      fc.property(invalidTokenArb, (invalidToken) => {
        const result = verifyJWT(invalidToken, JWT_SECRET, ISSUER);
        expect(result).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 3.2**
   * verifyJWT returns null for any JWT signed with a different secret.
   */
  it('verifyJWT returns null for any JWT signed with wrong secret', () => {
    fc.assert(
      fc.property(jwtPayloadArb, wrongSecretArb, (payload, wrongSecret) => {
        const token = signToken(
          {
            userId: payload.userId,
            email: payload.email,
            businessId: payload.businessId,
            permissions: payload.permissions,
          },
          wrongSecret,
        );

        const result = verifyJWT(token, JWT_SECRET, ISSUER);
        expect(result).toBeNull();
      }),
      { numRuns: 200 },
    );
  });
});
