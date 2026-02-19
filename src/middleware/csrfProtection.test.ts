/**
 * Unit tests for the CSRF protection middleware.
 *
 * Tests cover:
 * - Token generation (cryptographic security, uniqueness)
 * - Token extraction from headers and body
 * - Safe method bypass (GET, HEAD, OPTIONS)
 * - State-changing method validation (POST, PUT, DELETE)
 * - Double-submit cookie pattern enforcement
 * - Error response format (AUTH_CSRF_INVALID, HTTP 403)
 *
 * @module middleware/csrfProtection.test
 * @see Requirements 8.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateCsrfToken,
  extractClientToken,
  extractCookieToken,
  csrfProtection,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_BODY_FIELD,
  SAFE_METHODS,
  TOKEN_BYTE_LENGTH,
  type CsrfRequest,
  type CsrfResponse,
} from './csrfProtection.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockRequest(overrides: Partial<CsrfRequest> = {}): CsrfRequest {
  return {
    method: 'GET',
    cookies: {},
    headers: {},
    body: {},
    ...overrides,
  };
}

function createMockResponse() {
  const res: CsrfResponse & {
    statusCode?: number;
    jsonBody?: unknown;
    cookieCalls: Array<{ name: string; value: string; options?: Record<string, unknown> }>;
  } = {
    cookieCalls: [],
    cookie(name: string, value: string, options?: Record<string, unknown>) {
      res.cookieCalls.push({ name, value, options });
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('csrfProtection', () => {
  // ── Token Generation ─────────────────────────────────────────────────

  describe('generateCsrfToken', () => {
    it('should return a hex string of expected length', () => {
      const token = generateCsrfToken();
      expect(token).toMatch(/^[0-9a-f]+$/);
      expect(token).toHaveLength(TOKEN_BYTE_LENGTH * 2); // 64 hex chars
    });

    it('should generate unique tokens on successive calls', () => {
      const tokens = new Set(Array.from({ length: 20 }, () => generateCsrfToken()));
      expect(tokens.size).toBe(20);
    });
  });

  // ── Token Extraction ─────────────────────────────────────────────────

  describe('extractClientToken', () => {
    it('should extract token from x-csrf-token header', () => {
      const req = createMockRequest({
        headers: { [CSRF_HEADER_NAME]: 'abc123' },
      });
      expect(extractClientToken(req)).toBe('abc123');
    });

    it('should extract token from _csrf body field', () => {
      const req = createMockRequest({
        body: { [CSRF_BODY_FIELD]: 'body-token' },
      });
      expect(extractClientToken(req)).toBe('body-token');
    });

    it('should prefer header over body', () => {
      const req = createMockRequest({
        headers: { [CSRF_HEADER_NAME]: 'header-token' },
        body: { [CSRF_BODY_FIELD]: 'body-token' },
      });
      expect(extractClientToken(req)).toBe('header-token');
    });

    it('should return undefined when no token is present', () => {
      const req = createMockRequest();
      expect(extractClientToken(req)).toBeUndefined();
    });

    it('should return undefined for empty header string', () => {
      const req = createMockRequest({
        headers: { [CSRF_HEADER_NAME]: '' },
      });
      expect(extractClientToken(req)).toBeUndefined();
    });

    it('should return undefined for non-string body field', () => {
      const req = createMockRequest({
        body: { [CSRF_BODY_FIELD]: 12345 },
      });
      expect(extractClientToken(req)).toBeUndefined();
    });
  });

  describe('extractCookieToken', () => {
    it('should extract token from csrf-token cookie', () => {
      const req = createMockRequest({
        cookies: { [CSRF_COOKIE_NAME]: 'cookie-val' },
      });
      expect(extractCookieToken(req)).toBe('cookie-val');
    });

    it('should return undefined when cookie is missing', () => {
      const req = createMockRequest({ cookies: {} });
      expect(extractCookieToken(req)).toBeUndefined();
    });

    it('should return undefined when cookies object is undefined', () => {
      const req = createMockRequest({ cookies: undefined });
      expect(extractCookieToken(req)).toBeUndefined();
    });
  });

  // ── Middleware: Safe Methods ──────────────────────────────────────────

  describe('middleware - safe methods', () => {
    const middleware = csrfProtection();

    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      it(`should call next() for ${method} requests without validation`, () => {
        const token = generateCsrfToken();
        const req = createMockRequest({
          method,
          cookies: { [CSRF_COOKIE_NAME]: token },
        });
        const res = createMockResponse();
        const next = vi.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.statusCode).toBeUndefined();
      });
    }

    it('should be case-insensitive for method names', () => {
      const token = generateCsrfToken();
      const req = createMockRequest({
        method: 'get',
        cookies: { [CSRF_COOKIE_NAME]: token },
      });
      const res = createMockResponse();
      const next = vi.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it('should set a CSRF cookie if none exists on safe request', () => {
      const req = createMockRequest({ method: 'GET', cookies: {} });
      const res = createMockResponse();
      const next = vi.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.cookieCalls).toHaveLength(1);
      expect(res.cookieCalls[0]!.name).toBe(CSRF_COOKIE_NAME);
      expect(res.cookieCalls[0]!.value).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ── Middleware: State-Changing Methods ────────────────────────────────

  describe('middleware - state-changing methods', () => {
    const middleware = csrfProtection();

    for (const method of ['POST', 'PUT', 'DELETE']) {
      describe(`${method} requests`, () => {
        it('should call next() when header token matches cookie', () => {
          const token = generateCsrfToken();
          const req = createMockRequest({
            method,
            cookies: { [CSRF_COOKIE_NAME]: token },
            headers: { [CSRF_HEADER_NAME]: token },
          });
          const res = createMockResponse();
          const next = vi.fn();

          middleware(req, res, next);

          expect(next).toHaveBeenCalledOnce();
          expect(res.statusCode).toBeUndefined();
        });

        it('should call next() when body token matches cookie', () => {
          const token = generateCsrfToken();
          const req = createMockRequest({
            method,
            cookies: { [CSRF_COOKIE_NAME]: token },
            body: { [CSRF_BODY_FIELD]: token },
          });
          const res = createMockResponse();
          const next = vi.fn();

          middleware(req, res, next);

          expect(next).toHaveBeenCalledOnce();
        });

        it('should return 403 when no client token is provided', () => {
          const token = generateCsrfToken();
          const req = createMockRequest({
            method,
            cookies: { [CSRF_COOKIE_NAME]: token },
          });
          const res = createMockResponse();
          const next = vi.fn();

          middleware(req, res, next);

          expect(next).not.toHaveBeenCalled();
          expect(res.statusCode).toBe(403);
          expect(res.jsonBody).toEqual({
            success: false,
            error: {
              code: 'AUTH_CSRF_INVALID',
              message: 'CSRF token missing or invalid',
            },
          });
        });

        it('should return 403 when tokens do not match', () => {
          const cookieToken = generateCsrfToken();
          const clientToken = generateCsrfToken();
          const req = createMockRequest({
            method,
            cookies: { [CSRF_COOKIE_NAME]: cookieToken },
            headers: { [CSRF_HEADER_NAME]: clientToken },
          });
          const res = createMockResponse();
          const next = vi.fn();

          middleware(req, res, next);

          expect(next).not.toHaveBeenCalled();
          expect(res.statusCode).toBe(403);
        });
      });
    }

    it('should reject POST when cookie is missing (new token generated but no client token)', () => {
      const req = createMockRequest({
        method: 'POST',
        cookies: {},
        headers: { [CSRF_HEADER_NAME]: 'some-token' },
      });
      const res = createMockResponse();
      const next = vi.fn();

      middleware(req, res, next);

      // A new cookie was generated, but the client token won't match it
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });
  });

  // ── Cookie Options ───────────────────────────────────────────────────

  describe('cookie options', () => {
    it('should set default cookie options (secure, sameSite strict)', () => {
      const middleware = csrfProtection();
      const req = createMockRequest({ method: 'GET', cookies: {} });
      const res = createMockResponse();
      const next = vi.fn();

      middleware(req, res, next);

      expect(res.cookieCalls[0]!.options).toEqual(
        expect.objectContaining({
          httpOnly: false,
          secure: true,
          sameSite: 'strict',
          path: '/',
        }),
      );
    });

    it('should allow overriding cookie options', () => {
      const middleware = csrfProtection({ secure: false, sameSite: 'lax' });
      const req = createMockRequest({ method: 'GET', cookies: {} });
      const res = createMockResponse();
      const next = vi.fn();

      middleware(req, res, next);

      expect(res.cookieCalls[0]!.options).toEqual(
        expect.objectContaining({
          secure: false,
          sameSite: 'lax',
        }),
      );
    });

    it('should not set a new cookie if one already exists', () => {
      const middleware = csrfProtection();
      const token = generateCsrfToken();
      const req = createMockRequest({
        method: 'GET',
        cookies: { [CSRF_COOKIE_NAME]: token },
      });
      const res = createMockResponse();
      const next = vi.fn();

      middleware(req, res, next);

      expect(res.cookieCalls).toHaveLength(0);
    });
  });

  // ── Constants ────────────────────────────────────────────────────────

  describe('constants', () => {
    it('CSRF_COOKIE_NAME should be csrf-token', () => {
      expect(CSRF_COOKIE_NAME).toBe('csrf-token');
    });

    it('CSRF_HEADER_NAME should be x-csrf-token', () => {
      expect(CSRF_HEADER_NAME).toBe('x-csrf-token');
    });

    it('CSRF_BODY_FIELD should be _csrf', () => {
      expect(CSRF_BODY_FIELD).toBe('_csrf');
    });

    it('SAFE_METHODS should include GET, HEAD, OPTIONS', () => {
      expect(SAFE_METHODS.has('GET')).toBe(true);
      expect(SAFE_METHODS.has('HEAD')).toBe(true);
      expect(SAFE_METHODS.has('OPTIONS')).toBe(true);
    });

    it('SAFE_METHODS should not include POST, PUT, DELETE', () => {
      expect(SAFE_METHODS.has('POST')).toBe(false);
      expect(SAFE_METHODS.has('PUT')).toBe(false);
      expect(SAFE_METHODS.has('DELETE')).toBe(false);
    });
  });
});
