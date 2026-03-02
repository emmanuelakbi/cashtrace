/**
 * Centralized error-handling middleware for the transaction-engine module.
 *
 * Catches all errors thrown in transaction routes and formats them into a
 * consistent JSON response shape with error code, message, and requestId.
 *
 * Requirements: 12.2, 12.3, 12.4
 * @module transaction-engine/errorMiddleware
 */

import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

import type { ErrorResponse } from './types.js';

/** Map of known transaction error codes to HTTP status codes. */
const ERROR_STATUS_MAP: Record<string, number> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  TRANSACTION_NOT_FOUND: 404,
  DOC_NOT_FOUND: 404,
  DUPLICATE_PAIR_NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  TXN_NOT_FOUND: 404,
  TXN_FORBIDDEN: 403,
  TXN_INVALID_CATEGORY: 400,
  TXN_INVALID_AMOUNT: 400,
  TXN_INVALID_DATE: 400,
  TXN_INVALID_TYPE: 400,
  TXN_INVALID_SOURCE: 400,
  TXN_IMMUTABLE_FIELD: 400,
  TXN_BULK_VALIDATION: 400,
  TXN_DUPLICATE_NOT_FOUND: 404,
  TXN_DUPLICATE_ALREADY_RESOLVED: 400,
};

/**
 * Look up the HTTP status for a transaction error code.
 *
 * Returns 500 for unrecognized codes.
 */
export function getHttpStatusForError(code: string): number {
  return ERROR_STATUS_MAP[code] ?? 500;
}

/**
 * Express error-handling middleware for transaction routes.
 *
 * - Errors with a `code` property are mapped to the appropriate HTTP status
 *   and returned with their code and message.
 * - All other errors are treated as INTERNAL_ERROR with a 500 status.
 * - The requestId is taken from the x-request-id header or generated as a UUID.
 */
export function transactionErrorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();

  if (err instanceof Error && 'code' in err) {
    const code = (err as Error & { code: string }).code;
    const httpStatus = getHttpStatusForError(code);
    const body: ErrorResponse = {
      success: false,
      error: { code, message: err.message },
      requestId,
    };
    res.status(httpStatus).json(body);
    return;
  }

  const body: ErrorResponse = {
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    requestId,
  };
  res.status(500).json(body);
}
