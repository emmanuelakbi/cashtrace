/**
 * Secure cookie utilities for authentication token management.
 *
 * All authentication cookies are set with httpOnly, secure, and
 * sameSite=strict attributes to prevent XSS, MITM, and CSRF attacks.
 *
 * @module utils/cookies
 * @see Requirements 2.3, 6.3
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Cookie name for the JWT access token. */
export const ACCESS_TOKEN_COOKIE = 'access-token';

/** Cookie name for the refresh token. */
export const REFRESH_TOKEN_COOKIE = 'refresh-token';

/** All authentication cookie names. */
export const AUTH_COOKIE_NAMES = [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Options for configuring authentication cookies. */
export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict' | 'lax' | 'none';
  path: string;
  maxAge?: number;
}

/**
 * Minimal response shape for setting/clearing cookies.
 * Compatible with Express Response but decoupled for testability.
 */
export interface CookieResponse {
  cookie(name: string, value: string, options: CookieOptions): void;
  clearCookie(name: string, options: Omit<CookieOptions, 'maxAge'>): void;
}

// ─── Default Options ─────────────────────────────────────────────────────────

/**
 * Base secure cookie options applied to all auth cookies.
 * httpOnly prevents JavaScript access (XSS protection).
 * secure ensures cookies are only sent over HTTPS.
 * sameSite=strict prevents cross-site request forgery.
 */
const BASE_COOKIE_OPTIONS: Omit<CookieOptions, 'maxAge'> = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
};

// ─── Cookie Setters ──────────────────────────────────────────────────────────

/**
 * Set the access token as a secure httpOnly cookie.
 *
 * @param res - The response object to set the cookie on
 * @param token - The JWT access token value
 * @param maxAgeMs - Cookie lifetime in milliseconds (should match token expiry)
 */
export function setAccessTokenCookie(res: CookieResponse, token: string, maxAgeMs: number): void {
  res.cookie(ACCESS_TOKEN_COOKIE, token, {
    ...BASE_COOKIE_OPTIONS,
    maxAge: maxAgeMs,
  });
}

/**
 * Set the refresh token as a secure httpOnly cookie.
 *
 * @param res - The response object to set the cookie on
 * @param token - The refresh token value
 * @param maxAgeMs - Cookie lifetime in milliseconds (should match token expiry)
 */
export function setRefreshTokenCookie(res: CookieResponse, token: string, maxAgeMs: number): void {
  res.cookie(REFRESH_TOKEN_COOKIE, token, {
    ...BASE_COOKIE_OPTIONS,
    maxAge: maxAgeMs,
  });
}

/**
 * Set both access and refresh token cookies in a single call.
 *
 * @param res - The response object to set cookies on
 * @param accessToken - The JWT access token value
 * @param accessMaxAgeMs - Access token cookie lifetime in milliseconds
 * @param refreshToken - The refresh token value
 * @param refreshMaxAgeMs - Refresh token cookie lifetime in milliseconds
 */
export function setAuthCookies(
  res: CookieResponse,
  accessToken: string,
  accessMaxAgeMs: number,
  refreshToken: string,
  refreshMaxAgeMs: number,
): void {
  setAccessTokenCookie(res, accessToken, accessMaxAgeMs);
  setRefreshTokenCookie(res, refreshToken, refreshMaxAgeMs);
}

// ─── Cookie Clearers ─────────────────────────────────────────────────────────

/**
 * Clear all authentication cookies from the response.
 * Uses the same path and security attributes to ensure the browser
 * correctly identifies and removes the cookies.
 *
 * @param res - The response object to clear cookies from
 */
export function clearAuthCookies(res: CookieResponse): void {
  for (const name of AUTH_COOKIE_NAMES) {
    res.clearCookie(name, { ...BASE_COOKIE_OPTIONS });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get the base secure cookie options.
 * Useful for verifying cookie attributes in tests.
 */
export function getSecureCookieOptions(): Omit<CookieOptions, 'maxAge'> {
  return { ...BASE_COOKIE_OPTIONS };
}
