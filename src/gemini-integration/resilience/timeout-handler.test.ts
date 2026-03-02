import { describe, expect, it } from 'vitest';

import { TimeoutError } from '../types/errors.js';

import { executeWithTimeout } from './timeout-handler.js';

describe('executeWithTimeout', () => {
  describe('successful execution within timeout', () => {
    it('returns result when function resolves before timeout', async () => {
      const fn = (): Promise<string> => Promise.resolve('ok');
      const result = await executeWithTimeout(fn, { timeoutMs: 1000 });
      expect(result).toBe('ok');
    });

    it('returns result for async function that completes quickly', async () => {
      const fn = (): Promise<number> =>
        new Promise((resolve) => {
          setTimeout(() => resolve(42), 10);
        });
      const result = await executeWithTimeout(fn, { timeoutMs: 1000 });
      expect(result).toBe(42);
    });
  });

  describe('timeout expiration', () => {
    it('throws TimeoutError when function exceeds timeout', async () => {
      const fn = (): Promise<string> =>
        new Promise((resolve) => {
          setTimeout(() => resolve('late'), 500);
        });

      await expect(executeWithTimeout(fn, { timeoutMs: 50 })).rejects.toThrow(TimeoutError);
    });

    it('includes timeoutMs in the error', async () => {
      const fn = (): Promise<string> =>
        new Promise((resolve) => {
          setTimeout(() => resolve('late'), 500);
        });

      try {
        await executeWithTimeout(fn, { timeoutMs: 50 });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TimeoutError);
        const err = error as TimeoutError;
        expect(err.timeoutMs).toBe(50);
        expect(err.code).toBe('TIMEOUT');
        expect(err.retryable).toBe(true);
      }
    });

    it('includes descriptive message in the error', async () => {
      const fn = (): Promise<string> =>
        new Promise((resolve) => {
          setTimeout(() => resolve('late'), 500);
        });

      await expect(executeWithTimeout(fn, { timeoutMs: 100 })).rejects.toThrow(
        'Operation timed out after 100ms',
      );
    });
  });

  describe('error propagation', () => {
    it('propagates errors from the wrapped function', async () => {
      const fn = (): Promise<string> => Promise.reject(new Error('inner failure'));

      await expect(executeWithTimeout(fn, { timeoutMs: 1000 })).rejects.toThrow('inner failure');
    });

    it('propagates non-TimeoutError types unchanged', async () => {
      const customError = new TypeError('type mismatch');
      const fn = (): Promise<string> => Promise.reject(customError);

      await expect(executeWithTimeout(fn, { timeoutMs: 1000 })).rejects.toThrow(customError);
    });
  });

  describe('default timeout', () => {
    it('uses default 30s timeout when no options provided', async () => {
      const fn = (): Promise<string> => Promise.resolve('ok');
      // Should resolve immediately — just verifying it works without options
      const result = await executeWithTimeout(fn);
      expect(result).toBe('ok');
    });
  });

  describe('edge cases', () => {
    it('executes function directly when timeoutMs is 0', async () => {
      const fn = (): Promise<string> => Promise.resolve('direct');
      const result = await executeWithTimeout(fn, { timeoutMs: 0 });
      expect(result).toBe('direct');
    });

    it('executes function directly when timeoutMs is negative', async () => {
      const fn = (): Promise<string> => Promise.resolve('direct');
      const result = await executeWithTimeout(fn, { timeoutMs: -1 });
      expect(result).toBe('direct');
    });

    it('handles function that rejects before timeout', async () => {
      const fn = (): Promise<string> =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error('fast fail')), 10);
        });

      await expect(executeWithTimeout(fn, { timeoutMs: 1000 })).rejects.toThrow('fast fail');
    });
  });
});
