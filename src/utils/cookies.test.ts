/**
 * Unit tests for secure cookie utilities.
 *
 * Validates that all authentication cookies are set with the correct
 * security attributes (httpOnly, secure, sameSite=strict) as required
 * by Requirement 2.3.
 *
 * @see Requirements 2.3, 6.3
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  AUTH_COOKIE_NAMES,
  setAccessTokenCookie,
  setRefreshTokenCookie,
  setAuthCookies,
  clearAuthCookies,
  getSecureCookieOptions,
  type CookieResponse,
  type CookieOptions,
} from './cookies.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Create a mock CookieResponse that records all calls. */
function createMockResponse(): CookieResponse & {
  cookieCalls: Array<{ name: string; value: string; options: CookieOptions }>;
  clearCookieCalls: Array<{ name: string; options: Omit<CookieOptions, 'maxAge'> }>;
} {
  const cookieCalls: Array<{ name: string; value: string; options: CookieOptions }> = [];
  const clearCookieCalls: Array<{ name: string; options: Omit<CookieOptions, 'maxAge'> }> = [];

  return {
    cookieCalls,
    clearCookieCalls,
    cookie(name: string, value: string, options: CookieOptions) {
      cookieCalls.push({ name, value, options });
    },
    clearCookie(name: string, options: Omit<CookieOptions, 'maxAge'>) {
      clearCookieCalls.push({ name, options });
    },
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

describe('Cookie constants', () => {
  it('should define access token cookie name', () => {
    expect(ACCESS_TOKEN_COOKIE).toBe('access-token');
  });

  it('should define refresh token cookie name', () => {
    expect(REFRESH_TOKEN_COOKIE).toBe('refresh-token');
  });

  it('should include both cookie names in AUTH_COOKIE_NAMES', () => {
    expect(AUTH_COOKIE_NAMES).toContain('access-token');
    expect(AUTH_COOKIE_NAMES).toContain('refresh-token');
    expect(AUTH_COOKIE_NAMES).toHaveLength(2);
  });
});

// ─── getSecureCookieOptions ──────────────────────────────────────────────────

describe('getSecureCookieOptions', () => {
  it('should return httpOnly=true', () => {
    expect(getSecureCookieOptions().httpOnly).toBe(true);
  });

  it('should return secure=true', () => {
    expect(getSecureCookieOptions().secure).toBe(true);
  });

  it('should return sameSite=strict', () => {
    expect(getSecureCookieOptions().sameSite).toBe('strict');
  });

  it('should return path=/', () => {
    expect(getSecureCookieOptions().path).toBe('/');
  });

  it('should return a new object each time (no shared references)', () => {
    const a = getSecureCookieOptions();
    const b = getSecureCookieOptions();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

// ─── setAccessTokenCookie ────────────────────────────────────────────────────

describe('setAccessTokenCookie', () => {
  it('should set cookie with the access token name', () => {
    const res = createMockResponse();
    setAccessTokenCookie(res, 'my-jwt', 900000);
    expect(res.cookieCalls).toHaveLength(1);
    expect(res.cookieCalls[0]!.name).toBe(ACCESS_TOKEN_COOKIE);
  });

  it('should set the token value', () => {
    const res = createMockResponse();
    setAccessTokenCookie(res, 'jwt-token-value', 900000);
    expect(res.cookieCalls[0]!.value).toBe('jwt-token-value');
  });

  it('should set httpOnly=true', () => {
    const res = createMockResponse();
    setAccessTokenCookie(res, 'tok', 900000);
    expect(res.cookieCalls[0]!.options.httpOnly).toBe(true);
  });

  it('should set secure=true', () => {
    const res = createMockResponse();
    setAccessTokenCookie(res, 'tok', 900000);
    expect(res.cookieCalls[0]!.options.secure).toBe(true);
  });

  it('should set sameSite=strict', () => {
    const res = createMockResponse();
    setAccessTokenCookie(res, 'tok', 900000);
    expect(res.cookieCalls[0]!.options.sameSite).toBe('strict');
  });

  it('should set the maxAge from the parameter', () => {
    const res = createMockResponse();
    setAccessTokenCookie(res, 'tok', 900000);
    expect(res.cookieCalls[0]!.options.maxAge).toBe(900000);
  });

  it('should set path=/', () => {
    const res = createMockResponse();
    setAccessTokenCookie(res, 'tok', 900000);
    expect(res.cookieCalls[0]!.options.path).toBe('/');
  });
});

// ─── setRefreshTokenCookie ───────────────────────────────────────────────────

describe('setRefreshTokenCookie', () => {
  it('should set cookie with the refresh token name', () => {
    const res = createMockResponse();
    setRefreshTokenCookie(res, 'refresh-val', 604800000);
    expect(res.cookieCalls).toHaveLength(1);
    expect(res.cookieCalls[0]!.name).toBe(REFRESH_TOKEN_COOKIE);
  });

  it('should set the token value', () => {
    const res = createMockResponse();
    setRefreshTokenCookie(res, 'refresh-val', 604800000);
    expect(res.cookieCalls[0]!.value).toBe('refresh-val');
  });

  it('should set httpOnly=true', () => {
    const res = createMockResponse();
    setRefreshTokenCookie(res, 'tok', 604800000);
    expect(res.cookieCalls[0]!.options.httpOnly).toBe(true);
  });

  it('should set secure=true', () => {
    const res = createMockResponse();
    setRefreshTokenCookie(res, 'tok', 604800000);
    expect(res.cookieCalls[0]!.options.secure).toBe(true);
  });

  it('should set sameSite=strict', () => {
    const res = createMockResponse();
    setRefreshTokenCookie(res, 'tok', 604800000);
    expect(res.cookieCalls[0]!.options.sameSite).toBe('strict');
  });

  it('should set the maxAge from the parameter', () => {
    const res = createMockResponse();
    setRefreshTokenCookie(res, 'tok', 604800000);
    expect(res.cookieCalls[0]!.options.maxAge).toBe(604800000);
  });
});

// ─── setAuthCookies ──────────────────────────────────────────────────────────

describe('setAuthCookies', () => {
  it('should set both access and refresh token cookies', () => {
    const res = createMockResponse();
    setAuthCookies(res, 'access-jwt', 900000, 'refresh-val', 604800000);
    expect(res.cookieCalls).toHaveLength(2);
  });

  it('should set access token cookie first', () => {
    const res = createMockResponse();
    setAuthCookies(res, 'access-jwt', 900000, 'refresh-val', 604800000);
    expect(res.cookieCalls[0]!.name).toBe(ACCESS_TOKEN_COOKIE);
    expect(res.cookieCalls[0]!.value).toBe('access-jwt');
    expect(res.cookieCalls[0]!.options.maxAge).toBe(900000);
  });

  it('should set refresh token cookie second', () => {
    const res = createMockResponse();
    setAuthCookies(res, 'access-jwt', 900000, 'refresh-val', 604800000);
    expect(res.cookieCalls[1]!.name).toBe(REFRESH_TOKEN_COOKIE);
    expect(res.cookieCalls[1]!.value).toBe('refresh-val');
    expect(res.cookieCalls[1]!.options.maxAge).toBe(604800000);
  });

  it('should set secure attributes on both cookies', () => {
    const res = createMockResponse();
    setAuthCookies(res, 'a', 1000, 'r', 2000);
    for (const call of res.cookieCalls) {
      expect(call.options.httpOnly).toBe(true);
      expect(call.options.secure).toBe(true);
      expect(call.options.sameSite).toBe('strict');
    }
  });
});

// ─── clearAuthCookies ────────────────────────────────────────────────────────

describe('clearAuthCookies', () => {
  it('should clear both authentication cookies', () => {
    const res = createMockResponse();
    clearAuthCookies(res);
    expect(res.clearCookieCalls).toHaveLength(2);
  });

  it('should clear the access token cookie', () => {
    const res = createMockResponse();
    clearAuthCookies(res);
    const names = res.clearCookieCalls.map((c) => c.name);
    expect(names).toContain(ACCESS_TOKEN_COOKIE);
  });

  it('should clear the refresh token cookie', () => {
    const res = createMockResponse();
    clearAuthCookies(res);
    const names = res.clearCookieCalls.map((c) => c.name);
    expect(names).toContain(REFRESH_TOKEN_COOKIE);
  });

  it('should use secure attributes when clearing cookies', () => {
    const res = createMockResponse();
    clearAuthCookies(res);
    for (const call of res.clearCookieCalls) {
      expect(call.options.httpOnly).toBe(true);
      expect(call.options.secure).toBe(true);
      expect(call.options.sameSite).toBe('strict');
      expect(call.options.path).toBe('/');
    }
  });

  it('should not set any new cookies', () => {
    const res = createMockResponse();
    clearAuthCookies(res);
    expect(res.cookieCalls).toHaveLength(0);
  });
});
