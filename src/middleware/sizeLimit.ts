/**
 * Request size limit middleware.
 *
 * Enforces maximum request body size by checking the Content-Length header
 * early in the middleware chain. Returns HTTP 413 (Payload Too Large) when
 * the request exceeds the configured limit.
 *
 * - Default limit: 10MB for regular requests
 * - File upload limit: 50MB for routes matching file upload patterns
 *
 * @module middleware/sizeLimit
 * @see Requirements: 2.6
 */

import type { Request, Response, NextFunction } from 'express';

import { GATEWAY_ERROR_CODES } from '../gateway/types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default maximum request body size in bytes (10MB). */
export const DEFAULT_SIZE_LIMIT = 10 * 1024 * 1024;

/** Maximum request body size for file uploads in bytes (50MB). */
export const FILE_UPLOAD_SIZE_LIMIT = 50 * 1024 * 1024;

/** Default route patterns that are treated as file upload endpoints. */
const DEFAULT_FILE_UPLOAD_PATTERNS = [/\/upload/i, /\/files/i, /\/documents/i, /\/attachments/i];

// ─── Types ───────────────────────────────────────────────────────────────────

/** Options for configuring the size limit middleware. */
export interface SizeLimitOptions {
  /** Maximum body size in bytes for regular requests. Defaults to 10MB. */
  defaultLimit?: number;
  /** Maximum body size in bytes for file upload requests. Defaults to 50MB. */
  fileUploadLimit?: number;
  /** Route patterns that are treated as file upload endpoints. */
  fileUploadPatterns?: RegExp[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Determine whether a request path matches any file upload pattern.
 */
function isFileUploadRoute(path: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(path));
}

/**
 * Parse the Content-Length header into a number.
 * Returns NaN if the header is missing or not a valid number.
 */
function parseContentLength(req: Request): number {
  const header = req.headers['content-length'];
  if (header === undefined) {
    return NaN;
  }
  return Number(header);
}

// ─── Middleware Factory ──────────────────────────────────────────────────────

/**
 * Create an Express middleware that enforces request body size limits.
 *
 * Checks the Content-Length header and rejects requests that exceed the
 * configured limit with HTTP 413 and a JSON error body including the
 * correlation ID.
 *
 * @param options - Optional size limit configuration
 * @returns Express middleware function
 */
export function createSizeLimitMiddleware(
  options: SizeLimitOptions = {},
): (req: Request, res: Response, next: NextFunction) => void {
  const defaultLimit = options.defaultLimit ?? DEFAULT_SIZE_LIMIT;
  const fileUploadLimit = options.fileUploadLimit ?? FILE_UPLOAD_SIZE_LIMIT;
  const fileUploadPatterns = options.fileUploadPatterns ?? DEFAULT_FILE_UPLOAD_PATTERNS;

  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = parseContentLength(req);

    // If no Content-Length header, let downstream middleware handle it
    if (Number.isNaN(contentLength)) {
      next();
      return;
    }

    const limit = isFileUploadRoute(req.path, fileUploadPatterns) ? fileUploadLimit : defaultLimit;

    if (contentLength > limit) {
      const correlationId = req.context?.correlationId ?? 'unknown';

      res.status(413).json({
        success: false,
        error: {
          code: GATEWAY_ERROR_CODES.PAYLOAD_TOO_LARGE,
          message: `Request body exceeds maximum size of ${limit} bytes`,
          details: {
            contentLength,
            maxSize: limit,
          },
          correlationId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    next();
  };
}
