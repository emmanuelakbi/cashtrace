/**
 * Property-based tests for CORS Enforcement.
 *
 * **Property 6: CORS Enforcement**
 * For any cross-origin request from an unauthorized origin, it SHALL be
 * rejected with 403 status. Authorized origins receive proper CORS headers,
 * same-origin requests (no Origin header) pass through, and preflight
 * requests for valid origins return 204 with full CORS headers.
 *
 * **Validates: Requirements 5.6**
 *
 * @module middleware/gatewayCors.property.test
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import express from 'express';
import request from 'supertest';

import { createCorsMiddleware, type CorsConfig } from './gatewayCors.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS: string[] = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://cashtrace.ng',
  'https://app.cashtrace.ng',
];

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a random web URL that is NOT in the allowed origins list. */
const unauthorizedOriginArb = fc
  .tuple(
    fc.constantFrom('http', 'https'),
    fc.stringMatching(/^[a-z][a-z0-9-]{1,20}$/),
    fc.constantFrom('.com', '.org', '.net', '.io', '.co', '.xyz', '.evil.ng'),
    fc.option(fc.integer({ min: 1024, max: 65535 }), { nil: undefined }),
  )
  .map(([scheme, host, tld, port]) => {
    const base = `${scheme}://${host}${tld}`;
    return port !== undefined ? `${base}:${port}` : base;
  })
  .filter((origin) => !ALLOWED_ORIGINS.includes(origin));

/** Pick a random origin from the allowed list. */
const authorizedOriginArb = fc.constantFrom(...ALLOWED_ORIGINS);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTestApp(configOverrides: Partial<CorsConfig> = {}): express.Express {
  const app = express();

  app.use(
    createCorsMiddleware({
      allowedOrigins: ALLOWED_ORIGINS,
      ...configOverrides,
    }),
  );

  app.get('/test', (_req, res) => {
    res.json({ success: true });
  });

  return app;
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('CORS Enforcement (Property 6)', { timeout: 60_000 }, () => {
  /**
   * **Validates: Requirements 5.6**
   * For any origin string NOT in the allowed list, the middleware SHALL
   * respond with 403 and error code GW_FORBIDDEN.
   */
  it('rejects all unauthorized origins with 403 and GW_FORBIDDEN', () => {
    const app = createTestApp();

    return fc.assert(
      fc.asyncProperty(unauthorizedOriginArb, async (origin) => {
        const res = await request(app).get('/test').set('Origin', origin);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('GW_FORBIDDEN');
        expect(res.body.error.message).toBe('Origin not allowed');
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 5.6**
   * For any origin in the allowed list, the response SHALL include
   * Access-Control-Allow-Origin matching the request origin.
   */
  it('sets CORS headers for all authorized origins', () => {
    const app = createTestApp();

    return fc.assert(
      fc.asyncProperty(authorizedOriginArb, async (origin) => {
        const res = await request(app).get('/test').set('Origin', origin);

        expect(res.status).toBe(200);
        expect(res.headers['access-control-allow-origin']).toBe(origin);
        expect(res.headers['access-control-allow-credentials']).toBe('true');
        expect(res.headers['vary']).toContain('Origin');
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 5.6**
   * Requests without an Origin header (same-origin) SHALL receive 200
   * and no CORS headers.
   */
  it('passes through same-origin requests without CORS headers', () => {
    const app = createTestApp();

    return fc.assert(
      fc.asyncProperty(fc.constantFrom('/test'), async (path) => {
        const res = await request(app).get(path);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
        expect(res.headers['access-control-allow-credentials']).toBeUndefined();
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 5.6**
   * For any valid origin, OPTIONS preflight requests SHALL return 204
   * with all required CORS headers.
   */
  it('returns 204 with full CORS headers for preflight on valid origins', () => {
    const app = createTestApp();

    return fc.assert(
      fc.asyncProperty(authorizedOriginArb, async (origin) => {
        const res = await request(app).options('/test').set('Origin', origin);

        expect(res.status).toBe(204);
        expect(res.headers['access-control-allow-origin']).toBe(origin);
        expect(res.headers['access-control-allow-methods']).toBeDefined();
        expect(res.headers['access-control-allow-headers']).toBeDefined();
        expect(res.headers['access-control-max-age']).toBeDefined();
        expect(res.headers['access-control-allow-credentials']).toBe('true');
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 5.6**
   * Preflight requests from unauthorized origins SHALL also be rejected
   * with 403 and GW_FORBIDDEN.
   */
  it('rejects preflight from unauthorized origins with 403', () => {
    const app = createTestApp();

    return fc.assert(
      fc.asyncProperty(unauthorizedOriginArb, async (origin) => {
        const res = await request(app).options('/test').set('Origin', origin);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('GW_FORBIDDEN');
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      }),
      { numRuns: 50 },
    );
  });
});
