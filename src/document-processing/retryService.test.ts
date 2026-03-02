/**
 * Unit tests for the retry service with exponential backoff.
 *
 * Validates: Requirements 11.5, 11.6
 * @module document-processing/retryService.test
 */

import { describe, expect, it } from 'vitest';

import {
  BASE_BACKOFF_DELAY_MS,
  buildRetryState,
  calculateBackoffDelay,
  MAX_RETRY_ATTEMPTS,
  shouldRetry,
} from './retryService.js';
import type { ProcessingJob } from './types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('retryService', () => {
  describe('constants', () => {
    it('should export MAX_RETRY_ATTEMPTS as 3', () => {
      expect(MAX_RETRY_ATTEMPTS).toBe(3);
    });

    it('should export BASE_BACKOFF_DELAY_MS as 1000', () => {
      expect(BASE_BACKOFF_DELAY_MS).toBe(1000);
    });
  });

  describe('calculateBackoffDelay', () => {
    it('should return 1000ms for attempt 1', () => {
      expect(calculateBackoffDelay(1)).toBe(1000);
    });

    it('should return 2000ms for attempt 2', () => {
      expect(calculateBackoffDelay(2)).toBe(2000);
    });

    it('should return 4000ms for attempt 3', () => {
      expect(calculateBackoffDelay(3)).toBe(4000);
    });

    it('should use custom base delay', () => {
      expect(calculateBackoffDelay(1, 500)).toBe(500);
      expect(calculateBackoffDelay(2, 500)).toBe(1000);
      expect(calculateBackoffDelay(3, 500)).toBe(2000);
    });

    it('should return base delay for attempt < 1', () => {
      expect(calculateBackoffDelay(0)).toBe(BASE_BACKOFF_DELAY_MS);
      expect(calculateBackoffDelay(-1)).toBe(BASE_BACKOFF_DELAY_MS);
    });
  });

  describe('shouldRetry', () => {
    it('should return true when attempts < maxAttempts', () => {
      expect(shouldRetry(0, 3)).toBe(true);
      expect(shouldRetry(1, 3)).toBe(true);
      expect(shouldRetry(2, 3)).toBe(true);
    });

    it('should return false when attempts >= maxAttempts', () => {
      expect(shouldRetry(3, 3)).toBe(false);
      expect(shouldRetry(4, 3)).toBe(false);
    });

    it('should use MAX_RETRY_ATTEMPTS as default', () => {
      expect(shouldRetry(0)).toBe(true);
      expect(shouldRetry(2)).toBe(true);
      expect(shouldRetry(3)).toBe(false);
    });

    it('should handle custom maxAttempts', () => {
      expect(shouldRetry(4, 5)).toBe(true);
      expect(shouldRetry(5, 5)).toBe(false);
    });
  });

  describe('buildRetryState', () => {
    it('should transition to RETRYING when retries remain', () => {
      const job = makeJob({ attempts: 0 });
      const result = buildRetryState(job, 'Connection timeout');

      expect(result.status).toBe('RETRYING');
      expect(result.attempts).toBe(1);
      expect(result.lastError).toBe('Connection timeout');
      expect(result.nextRetryAt).not.toBeNull();
    });

    it('should set nextRetryAt with correct backoff delay', () => {
      const job = makeJob({ attempts: 0 });
      const before = Date.now();
      const result = buildRetryState(job, 'fail');
      const after = Date.now();

      const retryTime = result.nextRetryAt!.getTime();
      // Attempt 1 → 1000ms delay
      expect(retryTime).toBeGreaterThanOrEqual(before + 1000);
      expect(retryTime).toBeLessThanOrEqual(after + 1000);
    });

    it('should increase backoff delay with each attempt', () => {
      const job1 = makeJob({ attempts: 0 });
      const result1 = buildRetryState(job1, 'fail');

      const job2 = makeJob({ attempts: 1 });
      const result2 = buildRetryState(job2, 'fail');

      const delay1 = result1.nextRetryAt!.getTime() - result1.updatedAt.getTime();
      const delay2 = result2.nextRetryAt!.getTime() - result2.updatedAt.getTime();

      // Attempt 1 → 1000ms, Attempt 2 → 2000ms
      expect(delay1).toBe(1000);
      expect(delay2).toBe(2000);
    });

    it('should transition to FAILED when all retries exhausted', () => {
      const job = makeJob({ attempts: 2 });
      const result = buildRetryState(job, 'Final failure');

      expect(result.status).toBe('FAILED');
      expect(result.attempts).toBe(3);
      expect(result.lastError).toBe('Final failure');
      expect(result.nextRetryAt).toBeNull();
    });

    it('should preserve immutability of the original job', () => {
      const job = makeJob({ attempts: 0 });
      const originalAttempts = job.attempts;
      buildRetryState(job, 'error');

      expect(job.attempts).toBe(originalAttempts);
      expect(job.status).toBe('ACTIVE');
    });

    it('should respect custom maxAttempts on the job', () => {
      const job = makeJob({ attempts: 4, maxAttempts: 5 });
      const result = buildRetryState(job, 'error');

      // 5th attempt = exhausted (5 >= 5)
      expect(result.status).toBe('FAILED');
      expect(result.attempts).toBe(5);
    });
  });
});
