/**
 * Property-based tests for the context builder middleware.
 *
 * **Property 5: Correlation ID Presence**
 * For any request, a correlation ID SHALL be generated or propagated
 * and included in all logs and responses.
 *
 * **Validates: Requirements 4.5, 6.2**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import express from 'express';
import request from 'supertest';
import { validate as uuidValidate } from 'uuid';

import {
  resolveCorrelationId,
  buildContext,
  contextBuilderMiddleware,
  CORRELATION_ID_HEADER,
} from './contextBuilder.js';

import { makeJWTPayload, makeAPIKeyPayload } from '../gateway/testHelpers.js';

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

/** Generate an invalid correlation ID (not a valid UUID). */
const invalidCorrelationIdArb = fc.oneof(
  fc.constant(''),
  fc.constant('not-a-uuid'),
  fc.constant('12345'),
  fc.stringMatching(/^[a-z0-9]{1,30}$/),
  fc.constant('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'),
  fc.constant('00000000-0000-0000-0000-00000000000g'),
);

/** Generate a random IPv4 address. */
const ipv4Arb = fc
  .tuple(
    fc.integer({ min: 1, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 1, max: 254 }),
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

/** Generate a random user-agent string. */
const userAgentArb = fc.oneof(
  fc.constant('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0'),
  fc.constant('CashTrace-Mobile/2.1'),
  fc.constant('curl/7.88.1'),
  fc.stringMatching(/^[A-Za-z][A-Za-z0-9\-\/. ]{0,40}$/),
);

/** Generate a random JWT payload. */
const jwtPayloadArb = fc
  .tuple(
    uuidArb,
    fc.emailAddress(),
    uuidArb,
    fc.array(fc.constantFrom('read', 'write', 'admin', 'delete'), { minLength: 0, maxLength: 4 }),
  )
  .map(([userId, email, businessId, permissions]) =>
    makeJWTPayload({ userId, email, businessId, permissions }),
  );

/** Generate a random API key payload. */
const apiKeyPayloadArb = fc
  .tuple(
    uuidArb,
    fc.constantFrom('transaction-engine', 'document-service', 'insight-service', 'auth-service'),
    fc.array(fc.constantFrom('internal:read', 'internal:write', 'internal:admin'), {
      minLength: 1,
      maxLength: 3,
    }),
  )
  .map(([serviceId, serviceName, permissions]) =>
    makeAPIKeyPayload({ serviceId, serviceName, permissions }),
  );

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal Express Request stub for unit-level property tests. */
function makeReqStub(headers: Record<string, string> = {}, ip = '127.0.0.1'): express.Request {
  return {
    headers,
    ip,
    socket: { remoteAddress: ip },
  } as unknown as express.Request;
}

/** Create a test Express app with the context builder middleware. */
function createTestApp(): express.Express {
  const app = express();
  app.set('trust proxy', true);
  app.use(contextBuilderMiddleware());
  app.get('/test', (req, res) => {
    res.json(req.context);
  });
  return app;
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Correlation ID Presence (Property 5)', () => {
  /**
   * **Validates: Requirements 4.5, 6.2**
   * For any request without a correlation ID header, a valid UUID SHALL be generated.
   */
  it('always generates a valid UUID when no correlation ID header is present', () => {
    fc.assert(
      fc.property(ipv4Arb, userAgentArb, (ip, userAgent) => {
        const req = makeReqStub({ 'user-agent': userAgent }, ip);
        const id = resolveCorrelationId(req);
        expect(uuidValidate(id)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  /**
   * **Validates: Requirements 4.5, 6.2**
   * When a valid UUID is provided as X-Correlation-ID, it SHALL be propagated unchanged.
   */
  it('propagates a valid UUID correlation ID unchanged', () => {
    fc.assert(
      fc.property(uuidArb, (providedId) => {
        // Only test with IDs that are actually valid UUIDs
        fc.pre(uuidValidate(providedId));
        const req = makeReqStub({ [CORRELATION_ID_HEADER]: providedId });
        const resolved = resolveCorrelationId(req);
        expect(resolved).toBe(providedId);
      }),
      { numRuns: 150 },
    );
  });

  /**
   * **Validates: Requirements 4.5, 6.2**
   * When an invalid or missing correlation ID is provided, a new valid UUID SHALL be generated.
   */
  it('generates a new valid UUID when an invalid correlation ID is provided', () => {
    fc.assert(
      fc.property(invalidCorrelationIdArb, (invalidId) => {
        const req = makeReqStub({ [CORRELATION_ID_HEADER]: invalidId });
        const resolved = resolveCorrelationId(req);
        expect(uuidValidate(resolved)).toBe(true);
        // The resolved ID should not be the invalid input
        if (invalidId.length > 0) {
          expect(resolved).not.toBe(invalidId);
        }
      }),
      { numRuns: 150 },
    );
  });

  /**
   * **Validates: Requirements 4.5, 6.2**
   * The correlation ID in the response header SHALL match the one in the request context.
   */
  it('response header correlation ID matches request context correlation ID', async () => {
    const app = createTestApp();

    await fc.assert(
      fc.asyncProperty(fc.option(uuidArb, { nil: undefined }), async (maybeId) => {
        const req = request(app).get('/test');
        if (maybeId && uuidValidate(maybeId)) {
          req.set(CORRELATION_ID_HEADER, maybeId);
        }
        const res = await req;

        const headerCorrelationId = res.headers[CORRELATION_ID_HEADER] as string;
        const bodyCorrelationId = res.body.correlationId as string;

        // Both must be valid UUIDs
        expect(uuidValidate(headerCorrelationId)).toBe(true);
        expect(uuidValidate(bodyCorrelationId)).toBe(true);

        // They must match each other
        expect(headerCorrelationId).toBe(bodyCorrelationId);

        // If a valid UUID was provided, it should be propagated
        if (maybeId && uuidValidate(maybeId)) {
          expect(headerCorrelationId).toBe(maybeId);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 4.5, 6.2**
   * For any combination of auth payload (JWT or API key), the context SHALL always
   * contain a valid UUID correlation ID.
   */
  it('context always has a valid correlation ID regardless of auth payload', () => {
    const authPayloadArb = fc.oneof(fc.constant(undefined), jwtPayloadArb, apiKeyPayloadArb);

    fc.assert(
      fc.property(ipv4Arb, userAgentArb, authPayloadArb, (ip, userAgent, auth) => {
        const req = makeReqStub({ 'user-agent': userAgent }, ip);
        const ctx = buildContext(req, auth);
        expect(uuidValidate(ctx.correlationId)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });
});
