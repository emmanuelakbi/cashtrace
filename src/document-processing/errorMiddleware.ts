/**
 * Centralized error-handling middleware for the document-processing module.
 *
 * Catches all errors thrown in document routes and formats them into a
 * consistent JSON response shape with error code, message, and requestId.
 *
 * @module document-processing/errorMiddleware
 */

import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

import { getHttpStatusForDocError } from './documentController.js';
import { DocumentError } from './documentService.js';
import type { ErrorResponse } from './types.js';
import { DOC_ERROR_CODES } from './types.js';

/**
 * Express error-handling middleware for document routes.
 *
 * - DocumentError instances are mapped to the appropriate HTTP status via
 *   getHttpStatusForDocError and returned with their code and message.
 * - All other errors are treated as INTERNAL_ERROR with a 500 status.
 * - The requestId is taken from the x-request-id header or generated as a UUID.
 */
export function documentErrorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();

  if (err instanceof DocumentError) {
    const httpStatus = getHttpStatusForDocError(err.code);
    const body: ErrorResponse = {
      success: false,
      error: { code: err.code, message: err.message },
      requestId,
    };
    res.status(httpStatus).json(body);
    return;
  }

  const body: ErrorResponse = {
    success: false,
    error: { code: DOC_ERROR_CODES.INTERNAL_ERROR, message: 'Internal server error' },
    requestId,
  };
  res.status(500).json(body);
}
