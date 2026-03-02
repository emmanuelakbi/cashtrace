/**
 * Unit tests for RetryHandler.
 *
 * Validates exponential backoff calculation, retry gating, and
 * the executeWithRetry wrapper behavior.
 *
 * @module notifications/services/retryHandler.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRetryHandler, type RetryHandler } from './retryHandler.js';

describe('RetryHandler', () => {
  let handler: RetryHandler;

  beforeEach(() => {
    // Use tiny delays so tests run fast
    handler = createRetryHandler({ baseDelayMs: 1, maxDelayMs: 100 });
  });

  describe('shouldRetry', () => {
    it('should allow retry when attempt < maxRetries', () => {
      expect(handler.shouldRetry(0)).toBe(true);
      expect(handler.shouldRetry(1)).toBe(true);
      expect(handler.shouldRetry(2)).toBe(true);
    });

    it('should deny retry when attempt >= maxRetries', () => {
      expect(handler.shouldRetry(3)).toBe(false);
      expect(handler.shouldRetry(4)).toBe(false);
    });

    it('should respect custom maxRetries', () => {
      const custom = createRetryHandler({ maxRetries: 1, baseDelayMs: 1, maxDelayMs: 100 });
      expect(custom.shouldRetry(0)).toBe(true);
      expect(custom.shouldRetry(1)).toBe(false);
    });
  });

  describe('getDelay', () => {
    it('should calculate exponential backoff', () => {
      const h = createRetryHandler({ baseDelayMs: 1000, maxDelayMs: 30000 });
      expect(h.getDelay(0)).toBe(1000); // 1000 * 2^0
      expect(h.getDelay(1)).toBe(2000); // 1000 * 2^1
      expect(h.getDelay(2)).toBe(4000); // 1000 * 2^2
      expect(h.getDelay(3)).toBe(8000); // 1000 * 2^3
    });

    it('should cap delay at maxDelayMs', () => {
      const h = createRetryHandler({ baseDelayMs: 1000, maxDelayMs: 5000 });
      expect(h.getDelay(0)).toBe(1000);
      expect(h.getDelay(1)).toBe(2000);
      expect(h.getDelay(2)).toBe(4000);
      expect(h.getDelay(3)).toBe(5000); // capped
      expect(h.getDelay(10)).toBe(5000); // still capped
    });

    it('should use default config values', () => {
      const h = createRetryHandler();
      expect(h.getDelay(0)).toBe(1000);
      expect(h.getDelay(1)).toBe(2000);
      expect(h.getDelay(2)).toBe(4000);
    });
  });

  describe('executeWithRetry', () => {
    it('should return result on first success', async () => {
      const fn = vi.fn().mockResolvedValue('ok');

      const result = await handler.executeWithRetry(fn);

      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and succeed', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail-1'))
        .mockRejectedValueOnce(new Error('fail-2'))
        .mockResolvedValue('recovered');

      const result = await handler.executeWithRetry(fn);

      expect(result).toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after exhausting all retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('persistent failure'));

      await expect(handler.executeWithRetry(fn)).rejects.toThrow('persistent failure');
      // 1 initial + 3 retries = 4 total
      expect(fn).toHaveBeenCalledTimes(4);
    });

    it('should throw the last error after exhausting retries', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('error-1'))
        .mockRejectedValueOnce(new Error('error-2'))
        .mockRejectedValueOnce(new Error('error-3'))
        .mockRejectedValueOnce(new Error('error-4'));

      await expect(handler.executeWithRetry(fn)).rejects.toThrow('error-4');
    });

    it('should succeed on the last retry attempt', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail-1'))
        .mockRejectedValueOnce(new Error('fail-2'))
        .mockRejectedValueOnce(new Error('fail-3'))
        .mockResolvedValue('last-chance');

      const result = await handler.executeWithRetry(fn);

      expect(result).toBe('last-chance');
      expect(fn).toHaveBeenCalledTimes(4);
    });

    it('should respect custom maxRetries of 1', async () => {
      const h = createRetryHandler({ maxRetries: 1, baseDelayMs: 1, maxDelayMs: 10 });
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(h.executeWithRetry(fn)).rejects.toThrow('fail');
      // 1 initial + 1 retry = 2 total
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should not retry when maxRetries is 0', async () => {
      const h = createRetryHandler({ maxRetries: 0, baseDelayMs: 1, maxDelayMs: 10 });
      const fn = vi.fn().mockRejectedValue(new Error('no-retry'));

      await expect(h.executeWithRetry(fn)).rejects.toThrow('no-retry');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
