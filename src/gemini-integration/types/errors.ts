// Gemini Integration - Error types

export class GeminiServiceError extends Error {
  code: string;
  retryable: boolean;
  context?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    retryable: boolean,
    context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'GeminiServiceError';
    this.code = code;
    this.retryable = retryable;
    this.context = context;
  }
}

export class ValidationError extends GeminiServiceError {
  override code = 'VALIDATION_ERROR';
  override retryable = false;
  field: string;

  constructor(message: string, field: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', false, context);
    this.name = 'ValidationError';
    this.field = field;
  }
}

export class CircuitOpenError extends GeminiServiceError {
  override code = 'CIRCUIT_OPEN';
  override retryable = false;
  nextRetryTime: Date;

  constructor(message: string, nextRetryTime: Date, context?: Record<string, unknown>) {
    super(message, 'CIRCUIT_OPEN', false, context);
    this.name = 'CircuitOpenError';
    this.nextRetryTime = nextRetryTime;
  }
}

export class TimeoutError extends GeminiServiceError {
  override code = 'TIMEOUT';
  override retryable = true;
  timeoutMs: number;

  constructor(message: string, timeoutMs: number, context?: Record<string, unknown>) {
    super(message, 'TIMEOUT', true, context);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class RateLimitError extends GeminiServiceError {
  override code = 'RATE_LIMIT';
  override retryable = true;
  retryAfterMs: number;

  constructor(message: string, retryAfterMs: number, context?: Record<string, unknown>) {
    super(message, 'RATE_LIMIT', true, context);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class QuotaExceededError extends GeminiServiceError {
  override code = 'QUOTA_EXCEEDED';
  override retryable = false;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'QUOTA_EXCEEDED', false, context);
    this.name = 'QuotaExceededError';
  }
}

export class InvalidResponseError extends GeminiServiceError {
  override code = 'INVALID_RESPONSE';
  override retryable = true;
  rawResponse: string;

  constructor(message: string, rawResponse: string, context?: Record<string, unknown>) {
    super(message, 'INVALID_RESPONSE', true, context);
    this.name = 'InvalidResponseError';
    this.rawResponse = rawResponse;
  }
}

export class FallbackUsedError extends GeminiServiceError {
  override code = 'FALLBACK_USED';
  override retryable = false;
  fallbackType: 'pdf_text' | 'csv_parse';

  constructor(
    message: string,
    fallbackType: 'pdf_text' | 'csv_parse',
    context?: Record<string, unknown>,
  ) {
    super(message, 'FALLBACK_USED', false, context);
    this.name = 'FallbackUsedError';
    this.fallbackType = fallbackType;
  }
}
