// Gemini Integration - Timeout handler for API calls

import { TimeoutError } from '../types/errors.js';

export interface TimeoutOptions {
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Execute an async function with a configurable timeout.
 * Rejects with TimeoutError if the function does not resolve within the timeout.
 */
export async function executeWithTimeout<T>(
  fn: () => Promise<T>,
  options?: Partial<TimeoutOptions>,
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (timeoutMs <= 0) {
    return fn();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(`Operation timed out after ${timeoutMs}ms`, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
