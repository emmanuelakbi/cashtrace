/**
 * Property-based tests for secure cookie attributes.
 *
 * **Property 21: Secure Cookie Attributes**
 * For any authentication cookie set by the system, it SHALL have
 * httpOnly=true, secure=true, and sameSite=strict attributes.
 *
 * **Validates: Requirements 2.3**
 *
 * Tag: Feature: core-auth, Property 21: Secure Cookie Attributes
 *
 * @module utils/cookies.property.test
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  setAccessTokenCookie,
  setRefreshTokenCookie,
  setAuthCookies,
  clearAuthCookies,
  type CookieResponse,
  type CookieOptions,
} from './cookies.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Create a mock CookieResponse that captures all cookie operations. */
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

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Arbitrary non-empty token string. */
const tokenArb = fc.string({ minLength: 1, maxLength: 512 });

/** Arbitrary positive maxAge in milliseconds (1ms to 30 days). */
const maxAgeMsArb = fc.integer({ min: 1, max: 30 * 24 * 60 * 60 * 1000 });

// ─── Secure Attribute Assertions ─────────────────────────────────────────────

function assertSecureAttributes(options: CookieOptions | Omit<CookieOptions, 'maxAge'>): void {
  expect(options.httpOnly).toBe(true);
  expect(options.secure).toBe(true);
  expect(options.sameSite).toBe('strict');
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 21: Secure Cookie Attributes', () => {
  /**
   * **Validates: Requirements 2.3**
   *
   * For any token and maxAge, setAccessTokenCookie SHALL produce a cookie
   * with httpOnly=true, secure=true, and sameSite=strict.
   */
  it('setAccessTokenCookie always sets secure attributes', () => {
    fc.assert(
      fc.property(tokenArb, maxAgeMsArb, (token, maxAgeMs) => {
        const res = createMockResponse();
        setAccessTokenCookie(res, token, maxAgeMs);

        expect(res.cookieCalls).toHaveLength(1);
        assertSecureAttributes(res.cookieCalls[0]!.options);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 2.3**
   *
   * For any token and maxAge, setRefreshTokenCookie SHALL produce a cookie
   * with httpOnly=true, secure=true, and sameSite=strict.
   */
  it('setRefreshTokenCookie always sets secure attributes', () => {
    fc.assert(
      fc.property(tokenArb, maxAgeMsArb, (token, maxAgeMs) => {
        const res = createMockResponse();
        setRefreshTokenCookie(res, token, maxAgeMs);

        expect(res.cookieCalls).toHaveLength(1);
        assertSecureAttributes(res.cookieCalls[0]!.options);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 2.3**
   *
   * For any pair of tokens and maxAges, setAuthCookies SHALL produce
   * cookies that all have httpOnly=true, secure=true, and sameSite=strict.
   */
  it('setAuthCookies always sets secure attributes on both cookies', () => {
    fc.assert(
      fc.property(
        tokenArb,
        maxAgeMsArb,
        tokenArb,
        maxAgeMsArb,
        (accessToken, accessMaxAge, refreshToken, refreshMaxAge) => {
          const res = createMockResponse();
          setAuthCookies(res, accessToken, accessMaxAge, refreshToken, refreshMaxAge);

          expect(res.cookieCalls).toHaveLength(2);
          for (const call of res.cookieCalls) {
            assertSecureAttributes(call.options);
          }
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 2.3**
   *
   * clearAuthCookies SHALL use httpOnly=true, secure=true, and
   * sameSite=strict when clearing cookies, regardless of system state.
   */
  it('clearAuthCookies always uses secure attributes', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const res = createMockResponse();
        clearAuthCookies(res);

        expect(res.clearCookieCalls.length).toBeGreaterThan(0);
        for (const call of res.clearCookieCalls) {
          assertSecureAttributes(call.options);
        }
      }),
      { numRuns: 100, verbose: true },
    );
  });
});
