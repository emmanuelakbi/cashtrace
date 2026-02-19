/**
 * Property-based tests for CSRF protection middleware.
 *
 * **Property 16: CSRF Protection**
 * For any state-changing request (POST, PUT, DELETE), the request SHALL be
 * rejected if it does not include a valid CSRF token matching the
 * double-submit cookie.
 *
 * **Validates: Requirements 8.1**
 *
 * Tag: Feature: core-auth, Property 16: CSRF Protection
 *
 * @module middleware/csrfProtection.property.test
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  csrfProtection,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_BODY_FIELD,
  SAFE_METHODS,
  generateCsrfToken,
  type CsrfRequest,
  type CsrfResponse,
} from './csrfProtection.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** HTTP methods that are state-changing and require CSRF validation. */
const STATE_CHANGING_METHODS = ['POST', 'PUT', 'DELETE'];

/** Arbitrary for state-changing HTTP methods. */
const stateChangingMethodArb = fc.constantFrom(...STATE_CHANGING_METHODS);

/** Arbitrary for safe HTTP methods. */
const safeMethodArb = fc.constantFrom(...[...SAFE_METHODS]);

/** Arbitrary for a valid CSRF token (64-char hex string). */
const csrfTokenArb = fc.hexaString({ minLength: 64, maxLength: 64 });

/**
 * Build a minimal mock CsrfRequest.
 */
function buildRequest(overrides: Partial<CsrfRequest> & { method: string }): CsrfRequest {
  return {
    headers: {},
    ...overrides,
  };
}

/**
 * Build a minimal mock CsrfResponse that records calls.
 */
