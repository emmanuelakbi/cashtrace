import { describe, expect, it, vi } from 'vitest';

import { GeminiServiceError, QuotaExceededError, TimeoutError } from '../types/errors.js';

import { executeWithRetry } from './retry-handler.js';

// Instant delay for tests
const noDelay = async (_ms: number): Promise<void> => {};

describe('executeWithRetry', () => {
  describe('successful execution', () => {
    it('returns result on first attempt success', async () => {
      const fn = vi.fn().mockResolvedValue('ok');
      const result = await executeWithRetry(fn, { delayFn: noDelay });
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('returns result after transient failures', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new TimeoutError('timeout', 5000))
        .mockRejectedValueOnce(new TimeoutError('timeout', 5000))
        .mockResolvedValue('recovered');

      const result = await executeWithRetry(fn, { delayFn: noDelay });
      expect(result).toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('non-transient errors', () => {
    it('does not retry non-retryable GeminiServiceError', async () => {
      const fn = vi.fn().mockRejectedValue(new QuotaExceededError('quota exceeded'));

      await expect(executeWithRetry(fn, { delayFn: noDelay })).rejects.toThrow('quota exceeded');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does not retry ValidationError', async () => {
      const error = new GeminiServiceError('bad input', 'VALIDATION_ERROR', false);
      const fn = vi.fn().mockRejectedValue(error);

      await expect(executeWithRetry(fn, { delayFn: noDelay })).rejects.toThrow('bad input');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry exhaustion', () => {
    it('throws last error with retry context after exhausting retries', async () => {
      const fn = vi.fn().mockRejectedValue(new TimeoutError('timeout', 5000));

      try {
        await executeWithRetry(fn, { maxRetries: 2, delayFn: noDelay });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(GeminiServiceError);
        const err = error as GeminiServiceError;
        expect(err.context?.retryAttempts).toBe(2);
        expect(err.context?.exhaustedRetries).toBe(true);
      }

      // 1 initial + 2 retries = 3 total
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('wraps non-GeminiServiceError in GeminiServiceError with retry context', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('network failure'));

      try {
        await executeWithRetry(fn, { maxRetries: 1, delayFn: noDelay });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(GeminiServiceError);
        const err = error as GeminiServiceError;
        expect(err.code).toBe('RETRY_EXHAUSTED');
        expect(err.context?.retryAttempts).toBe(1);
        expect(err.context?.originalError).toBe('Error');
        expect(err.cause).toBeInstanceOf(Error);
      }
    });
  });

  describe('exponential backoff', () => {
    it('calls delayFn with increasing delays', async () => {
      const delays: number[] = [];
      const trackingDelay = async (ms: number): Promise<void> => {
        delays.push(ms);
      };

      const fn = vi.fn().mockRejectedValue(new TimeoutError('timeout', 5000));

      await expect(
        executeWithRetry(fn, {
          maxRetries: 3,
          initialDelayMs: 100,
          backoffMultiplier: 2,
          jitterMs: 0,
          delayFn: trackingDelay,
        }),
      ).rejects.toThrow();

      expect(delays).toHaveLength(3);
      // With jitter=0: delays should be exactly 100, 200, 400
      expect(delays[0]).toBe(100);
      expect(delays[1]).toBe(200);
      expect(delays[2]).toBe(400);
    });

    it('caps delay at maxDelayMs', async () => {
      const delays: number[] = [];
      const trackingDelay = async (ms: number): Promise<void> => {
        delays.push(ms);
      };

      const fn = vi.fn().mockRejectedValue(new TimeoutError('timeout', 5000));

      await expect(
        executeWithRetry(fn, {
          maxRetries: 3,
          initialDelayMs: 1000,
          backoffMultiplier: 10,
          maxDelayMs: 5000,
          jitterMs: 0,
          delayFn: trackingDelay,
        }),
      ).rejects.toThrow();

      expect(delays).toHaveLength(3);
      expect(delays[0]).toBe(1000); // 1000 * 10^0 = 1000
      expect(delays[1]).toBe(5000); // 1000 * 10^1 = 10000, capped to 5000
      expect(delays[2]).toBe(5000); // 1000 * 10^2 = 100000, capped to 5000
    });

    it('adds jitter within [0, jitterMs] range', async () => {
      const delays: number[] = [];
      const trackingDelay = async (ms: number): Promise<void> => {
        delays.push(ms);
      };

      const fn = vi.fn().mockRejectedValue(new TimeoutError('timeout', 5000));

      await expect(
        executeWithRetry(fn, {
          maxRetries: 3,
          initialDelayMs: 100,
          backoffMultiplier: 2,
          jitterMs: 500,
          delayFn: trackingDelay,
        }),
      ).rejects.toThrow();

      expect(delays).toHaveLength(3);
      // Each delay should be base + jitter where jitter is in [0, 500)
      expect(delays[0]).toBeGreaterThanOrEqual(100);
      expect(delays[0]).toBeLessThan(600);
      expect(delays[1]).toBeGreaterThanOrEqual(200);
      expect(delays[1]).toBeLessThan(700);
      expect(delays[2]).toBeGreaterThanOrEqual(400);
      expect(delays[2]).toBeLessThan(900);
    });
  });

  describe('retryableErrors option', () => {
    it('retries errors matching retryableErrors codes', async () => {
      const customError = new GeminiServiceError('custom', 'CUSTOM_CODE', false);
      const fn = vi.fn().mockRejectedValueOnce(customError).mockResolvedValue('ok');

      const result = await executeWithRetry(fn, {
        retryableErrors: ['CUSTOM_CODE'],
        delayFn: noDelay,
      });

      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries plain errors matching retryableErrors in message', async () => {
      const fn = vi.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValue('ok');

      const result = await executeWithRetry(fn, {
        retryableErrors: ['ECONNRESET'],
        delayFn: noDelay,
      });

      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('maxRetries = 0', () => {
    it('does not retry when maxRetries is 0', async () => {
      const fn = vi.fn().mockRejectedValue(new TimeoutError('timeout', 5000));

      await expect(executeWithRetry(fn, { maxRetries: 0, delayFn: noDelay })).rejects.toThrow(
        'timeout',
      );

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('unknown errors', () => {
    it('retries unknown errors (treated as transient by default)', async () => {
      const fn = vi.fn().mockRejectedValueOnce(new Error('unknown')).mockResolvedValue('ok');

      const result = await executeWithRetry(fn, { delayFn: noDelay });
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});
