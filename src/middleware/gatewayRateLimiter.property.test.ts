/**
 * Property-based tests for the API Gateway rate limiter.
 *
 * **Property 1: Rate Limit Accuracy**
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
 *
 * "For any rate-limited endpoint, requests exceeding the limit SHALL be
 * rejected with 429 status within the configured window."
 *
 * Properties tested:
 * 1. Requests at or above the limit are always rejected
 * 2. Requests below the limit are always allowed
 * 3. Remaining count is always non-negative and never exceeds the limit
 * 4. When rate limited, retryAfter is always > 0
 * 5. IP key generation is deterministic
 * 6. User key generation is deterministic
 *
 * @module middleware/gatewayRateLimiter.property.test
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import type Redis from 'ioredis';

import { checkRateLimit, buildIPKey, buildUserKey } from './gatewayRateLimiter.js';
import type { RateLimit } from '../gateway/types.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate a valid rate limit config: requests 1–1000, window 1–3600s. */
const arbRateLimit: fc.Arbitrary<RateLimit> = fc.record({
  requests: fc.integer({ min: 1, max: 1000 }),
  window: fc.integer({ min: 1, max: 3600 }),
  keyPrefix: fc.constant('gw:rl:test:'),
});

/**
 * Generate a rate limit config paired with a count at or above the limit.
 * Uses chain to produce dependent values.
 */
const arbLimitWithCountAtOrAbove: fc.Arbitrary<{ limit: RateLimit; count: number }> =
  arbRateLimit.chain((limit) =>
    fc.integer({ min: limit.requests, max: limit.requests + 1000 }).map((count) => ({
      limit,
      count,
    })),
  );

/**
 * Generate a rate limit config paired with a count strictly below the limit.
 */
const arbLimitWithCountBelow: fc.Arbitrary<{ limit: RateLimit; count: number }> =
  arbRateLimit.chain((limit) =>
    fc.integer({ min: 0, max: limit.requests - 1 }).map((count) => ({
      limit,
      count,
    })),
  );

/** Generate a valid IPv4 address. */
const arbIPv4: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

/** Generate a non-empty user ID string. */
const arbUserId: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
  { minLength: 1, maxLength: 64 },
);

// ─── Mock Redis Factory ──────────────────────────────────────────────────────

function createMockRedis(evalResult: number): Redis {
  return {
    eval: vi.fn().mockResolvedValue(evalResult),
  } as unknown as Redis;
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('gatewayRateLimiter — property tests', () => {
  describe('Property 1.1: Requests at or above the limit are always rejected', () => {
    it('should reject when current count >= limit', async () => {
      await fc.assert(
        fc.asyncProperty(arbLimitWithCountAtOrAbove, async ({ limit, count }) => {
          const redis = createMockRedis(count);
          const result = await checkRateLimit(redis, 'gw:rl:test:key', limit);

          expect(result.allowed).toBe(false);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('Property 1.2: Requests below the limit are always allowed', () => {
    it('should allow when current count < limit', async () => {
      await fc.assert(
        fc.asyncProperty(arbLimitWithCountBelow, async ({ limit, count }) => {
          const redis = createMockRedis(count);
          const result = await checkRateLimit(redis, 'gw:rl:test:key', limit);

          expect(result.allowed).toBe(true);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('Property 1.3: Remaining count is non-negative and never exceeds the limit', () => {
    it('should have 0 <= remaining <= limit for any count', async () => {
      await fc.assert(
        fc.asyncProperty(arbRateLimit, fc.integer({ min: 0, max: 2000 }), async (limit, count) => {
          const redis = createMockRedis(count);
          const result = await checkRateLimit(redis, 'gw:rl:test:key', limit);

          expect(result.remaining).toBeGreaterThanOrEqual(0);
          expect(result.remaining).toBeLessThanOrEqual(limit.requests);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('Property 1.4: When rate limited, retryAfter is always > 0', () => {
    it('should include retryAfter > 0 on rejected requests', async () => {
      await fc.assert(
        fc.asyncProperty(arbLimitWithCountAtOrAbove, async ({ limit, count }) => {
          const redis = createMockRedis(count);
          const result = await checkRateLimit(redis, 'gw:rl:test:key', limit);

          expect(result.allowed).toBe(false);
          expect(result.retryAfter).toBeDefined();
          expect(result.retryAfter).toBeGreaterThan(0);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('Property 1.5: IP key generation is deterministic', () => {
    it('same IP always produces the same key', () => {
      fc.assert(
        fc.property(arbIPv4, (ip) => {
          const prefix = 'gw:rl:ip:';
          const key1 = buildIPKey(prefix, ip);
          const key2 = buildIPKey(prefix, ip);

          expect(key1).toBe(key2);
          expect(key1).toBe(`${prefix}${ip}`);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('Property 1.6: User key generation is deterministic', () => {
    it('same userId always produces the same key', () => {
      fc.assert(
        fc.property(arbUserId, (userId) => {
          const prefix = 'gw:rl:user:';
          const key1 = buildUserKey(prefix, userId);
          const key2 = buildUserKey(prefix, userId);

          expect(key1).toBe(key2);
          expect(key1).toBe(`${prefix}${userId}`);
        }),
        { numRuns: 200 },
      );
    });
  });
});
