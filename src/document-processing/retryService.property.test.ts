/**
 * Property-based tests for the retry service with exponential backoff.
 *
 * **Feature: document-processing, Property 17: Retry Behavior with Exponential Backoff**
 *
 * For any processing job that fails, the system SHALL retry up to 3 times.
 * For any retry attempt N (where N is 1, 2, or 3), the delay before retry
 * SHALL follow exponential backoff. For any document where all 3 retry
 * attempts have failed, the status SHALL be ERROR/FAILED.
 *
 * **Validates: Requirements 11.5, 11.6**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  BASE_BACKOFF_DELAY_MS,
  buildRetryState,
  calculateBackoffDelay,
  MAX_RETRY_ATTEMPTS,
  shouldRetry,
} from './retryService.js';
import type { ProcessingJob } from './types.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid 1-based attempt number. */
const attemptArb = fc.integer({ min: 1, max: 10 });

/** Generate an attempts count (0-based, how many attempts already made). */
const attemptsCountArb = fc.integer({ min: 0, max: 100 });

/** Generate a non-empty error message. */
const errorMessageArb = fc.string({ minLength: 1, maxLength: 100 });

/** Generate a custom maxAttempts value. */
const maxAttemptsArb = fc.integer({ min: 1, max: 10 });

/** Build a ProcessingJob with configurable overrides. */
function makeJob(overrides: Partial<ProcessingJob> = {}): ProcessingJob {
  return {
    id: 'job-001',
    documentId: 'doc-001',
    status: 'ACTIVE',
    attempts: 0,
    maxAttempts: MAX_RETRY_ATTEMPTS,
    lastError: null,
    nextRetryAt: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Retry Behavior with Exponential Backoff (Property 17)', () => {
  /**
   * Property 17.1: Exponential growth of backoff delay.
   *
   * For any attempt number 1..MAX_RETRY_ATTEMPTS, calculateBackoffDelay(attempt)
   * equals BASE_BACKOFF_DELAY_MS * 2^(attempt - 1).
   *
   * **Validates: Requirements 11.5**
   */
  it('backoff delay equals baseDelay * 2^(attempt-1) for any attempt', () => {
    fc.assert(
      fc.property(attemptArb, (attempt) => {
        const delay = calculateBackoffDelay(attempt);
        const expected = BASE_BACKOFF_DELAY_MS * Math.pow(2, attempt - 1);
        expect(delay).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 17.2: shouldRetry returns true when attempts < maxAttempts,
   * false when attempts >= maxAttempts.
   *
   * **Validates: Requirements 11.5**
   */
  it('shouldRetry is true iff attempts < maxAttempts', () => {
    fc.assert(
      fc.property(attemptsCountArb, maxAttemptsArb, (attempts, maxAttempts) => {
        const result = shouldRetry(attempts, maxAttempts);
        if (attempts < maxAttempts) {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 17.3: buildRetryState returns RETRYING with non-null nextRetryAt
   * when the job has remaining retries (attempts < maxAttempts - 1).
   *
   * **Validates: Requirements 11.5**
   */
  it('buildRetryState returns RETRYING with nextRetryAt when retries remain', () => {
    fc.assert(
      fc.property(
        maxAttemptsArb.filter((m) => m >= 2),
        errorMessageArb,
        (maxAttempts, error) => {
          // Pick an attempts value where after incrementing, retries still remain
          // i.e. attempts + 1 < maxAttempts → attempts < maxAttempts - 1
          const attemptsArb = fc.integer({ min: 0, max: maxAttempts - 2 });
          fc.assert(
            fc.property(attemptsArb, (attempts) => {
              const job = makeJob({ attempts, maxAttempts });
              const result = buildRetryState(job, error);

              expect(result.status).toBe('RETRYING');
              expect(result.nextRetryAt).not.toBeNull();
              expect(result.attempts).toBe(attempts + 1);
              expect(result.lastError).toBe(error);
            }),
            { numRuns: 20 },
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 17.4: buildRetryState returns FAILED with null nextRetryAt
   * when the job is on its last attempt (attempts = maxAttempts - 1).
   *
   * **Validates: Requirements 11.5, 11.6**
   */
  it('buildRetryState returns FAILED with null nextRetryAt on last attempt', () => {
    fc.assert(
      fc.property(maxAttemptsArb, errorMessageArb, (maxAttempts, error) => {
        const job = makeJob({ attempts: maxAttempts - 1, maxAttempts });
        const result = buildRetryState(job, error);

        expect(result.status).toBe('FAILED');
        expect(result.nextRetryAt).toBeNull();
        expect(result.attempts).toBe(maxAttempts);
        expect(result.lastError).toBe(error);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 17.5: After exactly MAX_RETRY_ATTEMPTS sequential failures
   * applied to a fresh job, the job status is FAILED.
   *
   * **Validates: Requirements 11.5, 11.6**
   */
  it('after MAX_RETRY_ATTEMPTS failures a fresh job is FAILED', () => {
    fc.assert(
      fc.property(
        fc.array(errorMessageArb, {
          minLength: MAX_RETRY_ATTEMPTS,
          maxLength: MAX_RETRY_ATTEMPTS,
        }),
        (errors) => {
          let job = makeJob({ attempts: 0, maxAttempts: MAX_RETRY_ATTEMPTS });

          for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
            job = buildRetryState(job, errors[i] as string);

            if (i < MAX_RETRY_ATTEMPTS - 1) {
              expect(job.status).toBe('RETRYING');
            } else {
              expect(job.status).toBe('FAILED');
              expect(job.nextRetryAt).toBeNull();
            }
          }

          expect(job.attempts).toBe(MAX_RETRY_ATTEMPTS);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 17.6: Backoff delays are strictly increasing.
   * For any attempt N, delay(N+1) > delay(N).
   *
   * **Validates: Requirements 11.5**
   */
  it('backoff delays are strictly increasing across consecutive attempts', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9 }), (attempt) => {
        const delayN = calculateBackoffDelay(attempt);
        const delayN1 = calculateBackoffDelay(attempt + 1);
        expect(delayN1).toBeGreaterThan(delayN);
      }),
      { numRuns: 100 },
    );
  });
});
