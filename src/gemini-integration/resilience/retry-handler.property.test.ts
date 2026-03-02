// Gemini Integration - Property tests for retry behavior
// **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6**

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  GeminiServiceError,
  QuotaExceededError,
  RateLimitError,
  TimeoutError,
  ValidationError,
} from '../types/errors.js';

import { executeWithRetry } from './retry-handler.js';

/**
 * Property 13: Retry Exponential Backoff
 *
 * For any sequence of retry attempts, the delay between attempt N and N+1
 * SHALL be approximately (initialDelay × 2^N) + jitter,
 * where jitter is in range [0, jitterMs).
 *
 * **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
 */
describe('Property 13: Retry Exponential Backoff', () => {
  it('delays follow exact exponential pattern when jitter is 0', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 10, max: 500 }),
        fc.constantFrom(2, 3, 4),
        async (maxRetries, initialDelayMs, backoffMultiplier) => {
          const delays: number[] = [];
          const trackingDelay = async (ms: number): Promise<void> => {
            delays.push(ms);
          };

          const fn = (): Promise<never> => {
            throw new TimeoutError('timeout', 5000);
          };

          try {
            await executeWithRetry(fn, {
              maxRetries,
              initialDelayMs,
              backoffMultiplier,
              jitterMs: 0,
              maxDelayMs: 1_000_000,
              delayFn: trackingDelay,
            });
          } catch {
            // expected
          }

          expect(delays).toHaveLength(maxRetries);

          for (let i = 0; i < delays.length; i++) {
            const expectedDelay = initialDelayMs * Math.pow(backoffMultiplier, i);
            expect(delays[i]).toBe(expectedDelay);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('delays include jitter within [base, base + jitterMs) when jitterMs > 0', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 10, max: 200 }),
        fc.integer({ min: 1, max: 500 }),
        async (maxRetries, initialDelayMs, jitterMs) => {
          const delays: number[] = [];
          const trackingDelay = async (ms: number): Promise<void> => {
            delays.push(ms);
          };

          const fn = (): Promise<never> => {
            throw new TimeoutError('timeout', 5000);
          };

          try {
            await executeWithRetry(fn, {
              maxRetries,
              initialDelayMs,
              backoffMultiplier: 2,
              jitterMs,
              maxDelayMs: 1_000_000,
              delayFn: trackingDelay,
            });
          } catch {
            // expected
          }

          expect(delays).toHaveLength(maxRetries);

          for (let i = 0; i < delays.length; i++) {
            const baseDelay = initialDelayMs * Math.pow(2, i);
            expect(delays[i]).toBeGreaterThanOrEqual(baseDelay);
            expect(delays[i]).toBeLessThan(baseDelay + jitterMs);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('delays are capped at maxDelayMs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 100, max: 500 }),
        fc.integer({ min: 200, max: 1000 }),
        async (maxRetries, initialDelayMs, maxDelayMs) => {
          const delays: number[] = [];
          const trackingDelay = async (ms: number): Promise<void> => {
            delays.push(ms);
          };

          const fn = (): Promise<never> => {
            throw new TimeoutError('timeout', 5000);
          };

          try {
            await executeWithRetry(fn, {
              maxRetries,
              initialDelayMs,
              backoffMultiplier: 2,
              jitterMs: 0,
              maxDelayMs,
              delayFn: trackingDelay,
            });
          } catch {
            // expected
          }

          for (const delay of delays) {
            expect(delay).toBeLessThanOrEqual(maxDelayMs);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 14: Non-Transient Error No Retry
 *
 * For any non-transient error (ValidationError, QuotaExceededError),
 * the service SHALL NOT retry and SHALL return the error immediately.
 *
 * **Validates: Requirements 7.5**
 */
describe('Property 14: Non-Transient Error No Retry', () => {
  it('non-retryable errors are never retried regardless of retry config', async () => {
    const nonTransientErrorArb = fc.oneof(
      fc.record({
        type: fc.constant('validation' as const),
        message: fc.string({ minLength: 1, maxLength: 50 }),
        field: fc.string({ minLength: 1, maxLength: 20 }),
      }),
      fc.record({
        type: fc.constant('quota' as const),
        message: fc.string({ minLength: 1, maxLength: 50 }),
      }),
    );

    await fc.assert(
      fc.asyncProperty(
        nonTransientErrorArb,
        fc.integer({ min: 1, max: 10 }),
        async (errorDef, maxRetries) => {
          let callCount = 0;

          const error =
            errorDef.type === 'validation'
              ? new ValidationError(errorDef.message, errorDef.field)
              : new QuotaExceededError(errorDef.message);

          const fn = (): Promise<never> => {
            callCount++;
            throw error;
          };

          const noDelay = async (): Promise<void> => {};

          try {
            await executeWithRetry(fn, {
              maxRetries,
              delayFn: noDelay,
            });
          } catch (caught) {
            expect(caught).toBe(error);
          }

          // Function should be called exactly once — no retries
          expect(callCount).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('non-retryable GeminiServiceError with retryable=false is not retried', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 5 }),
        async (message, code, maxRetries) => {
          let callCount = 0;

          const error = new GeminiServiceError(message, code, false);

          const fn = (): Promise<never> => {
            callCount++;
            throw error;
          };

          const noDelay = async (): Promise<void> => {};

          try {
            await executeWithRetry(fn, { maxRetries, delayFn: noDelay });
          } catch {
            // expected
          }

          expect(callCount).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 15: Retry Exhaustion Error Reporting
 *
 * For any operation that exhausts all retries, the returned error
 * SHALL include the retry count and the last error encountered.
 *
 * **Validates: Requirements 7.6**
 */
describe('Property 15: Retry Exhaustion Error Reporting', () => {
  it('exhausted GeminiServiceError includes retryAttempts and exhaustedRetries in context', async () => {
    const retryableErrorArb = fc.oneof(
      fc.record({
        type: fc.constant('timeout' as const),
        message: fc.string({ minLength: 1, maxLength: 50 }),
        timeoutMs: fc.integer({ min: 1000, max: 30000 }),
      }),
      fc.record({
        type: fc.constant('rateLimit' as const),
        message: fc.string({ minLength: 1, maxLength: 50 }),
        retryAfterMs: fc.integer({ min: 100, max: 5000 }),
      }),
    );

    await fc.assert(
      fc.asyncProperty(
        retryableErrorArb,
        fc.integer({ min: 0, max: 5 }),
        async (errorDef, maxRetries) => {
          const error =
            errorDef.type === 'timeout'
              ? new TimeoutError(errorDef.message, errorDef.timeoutMs)
              : new RateLimitError(errorDef.message, errorDef.retryAfterMs);

          const fn = (): Promise<never> => {
            throw error;
          };

          const noDelay = async (): Promise<void> => {};

          try {
            await executeWithRetry(fn, { maxRetries, delayFn: noDelay });
            expect.unreachable('should have thrown');
          } catch (caught) {
            expect(caught).toBeInstanceOf(GeminiServiceError);
            const err = caught as GeminiServiceError;
            expect(err.context).toBeDefined();
            expect(err.context?.retryAttempts).toBe(maxRetries);
            expect(err.context?.exhaustedRetries).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('exhausted plain Error is wrapped with retry context', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 0, max: 5 }),
        async (message, maxRetries) => {
          const fn = (): Promise<never> => {
            throw new Error(message);
          };

          const noDelay = async (): Promise<void> => {};

          try {
            await executeWithRetry(fn, { maxRetries, delayFn: noDelay });
            expect.unreachable('should have thrown');
          } catch (caught) {
            expect(caught).toBeInstanceOf(GeminiServiceError);
            const err = caught as GeminiServiceError;
            expect(err.code).toBe('RETRY_EXHAUSTED');
            expect(err.context).toBeDefined();
            expect(err.context?.retryAttempts).toBe(maxRetries);
            expect(err.context?.exhaustedRetries).toBe(true);
            expect(err.context?.originalError).toBe('Error');
            expect(err.cause).toBeInstanceOf(Error);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
