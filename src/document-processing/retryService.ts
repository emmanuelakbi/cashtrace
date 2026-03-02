/**
 * Retry service for document processing with exponential backoff.
 *
 * Provides pure functions for calculating backoff delays, determining
 * retry eligibility, and tracking retry state on ProcessingJob records.
 *
 * Requirements: 11.5, 11.6
 * @module document-processing/retryService
 */

import type { JobStatus, ProcessingJob } from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum number of retry attempts before marking as ERROR. */
export const MAX_RETRY_ATTEMPTS = 3;

/** Base delay in milliseconds for exponential backoff (1 second). */
export const BASE_BACKOFF_DELAY_MS = 1000;

// ─── Backoff Calculation ─────────────────────────────────────────────────────

/**
 * Calculate the exponential backoff delay for a given attempt number.
 *
 * Formula: `baseDelay * 2^(attempt - 1)`
 * - Attempt 1 → 1000ms
 * - Attempt 2 → 2000ms
 * - Attempt 3 → 4000ms
 *
 * @param attempt - The 1-based attempt number (must be >= 1)
 * @param baseDelay - Base delay in milliseconds (defaults to BASE_BACKOFF_DELAY_MS)
 * @returns The backoff delay in milliseconds
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelay: number = BASE_BACKOFF_DELAY_MS,
): number {
  if (attempt < 1) {
    return baseDelay;
  }
  return baseDelay * Math.pow(2, attempt - 1);
}

// ─── Retry Eligibility ──────────────────────────────────────────────────────

/**
 * Determine whether a job should be retried based on its attempt count.
 *
 * @param attempts - The number of attempts already made
 * @param maxAttempts - Maximum allowed attempts (defaults to MAX_RETRY_ATTEMPTS)
 * @returns true if the job has remaining retry attempts
 */
export function shouldRetry(attempts: number, maxAttempts: number = MAX_RETRY_ATTEMPTS): boolean {
  return attempts < maxAttempts;
}

// ─── Retry State Tracking ────────────────────────────────────────────────────

/**
 * Build an updated ProcessingJob record reflecting a failed attempt.
 *
 * If retries remain, the job transitions to RETRYING with a computed
 * `nextRetryAt` timestamp. If all retries are exhausted, the job
 * transitions to FAILED with no further retry scheduled.
 *
 * @param job - The current ProcessingJob state
 * @param error - The error message from the latest failure
 * @returns A new ProcessingJob object with updated retry state
 */
export function buildRetryState(job: ProcessingJob, error: string): ProcessingJob {
  const nextAttempts = job.attempts + 1;
  const canRetry = shouldRetry(nextAttempts, job.maxAttempts);

  const now = new Date();

  if (canRetry) {
    const delayMs = calculateBackoffDelay(nextAttempts);
    const nextRetryAt = new Date(now.getTime() + delayMs);

    return {
      ...job,
      attempts: nextAttempts,
      status: 'RETRYING' as JobStatus,
      lastError: error,
      nextRetryAt,
      updatedAt: now,
    };
  }

  return {
    ...job,
    attempts: nextAttempts,
    status: 'FAILED' as JobStatus,
    lastError: error,
    nextRetryAt: null,
    updatedAt: now,
  };
}
