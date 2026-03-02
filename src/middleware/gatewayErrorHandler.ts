/**
 * Gateway error handler middleware.
 *
 * Provides a consistent JSON error format for all gateway errors,
 * including correlation ID and timestamp in every response.
 *
 * @module middleware/gatewayErrorHandler
 * @see Requirement 10.1 — consistent JSON error format
 * @see Requirement 10.3 — correlation ID in all error responses
 * @see Requirement 10.4 — hide internal details in production
 */

import type { Request, Response, NextFunction } from 'express';

import type { APIError, GatewayErrorCode } from '../gateway/types.js';
import { GATEWAY_ERROR_CODES, GATEWAY_ERROR_HTTP_STATUS } from '../gateway/types.js';
import { CircuitOpenError } from '../utils/circuitBreaker.js';

/** Custom error class for gateway-specific errors. */
export class GatewayError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;
  public readonly fields?: Record<string, string[]>;

  constructor(
    code: string,
    message: string,
    statusCode: number,
    options?: {
      details?: Record<string, unknown>;
      fields?: Record<string, string[]>;
    },
  ) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = options?.details;
    this.fields = options?.fields;
  }
}

/** Options for the error handler factory. */
export interface ErrorHandlerOptions {
  /** When true, expose internal error details (stack, message). Defaults to false. */
  exposeErrors?: boolean;
}

/** Set of known gateway error codes for fast lookup. */
const KNOWN_CODES = new Set<string>(Object.values(GATEWAY_ERROR_CODES));

/**
 * Factory that creates an Express error-handling middleware.
 *
 * @param options - Configuration options
 * @returns Express error handler (4-param middleware)
 */
export function createErrorHandlerMiddleware(
  options: ErrorHandlerOptions = {},
): (err: unknown, req: Request, res: Response, _next: NextFunction) => void {
  const { exposeErrors = false } = options;

  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const correlationId = req.context?.correlationId ?? 'unknown';
    const timestamp = new Date().toISOString();

    let statusCode: number;
    let errorBody: APIError;

    if (err instanceof GatewayError) {
      statusCode = err.statusCode;
      errorBody = {
        code: err.code,
        message: err.message,
        correlationId,
        timestamp,
        ...(err.details ? { details: err.details } : {}),
        ...(err.fields ? { fields: err.fields } : {}),
      };
    } else if (err instanceof CircuitOpenError) {
      statusCode = GATEWAY_ERROR_HTTP_STATUS[GATEWAY_ERROR_CODES.CIRCUIT_OPEN];
      errorBody = {
        code: GATEWAY_ERROR_CODES.CIRCUIT_OPEN,
        message: err.message,
        correlationId,
        timestamp,
        details: { service: err.service },
      };
    } else if (isErrorWithCode(err) && KNOWN_CODES.has(err.code)) {
      const code = err.code as GatewayErrorCode;
      statusCode = GATEWAY_ERROR_HTTP_STATUS[code];
      errorBody = {
        code,
        message: err.message ?? 'An error occurred',
        correlationId,
        timestamp,
      };
    } else {
      statusCode = 500;
      const message = exposeErrors && err instanceof Error ? err.message : 'Internal server error';
      errorBody = {
        code: 'INTERNAL_ERROR',
        message,
        correlationId,
        timestamp,
      };

      if (exposeErrors && err instanceof Error && err.stack) {
        errorBody.details = { stack: err.stack };
      }
    }

    res.status(statusCode).json({ success: false, error: errorBody });
  };
}

/** Type guard for errors with a string `code` property. */
function isErrorWithCode(err: unknown): err is { code: string; message?: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as Record<string, unknown>).code === 'string'
  );
}
