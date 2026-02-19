/**
 * CSRF protection middleware using the double-submit cookie pattern.
 *
 * For every request, a cryptographically secure CSRF token is generated
 * (if one doesn't already exist) and set as a cookie (`csrf-token`).
 * State-changing methods (POST, PUT, DELETE) must include a matching
 * token via the `x-csrf-token` header or `_csrf` body field.
 * Safe methods (GET, HEAD, OPTIONS) skip validation.
 *
 * If validation fails, the request is rejected with HTTP 403 and
 * error code AUTH_CSRF_INVALID.
 *
 * @module middleware/csrfProtection
 * @see Requirements 8.1
 */

import { randomBytes } from 'node:crypto';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Cookie name used to store the CSRF token. */
export const CSRF_COOKIE_NAME = 'csrf-token';

/** Header name clients use to submit the CSRF token. */
export const CSRF_HEADER_NAME = 'x-csrf-token';

/** Body field name clients can use to submit the CSRF token. */
export const CSRF_BODY_FIELD = '_csrf';

/** HTTP methods that are considered safe and skip CSRF validation. */
export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Length of the generated CSRF token in bytes (32 bytes → 64 hex chars). */
export const TOKEN_BYTE_LENGTH = 32;

// ─── Token Generation ────────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure CSRF token.
 * Returns a 64-character hex string derived from 32 random bytes.
 */
export function generateCsrfToken(): string {
  return randomBytes(TOKEN_BYTE_LENGTH).toString('hex');
}

// ─── Token Extraction ────────────────────────────────────────────────────────

/**
 * Minimal request shape needed by the CSRF middleware.
 * Compatible with Express Request but decoupled for testability.
 */
export interface CsrfRequest {
  method: string;
  cookies?: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
}

/**
 * Minimal response shape needed by the CSRF middleware.
 * Compatible with Express Response but decoupled for testability.
 */
export interface CsrfResponse {
  cookie(name: string, value: string, options?: Record<string, unknown>): void;
  status(code: number): CsrfResponse;
  json(body: unknown): void;
}

/**
 * Extract the CSRF token submitted by the client.
 * Checks the `x-csrf-token` header first, then falls back to the
 * `_csrf` field in the request body.
 */
export function extractClientToken(req: CsrfRequest): string | undefined {
  // Check header first
  const headerValue = req.headers[CSRF_HEADER_NAME];
  if (typeof headerValue === 'string' && headerValue.length > 0) {
    return headerValue;
  }

  // Fall back to body field
  if (req.body && typeof req.body[CSRF_BODY_FIELD] === 'string') {
    return req.body[CSRF_BODY_FIELD] as string;
  }

  return undefined;
}

/**
 * Extract the CSRF token from the cookie.
 */
export function extractCookieToken(req: CsrfRequest): string | undefined {
  return req.cookies?.[CSRF_COOKIE_NAME];
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/** Options for configuring the CSRF cookie. */
export interface CsrfCookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  path?: string;
}

const DEFAULT_COOKIE_OPTIONS: CsrfCookieOptions = {
  httpOnly: false, // Client JS needs to read this cookie to send it back
  secure: true,
  sameSite: 'strict',
  path: '/',
};

/**
 * CSRF protection middleware using the double-submit cookie pattern.
 *
 * 1. For every request, ensures a `csrf-token` cookie is set.
 * 2. For state-changing requests (POST, PUT, DELETE), validates that
 *    the client-submitted token matches the cookie token.
 * 3. Returns 403 with AUTH_CSRF_INVALID if validation fails.
 */
export function csrfProtection(cookieOptions?: CsrfCookieOptions) {
  const options = { ...DEFAULT_COOKIE_OPTIONS, ...cookieOptions };

  return function csrfMiddleware(req: CsrfRequest, res: CsrfResponse, next: () => void): void {
    // Ensure a CSRF cookie exists on every response
    let cookieToken = extractCookieToken(req);
    if (!cookieToken) {
      cookieToken = generateCsrfToken();
      res.cookie(CSRF_COOKIE_NAME, cookieToken, { ...options });
    }

    // Safe methods skip validation
    if (SAFE_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    // State-changing methods require a matching token
    const clientToken = extractClientToken(req);

    if (!clientToken || clientToken !== cookieToken) {
      res.status(403).json({
        success: false,
        error: {
          code: 'AUTH_CSRF_INVALID',
          message: 'CSRF token missing or invalid',
        },
      });
      return;
    }

    next();
  };
}
