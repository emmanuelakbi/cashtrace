/**
 * Request correlation ID middleware for the document-processing module.
 *
 * Generates or propagates a unique request ID for every incoming request,
 * attaches it to the request object, and sets the `x-request-id` response
 * header so downstream consumers can correlate logs and responses.
 *
 * Requirements: 12.4
 * @module document-processing/correlationMiddleware
 */

import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Express Request extended with an optional `requestId` field.
 *
 * Middleware populates this before any route handler runs so that
 * controllers can read `req.requestId` instead of extracting the
 * header manually.
 */
export interface CorrelatedRequest extends Request {
  requestId?: string;
}

/**
 * Express middleware that ensures every request carries a correlation ID.
 *
 * 1. Reads `x-request-id` from the incoming request headers.
 * 2. If the header is absent, generates a new UUID v4.
 * 3. Stores the value on `req.requestId`.
 * 4. Sets the `x-request-id` response header.
 */
export function correlationMiddleware(
  req: CorrelatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  next();
}
