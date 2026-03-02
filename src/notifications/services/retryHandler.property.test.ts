/**
 * Property-Based Tests — Retry Handler
 *
 * Property 6: Retry Behavior
 * For any failed delivery attempt, retry SHALL occur with exponential backoff
 * up to 3 times before marking as failed.
 *
 * **Validates: Requirements 6.3**
 *
 * @module notifications/services/retryHandler.property.test
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createRetryHandler } from './retryHandler.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const arbMaxRetries = fc.integer({ min: 0, max: 5 });
const arbBaseDelayMs = fc.integer({ min: 1, max: 5000 });
const arbMaxDelayMs = fc.integer({ min: 1, max: 60000 });
const arbAttemptNumber = fc.integer({ min: 0, max: 10 });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RetryHandler — Property Tests', () => {
  /**
   * Property 6a: shouldRetry boundary
   *
   * shouldRetry returns true for attempts 0..maxRetries-1
   * and false for attempts >= maxRetries.
   *
   * **Validates: Requirements 6.3**
   */
  it('shouldRetry returns true below maxRetries and false at or above', () => {
    fc.assert(
      fc.property(arbMaxRetries, arbAttemptNumber, (maxRetries, attempt) => {
        const handler = createRetryHandler({ maxRetries });

        if (attempt < maxRetries) {
          expect(handler.shouldRetry(attempt)).toBe(true);
        } else {
          expect(handler.shouldRetry(attempt)).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Property 6b: Exponential backoff formula
   *
   * getDelay(attempt) === min(baseDelayMs * 2^attempt, maxDelayMs)
   *
   * **Validates: Requirements 6.3**
   */
  it('getDelay follows exponential backoff formula capped at maxDelayMs', () => {
    fc.assert(
      fc.property(
        arbBaseDelayMs,
        arbMaxDelayMs,
        arbAttemptNumber,
        (baseDelayMs, maxDelayMs, attempt) => {
          const handler = createRetryHandler({ baseDelayMs, maxDelayMs });

          const expected = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
          expect(handler.getDelay(attempt)).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Property 6c: Delay is monotonically non-decreasing up to the cap
   *
   * For consecutive attempts, getDelay(n+1) >= getDelay(n).
   *
   * **Validates: Requirements 6.3**
   */
  it('getDelay is monotonically non-decreasing', () => {
    fc.assert(
      fc.property(
        arbBaseDelayMs,
        arbMaxDelayMs,
        fc.integer({ min: 0, max: 9 }),
        (baseDelayMs, maxDelayMs, attempt) => {
          const handler = createRetryHandler({ baseDelayMs, maxDelayMs });

          const current = handler.getDelay(attempt);
          const next = handler.getDelay(attempt + 1);
          expect(next).toBeGreaterThanOrEqual(current);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Property 6d: executeWithRetry — eventual success
   *
   * When a function fails `failCount` times then succeeds,
   * executeWithRetry calls it exactly (failCount + 1) times
   * if failCount <= maxRetries.
   *
   * **Validates: Requirements 6.3**
   */
  it('executeWithRetry calls fn (failures + 1) times on eventual success', async () => {
    await fc.assert(
      fc.asyncProperty(arbMaxRetries, async (maxRetries) => {
        // Pick a failCount in [0, maxRetries] so it eventually succeeds
        const failCount = maxRetries > 0 ? Math.floor(Math.random() * (maxRetries + 1)) : 0;

        const handler = createRetryHandler({
          maxRetries,
          baseDelayMs: 1,
          maxDelayMs: 10,
        });

        let callCount = 0;
        const fn = async (): Promise<string> => {
          callCount++;
          if (callCount <= failCount) {
            throw new Error(`fail #${callCount}`);
          }
          return 'ok';
        };

        const result = await handler.executeWithRetry(fn);

        expect(result).toBe('ok');
        expect(callCount).toBe(failCount + 1);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 6e: executeWithRetry — permanent failure
   *
   * When a function always fails, executeWithRetry calls it
   * exactly (maxRetries + 1) times then throws.
   *
   * **Validates: Requirements 6.3**
   */
  it('executeWithRetry calls fn (maxRetries + 1) times on permanent failure', async () => {
    await fc.assert(
      fc.asyncProperty(arbMaxRetries, async (maxRetries) => {
        const handler = createRetryHandler({
          maxRetries,
          baseDelayMs: 1,
          maxDelayMs: 10,
        });

        let callCount = 0;
        const fn = async (): Promise<string> => {
          callCount++;
          throw new Error('always fails');
        };

        await expect(handler.executeWithRetry(fn)).rejects.toThrow('always fails');
        expect(callCount).toBe(maxRetries + 1);
      }),
      { numRuns: 100 },
    );
  });
});
