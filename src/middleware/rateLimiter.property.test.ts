/**
 * Property-based tests for the Redis-backed sliding window rate limiter.
 *
 * Property 14: Rate Limiting Enforcement
 * Property 15: Rate Limit Independence
 *
 * Uses a functional mock Redis that simulates sorted-set operations
 * so the Lua script logic is exercised realistically.
 *
 * @module middleware/rateLimiter.property.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  checkLimit,
  passwordLoginKey,
  magicLinkKey,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_WINDOW_SECONDS,
} from './rateLimiter.js';
import { ipv4Arb } from '../test/arbitraries.js';
import type Redis from 'ioredis';

// ─── Functional Mock Redis ───────────────────────────────────────────────────

/**
 * Creates a mock Redis that faithfully simulates sorted-set operations
 * used by the rate limiter's Lua script. Maintains an in-memory map of
 * sorted sets keyed by Redis key name.
 */
function createFunctionalMockRedis() {
  const store = new Map<string, { score: number; member: string }[]>();

  function getSet(key: string) {
    if (!store.has(key)) store.set(key, []);
    return store.get(key)!;
  }

  /**
   * Simulates the Lua script executed by checkLimit:
   * 1. ZREMRANGEBYSCORE to prune expired entries
   * 2. ZCARD to count remaining
   * 3. If count < limit, ZADD new entry
   * 4. EXPIRE (no-op in mock)
   * 5. Return count before potential add
   */
  const evalFn = async (
    _script: string,
    _numKeys: number,
    key: string,
    windowStart: string,
    limit: string,
    now: string,
    member: string,
    _windowSeconds: string,
  ): Promise<number> => {
    const set = getSet(key);
    const windowStartNum = Number(windowStart);
    const limitNum = Number(limit);
    const nowNum = Number(now);

    // Prune expired entries
    const pruned = set.filter((e) => e.score > windowStartNum);
    store.set(key, pruned);

    const count = pruned.length;

    if (count < limitNum) {
      pruned.push({ score: nowNum, member });
    }

    return count;
  };

  const redis = {
    eval: evalFn,
    zremrangebyscore: async () => 0,
    zcard: async () => 0,
    del: async (key: string) => {
      store.delete(key);
      return 1;
    },
  } as unknown as Redis;

  return { redis, store };
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('rateLimiter – property tests', () => {
  /**
   * Feature: core-auth, Property 14: Rate Limiting Enforcement
   *
   * For any IP address, after 5 failed login attempts within a 15-minute
   * window, subsequent login attempts SHALL be rejected until the window
   * expires.
   *
   * **Validates: Requirements 7.1, 7.2**
   */
  describe('Property 14: Rate Limiting Enforcement', () => {
    it('should allow exactly DEFAULT_MAX_ATTEMPTS requests then reject subsequent ones', async () => {
      await fc.assert(
        fc.asyncProperty(ipv4Arb, async (ip) => {
          const { redis } = createFunctionalMockRedis();
          const key = passwordLoginKey(ip);

          // First DEFAULT_MAX_ATTEMPTS requests should all be allowed
          for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) {
            const result = await checkLimit(
              redis,
              key,
              DEFAULT_MAX_ATTEMPTS,
              DEFAULT_WINDOW_SECONDS,
            );
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(DEFAULT_MAX_ATTEMPTS - i - 1);
          }

          // The next request should be rejected
          const rejected = await checkLimit(
            redis,
            key,
            DEFAULT_MAX_ATTEMPTS,
            DEFAULT_WINDOW_SECONDS,
          );
          expect(rejected.allowed).toBe(false);
          expect(rejected.remaining).toBe(0);
        }),
        { numRuns: 100 },
      );
    });

    it('should keep rejecting after the limit is exhausted', async () => {
      await fc.assert(
        fc.asyncProperty(ipv4Arb, fc.integer({ min: 1, max: 10 }), async (ip, extraAttempts) => {
          const { redis } = createFunctionalMockRedis();
          const key = passwordLoginKey(ip);

          // Exhaust the limit
          for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) {
            await checkLimit(redis, key, DEFAULT_MAX_ATTEMPTS, DEFAULT_WINDOW_SECONDS);
          }

          // All extra attempts should be rejected
          for (let i = 0; i < extraAttempts; i++) {
            const result = await checkLimit(
              redis,
              key,
              DEFAULT_MAX_ATTEMPTS,
              DEFAULT_WINDOW_SECONDS,
            );
            expect(result.allowed).toBe(false);
            expect(result.remaining).toBe(0);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('should provide a resetAt date in the future', async () => {
      await fc.assert(
        fc.asyncProperty(ipv4Arb, async (ip) => {
          const { redis } = createFunctionalMockRedis();
          const key = passwordLoginKey(ip);

          // Exhaust the limit
          for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) {
            await checkLimit(redis, key, DEFAULT_MAX_ATTEMPTS, DEFAULT_WINDOW_SECONDS);
          }

          const before = Date.now();
          const rejected = await checkLimit(
            redis,
            key,
            DEFAULT_MAX_ATTEMPTS,
            DEFAULT_WINDOW_SECONDS,
          );
          expect(rejected.allowed).toBe(false);
          expect(rejected.resetAt.getTime()).toBeGreaterThanOrEqual(before);
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Feature: core-auth, Property 15: Rate Limit Independence
   *
   * For any IP address, rate limits for password login and magic link
   * requests SHALL be tracked independently, such that exhausting one
   * limit does not affect the other.
   *
   * **Validates: Requirements 7.3**
   */
  describe('Property 15: Rate Limit Independence', () => {
    it('exhausting password limit should not affect magic link limit', async () => {
      await fc.assert(
        fc.asyncProperty(ipv4Arb, async (ip) => {
          const { redis } = createFunctionalMockRedis();
          const pwKey = passwordLoginKey(ip);
          const mlKey = magicLinkKey(ip);

          // Exhaust password login limit
          for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) {
            await checkLimit(redis, pwKey, DEFAULT_MAX_ATTEMPTS, DEFAULT_WINDOW_SECONDS);
          }

          // Password should be blocked
          const pwResult = await checkLimit(
            redis,
            pwKey,
            DEFAULT_MAX_ATTEMPTS,
            DEFAULT_WINDOW_SECONDS,
          );
          expect(pwResult.allowed).toBe(false);

          // Magic link should still have full capacity
          for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) {
            const mlResult = await checkLimit(
              redis,
              mlKey,
              DEFAULT_MAX_ATTEMPTS,
              DEFAULT_WINDOW_SECONDS,
            );
            expect(mlResult.allowed).toBe(true);
            expect(mlResult.remaining).toBe(DEFAULT_MAX_ATTEMPTS - i - 1);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('exhausting magic link limit should not affect password limit', async () => {
      await fc.assert(
        fc.asyncProperty(ipv4Arb, async (ip) => {
          const { redis } = createFunctionalMockRedis();
          const pwKey = passwordLoginKey(ip);
          const mlKey = magicLinkKey(ip);

          // Exhaust magic link limit
          for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) {
            await checkLimit(redis, mlKey, DEFAULT_MAX_ATTEMPTS, DEFAULT_WINDOW_SECONDS);
          }

          // Magic link should be blocked
          const mlResult = await checkLimit(
            redis,
            mlKey,
            DEFAULT_MAX_ATTEMPTS,
            DEFAULT_WINDOW_SECONDS,
          );
          expect(mlResult.allowed).toBe(false);

          // Password should still have full capacity
          for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) {
            const pwResult = await checkLimit(
              redis,
              pwKey,
              DEFAULT_MAX_ATTEMPTS,
              DEFAULT_WINDOW_SECONDS,
            );
            expect(pwResult.allowed).toBe(true);
            expect(pwResult.remaining).toBe(DEFAULT_MAX_ATTEMPTS - i - 1);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('interleaved attempts on both endpoints should track independently', async () => {
      await fc.assert(
        fc.asyncProperty(
          ipv4Arb,
          fc.integer({ min: 1, max: DEFAULT_MAX_ATTEMPTS }),
          fc.integer({ min: 1, max: DEFAULT_MAX_ATTEMPTS }),
          async (ip, pwAttempts, mlAttempts) => {
            const { redis } = createFunctionalMockRedis();
            const pwKey = passwordLoginKey(ip);
            const mlKey = magicLinkKey(ip);

            // Make pwAttempts on password endpoint
            for (let i = 0; i < pwAttempts; i++) {
              const r = await checkLimit(
                redis,
                pwKey,
                DEFAULT_MAX_ATTEMPTS,
                DEFAULT_WINDOW_SECONDS,
              );
              expect(r.allowed).toBe(true);
            }

            // Make mlAttempts on magic link endpoint
            for (let i = 0; i < mlAttempts; i++) {
              const r = await checkLimit(
                redis,
                mlKey,
                DEFAULT_MAX_ATTEMPTS,
                DEFAULT_WINDOW_SECONDS,
              );
              expect(r.allowed).toBe(true);
            }

            // Verify remaining counts are independent
            // Next password attempt should reflect only password usage
            const nextPw = await checkLimit(
              redis,
              pwKey,
              DEFAULT_MAX_ATTEMPTS,
              DEFAULT_WINDOW_SECONDS,
            );
            if (pwAttempts < DEFAULT_MAX_ATTEMPTS) {
              expect(nextPw.allowed).toBe(true);
              expect(nextPw.remaining).toBe(DEFAULT_MAX_ATTEMPTS - pwAttempts - 1);
            } else {
              expect(nextPw.allowed).toBe(false);
            }

            // Next magic link attempt should reflect only magic link usage
            const nextMl = await checkLimit(
              redis,
              mlKey,
              DEFAULT_MAX_ATTEMPTS,
              DEFAULT_WINDOW_SECONDS,
            );
            if (mlAttempts < DEFAULT_MAX_ATTEMPTS) {
              expect(nextMl.allowed).toBe(true);
              expect(nextMl.remaining).toBe(DEFAULT_MAX_ATTEMPTS - mlAttempts - 1);
            } else {
              expect(nextMl.allowed).toBe(false);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
