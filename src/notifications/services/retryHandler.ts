/**
 * Retry Handler - Exponential backoff retry logic for notification delivery.
 *
 * Provides configurable retry behavior with exponential backoff,
 * capped at a maximum delay. Default: 3 retries (4 total attempts)
 * with base delay of 1000ms and max delay of 30000ms.
 *
 * @module notifications/services/retryHandler
 */

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** Configuration for retry behavior. */
export interface RetryConfig {
  /** Maximum number of retries (default 3, so 4 total attempts). */
  maxRetries: number;
  /** Base delay in milliseconds for exponential backoff (default 1000). */
  baseDelayMs: number;
  /** Maximum delay cap in milliseconds (default 30000). */
  maxDelayMs: number;
}

/** Retry handler for wrapping operations with exponential backoff. */
export interface RetryHandler {
  shouldRetry(attemptNumber: number): boolean;
  getDelay(attemptNumber: number): number;
  executeWithRetry<T>(fn: () => Promise<T>): Promise<T>;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a retry handler with exponential backoff.
 *
 * Delay formula: `min(baseDelayMs * 2^attempt, maxDelayMs)`
 *
 * - `shouldRetry(n)` returns true when `n < maxRetries`
 * - `getDelay(n)` returns the delay before attempt `n`
 * - `executeWithRetry(fn)` runs `fn`, retrying on failure up to `maxRetries` times
 */
export function createRetryHandler(config?: Partial<RetryConfig>): RetryHandler {
  const cfg: RetryConfig = { ...DEFAULT_CONFIG, ...config };

  return {
    shouldRetry(attemptNumber: number): boolean {
      return attemptNumber < cfg.maxRetries;
    },

    getDelay(attemptNumber: number): number {
      const delay = cfg.baseDelayMs * Math.pow(2, attemptNumber);
      return Math.min(delay, cfg.maxDelayMs);
    },

    async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
      let lastError: unknown;

      for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
        try {
          return await fn();
        } catch (error: unknown) {
          lastError = error;

          if (attempt >= cfg.maxRetries) {
            break;
          }

          const delay = cfg.baseDelayMs * Math.pow(2, attempt);
          const cappedDelay = Math.min(delay, cfg.maxDelayMs);
          await sleep(cappedDelay);
        }
      }

      throw lastError;
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
