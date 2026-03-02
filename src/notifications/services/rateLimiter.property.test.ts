/**
 * Property-Based Tests — Rate Limiter
 *
 * Property 3: Rate Limit Compliance
 * For any user, the number of email notifications delivered per day
 * SHALL NOT exceed the configured limit (10), excluding security notifications.
 *
 * **Validates: Requirements 11.1, 11.5**
 *
 * @module notifications/services/rateLimiter.property.test
 */

import * as fc from 'fast-check';
import type { Redis } from 'ioredis';
import { beforeEach, describe, expect, it } from 'vitest';

import { createMockRedis, type MockRedis } from '../test/index.js';
import type { NotificationCategory } from '../types/index.js';

import { createRateLimiter, type RateLimiter } from './rateLimiter.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Augment MockRedis with `exists` method required by the rate limiter.
 * The shared mock doesn't include it, so we add it here.
 */
function augmentWithExists(mock: MockRedis): MockRedis & { exists(key: string): Promise<number> } {
  const augmented = mock as MockRedis & { exists(key: string): Promise<number> };
  augmented.exists = async (key: string): Promise<number> => {
    const val = await mock.get(key);
    return val !== null ? 1 : 0;
  };
  return augmented;
}

const NON_SECURITY_CATEGORIES: NotificationCategory[] = [
  'transactions',
  'insights',
  'compliance',
  'system',
  'marketing',
];

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const arbDeliveryCount = fc.integer({ min: 0, max: 20 });
const arbNonSecurityCategory = fc.constantFrom(...NON_SECURITY_CATEGORIES);
const arbUserId = fc.uuid();

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RateLimiter — Property Tests', () => {
  let redis: ReturnType<typeof augmentWithExists>;
  let limiter: RateLimiter;

  beforeEach(() => {
    redis = augmentWithExists(createMockRedis());
    limiter = createRateLimiter(redis as unknown as Redis);
  });

  /**
   * Property 3a: Email rate limit enforcement
   *
   * For any number of email deliveries, checkLimit returns allowed=true
   * when under 10, and allowed=false at 10 or above.
   *
   * **Validates: Requirements 11.1, 11.5**
   */
  it('email: allowed when under 10 deliveries, blocked at 10+', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserId,
        arbDeliveryCount,
        arbNonSecurityCategory,
        async (userId, deliveries, category) => {
          redis.clear();

          // Record N deliveries
          for (let i = 0; i < deliveries; i++) {
            await limiter.recordDelivery(userId, 'email');
          }

          const result = await limiter.checkLimit(userId, 'email', category);

          if (deliveries < 10) {
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(10 - deliveries);
          } else {
            expect(result.allowed).toBe(false);
            expect(result.remaining).toBe(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 3b: Security notifications bypass all rate limits
   *
   * Security notifications are always allowed regardless of how many
   * deliveries have been recorded.
   *
   * **Validates: Requirements 11.1, 11.5**
   */
  it('security notifications always bypass rate limits', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserId,
        arbDeliveryCount,
        fc.constantFrom('email' as const, 'push' as const),
        async (userId, deliveries, channel) => {
          redis.clear();

          for (let i = 0; i < deliveries; i++) {
            await limiter.recordDelivery(userId, channel);
          }

          const result = await limiter.checkLimit(userId, channel, 'security');

          expect(result.allowed).toBe(true);
          expect(result.remaining).toBe(Infinity);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 3c: In-app notifications have no rate limit
   *
   * In-app notifications are always allowed regardless of delivery count.
   *
   * **Validates: Requirements 11.1, 11.5**
   */
  it('in-app notifications are always allowed regardless of count', async () => {
    await fc.assert(
      fc.asyncProperty(arbUserId, arbNonSecurityCategory, async (userId, category) => {
        redis.clear();

        const result = await limiter.checkLimit(userId, 'in_app', category);

        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(Infinity);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 3d: Push rate limit enforcement
   *
   * For any number of push deliveries, checkLimit returns allowed=true
   * when under 5, and allowed=false at 5 or above.
   *
   * **Validates: Requirements 11.1, 11.5**
   */
  it('push: allowed when under 5 deliveries, blocked at 5+', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserId,
        arbDeliveryCount,
        arbNonSecurityCategory,
        async (userId, deliveries, category) => {
          redis.clear();

          for (let i = 0; i < deliveries; i++) {
            await limiter.recordDelivery(userId, 'push');
          }

          const result = await limiter.checkLimit(userId, 'push', category);

          if (deliveries < 5) {
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(5 - deliveries);
          } else {
            expect(result.allowed).toBe(false);
            expect(result.remaining).toBe(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 3e: getRemainingQuota decreases correctly after each delivery
   *
   * After recording N deliveries, getRemainingQuota returns max(0, limit - N).
   *
   * **Validates: Requirements 11.1, 11.5**
   */
  it('getRemainingQuota decreases correctly after each recordDelivery', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserId,
        arbDeliveryCount,
        fc.constantFrom('email' as const, 'push' as const),
        async (userId, deliveries, channel) => {
          redis.clear();

          const limit = channel === 'email' ? 10 : 5;

          for (let i = 0; i < deliveries; i++) {
            await limiter.recordDelivery(userId, channel);
          }

          const remaining = await limiter.getRemainingQuota(userId, channel);
          expect(remaining).toBe(Math.max(0, limit - deliveries));
        },
      ),
      { numRuns: 100 },
    );
  });
});