function buildResponse(): CsrfResponse & {
  statusCode: number | null;
  jsonBody: unknown;
  cookies: Array<{ name: string; value: string; options?: Record<string, unknown> }>;
} {
  const res = {
    statusCode: null as number | null,
    jsonBody: undefined as unknown,
    cookies: [] as Array<{ name: string; value: string; options?: Record<string, unknown> }>,
    cookie(name: string, value: string, options?: Record<string, unknown>) {
      res.cookies.push({ name, value, options });
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.jsonBody = body;
    },
  };
  return res;
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 16: CSRF Protection', () => {
  const middleware = csrfProtection();

  /**
   * **Validates: Requirements 8.1**
   *
   * For any state-changing request without a CSRF cookie token,
   * the middleware SHALL reject with 403 and AUTH_CSRF_INVALID.
   */
  it('should reject state-changing requests with no CSRF cookie', () => {
    fc.assert(
      fc.property(stateChangingMethodArb, (method) => {
        const req = buildRequest({ method, cookies: {} });
        const res = buildResponse();
        let nextCalled = false;

        middleware(req, res, () => {
          nextCalled = true;
        });

        // The middleware sets a new cookie token, but the client has no token to submit
        expect(res.statusCode).toBe(403);
        expect(nextCalled).toBe(false);
        expect((res.jsonBody as { error: { code: string } }).error.code).toBe('AUTH_CSRF_INVALID');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.1**
   *
   * For any state-changing request with a CSRF cookie but no client token
   * (neither header nor body), the middleware SHALL reject with 403.
   */
  it('should reject state-changing requests with cookie but no client token', () => {
    fc.assert(
      fc.property(stateChangingMethodArb, csrfTokenArb, (method, token) => {
        const req = buildRequest({
          method,
          cookies: { [CSRF_COOKIE_NAME]: token },
        });
        const res = buildResponse();
        let nextCalled = false;

        middleware(req, res, () => {
          nextCalled = true;
        });

        expect(res.statusCode).toBe(403);
        expect(nextCalled).toBe(false);
        expect((res.jsonBody as { error: { code: string } }).error.code).toBe('AUTH_CSRF_INVALID');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.1**
   *
   * For any state-changing request where the client token (header) does NOT
   * match the cookie token, the middleware SHALL reject with 403.
   */
  it('should reject state-changing requests with mismatched header token', () => {
    fc.assert(
      fc.property(
        stateChangingMethodArb,
        csrfTokenArb,
        csrfTokenArb,
        (method, cookieToken, headerToken) => {
          fc.pre(cookieToken !== headerToken);

          const req = buildRequest({
            method,
            cookies: { [CSRF_COOKIE_NAME]: cookieToken },
            headers: { [CSRF_HEADER_NAME]: headerToken },
          });
          const res = buildResponse();
          let nextCalled = false;

          middleware(req, res, () => {
            nextCalled = true;
          });

          expect(res.statusCode).toBe(403);
          expect(nextCalled).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.1**
   *
   * For any state-changing request where the client token (body field) does NOT
   * match the cookie token, the middleware SHALL reject with 403.
   */
  it('should reject state-changing requests with mismatched body token', () => {
    fc.assert(
      fc.property(
        stateChangingMethodArb,
        csrfTokenArb,
        csrfTokenArb,
        (method, cookieToken, bodyToken) => {
          fc.pre(cookieToken !== bodyToken);

          const req = buildRequest({
            method,
            cookies: { [CSRF_COOKIE_NAME]: cookieToken },
            body: { [CSRF_BODY_FIELD]: bodyToken },
          });
          const res = buildResponse();
          let nextCalled = false;

          middleware(req, res, () => {
            nextCalled = true;
          });

          expect(res.statusCode).toBe(403);
          expect(nextCalled).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.1**
   *
   * For any state-changing request with a valid matching CSRF token
   * submitted via header, the middleware SHALL allow the request through.
   */
  it('should allow state-changing requests with matching header token', () => {
    fc.assert(
      fc.property(stateChangingMethodArb, csrfTokenArb, (method, token) => {
        const req = buildRequest({
          method,
          cookies: { [CSRF_COOKIE_NAME]: token },
          headers: { [CSRF_HEADER_NAME]: token },
        });
        const res = buildResponse();
        let nextCalled = false;

        middleware(req, res, () => {
          nextCalled = true;
        });

        expect(nextCalled).toBe(true);
        expect(res.statusCode).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.1**
   *
   * For any state-changing request with a valid matching CSRF token
   * submitted via body field, the middleware SHALL allow the request through.
   */
  it('should allow state-changing requests with matching body token', () => {
    fc.assert(
      fc.property(stateChangingMethodArb, csrfTokenArb, (method, token) => {
        const req = buildRequest({
          method,
          cookies: { [CSRF_COOKIE_NAME]: token },
          body: { [CSRF_BODY_FIELD]: token },
        });
        const res = buildResponse();
        let nextCalled = false;

        middleware(req, res, () => {
          nextCalled = true;
        });

        expect(nextCalled).toBe(true);
        expect(res.statusCode).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.1**
   *
   * For any safe method (GET, HEAD, OPTIONS), the middleware SHALL allow
   * the request through without CSRF validation, regardless of token presence.
   */
  it('should allow safe methods without CSRF validation', () => {
    fc.assert(
      fc.property(safeMethodArb, (method) => {
        const req = buildRequest({ method, cookies: {} });
        const res = buildResponse();
        let nextCalled = false;

        middleware(req, res, () => {
          nextCalled = true;
        });

        expect(nextCalled).toBe(true);
        expect(res.statusCode).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.1**
   *
   * For any request without an existing CSRF cookie, the middleware SHALL
   * generate a new token and set it as a cookie on the response.
   */
  it('should set a CSRF cookie when none exists', () => {
    fc.assert(
      fc.property(safeMethodArb, (method) => {
        const req = buildRequest({ method, cookies: {} });
        const res = buildResponse();

        middleware(req, res, () => {});

        // A new cookie should have been set
        const csrfCookie = res.cookies.find((c) => c.name === CSRF_COOKIE_NAME);
        expect(csrfCookie).toBeDefined();
        expect(csrfCookie!.value).toHaveLength(64);
        expect(csrfCookie!.value).toMatch(/^[0-9a-f]{64}$/);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.1**
   *
   * generateCsrfToken SHALL produce unique 64-character hex strings.
   */
  it('should generate unique CSRF tokens', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const token1 = generateCsrfToken();
        const token2 = generateCsrfToken();

        expect(token1).toHaveLength(64);
        expect(token2).toHaveLength(64);
        expect(token1).toMatch(/^[0-9a-f]{64}$/);
        expect(token2).toMatch(/^[0-9a-f]{64}$/);
        expect(token1).not.toBe(token2);
      }),
      { numRuns: 100 },
    );
  });
});
