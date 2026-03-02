// Gemini Integration - Retry handler with exponential backoff

import { GeminiServiceError } from '../types/errors.js';

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  jitterMs?: number;
  retryableErrors?: string[];
  delayFn?: (ms: number) => Promise<void>;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'retryableErrors' | 'delayFn'>> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  jitterMs: 500,
};

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryable(error: unknown, retryableErrors?: string[]): boolean {
  if (error instanceof GeminiServiceError) {
    if (retryableErrors && retryableErrors.length > 0) {
      return error.retryable || retryableErrors.includes(error.code);
    }
    return error.retryable;
  }

  // If retryableErrors list is provided, check error code/message
  if (retryableErrors && retryableErrors.length > 0 && error instanceof Error) {
    return retryableErrors.some(
      (code) => error.message.includes(code) || ('code' in error && error.code === code),
    );
  }

  // Unknown errors are treated as transient (retryable) by default
  return true;
}

function computeDelay(
  attempt: number,
  initialDelayMs: number,
  backoffMultiplier: number,
  maxDelayMs: number,
  jitterMs: number,
): number {
  const exponentialDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt);
  const capped = Math.min(exponentialDelay, maxDelayMs);
  const jitter = Math.random() * jitterMs;
  return capped + jitter;
}

export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? DEFAULT_OPTIONS.maxRetries;
  const initialDelayMs = options?.initialDelayMs ?? DEFAULT_OPTIONS.initialDelayMs;
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_OPTIONS.maxDelayMs;
  const backoffMultiplier = options?.backoffMultiplier ?? DEFAULT_OPTIONS.backoffMultiplier;
  const jitterMs = options?.jitterMs ?? DEFAULT_OPTIONS.jitterMs;
  const retryableErrors = options?.retryableErrors;
  const delayFn = options?.delayFn ?? defaultDelay;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      // If this is the last attempt, don't check retryability — just throw
      if (attempt === maxRetries) {
        break;
      }

      // Non-retryable errors fail immediately
      if (!isRetryable(error, retryableErrors)) {
        break;
      }

      const delay = computeDelay(attempt, initialDelayMs, backoffMultiplier, maxDelayMs, jitterMs);
      await delayFn(delay);
    }
  }

  // Enrich the error with retry context
  if (lastError instanceof GeminiServiceError) {
    lastError.context = {
      ...lastError.context,
      retryAttempts: maxRetries,
      exhaustedRetries: true,
    };
    throw lastError;
  }

  if (lastError instanceof Error) {
    const enriched = new GeminiServiceError(lastError.message, 'RETRY_EXHAUSTED', false, {
      retryAttempts: maxRetries,
      exhaustedRetries: true,
      originalError: lastError.name,
    });
    enriched.cause = lastError;
    throw enriched;
  }

  throw lastError;
}
