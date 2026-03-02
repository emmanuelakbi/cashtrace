/**
 * Content-Type validation middleware for the API Gateway.
 *
 * Validates that incoming requests with a body have a Content-Type header
 * matching the expected format. Returns HTTP 415 Unsupported Media Type
 * when the Content-Type does not match.
 *
 * @module middleware/contentType
 * @see Requirement 2.7
 */

import type { Request, Response, NextFunction } from 'express';

import { GATEWAY_ERROR_CODES } from '../gateway/types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration for the Content-Type validation middleware. */
export interface ContentTypeConfig {
  /** Allowed Content-Type values (matched as prefixes). Defaults to ['application/json']. */
  allowedTypes: string[];
  /** HTTP methods that require Content-Type validation. Defaults to POST, PUT, PATCH. */
  methods: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_ALLOWED_TYPES = ['application/json'];
const DEFAULT_METHODS = ['POST', 'PUT', 'PATCH'];

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create middleware that validates the Content-Type header on requests
 * with a body (POST, PUT, PATCH by default).
 *
 * Requests without a body or using methods that don't require a body
 * (GET, DELETE, OPTIONS, HEAD) pass through without validation.
 *
 * @see Requirement 2.7
 */
export function createContentTypeMiddleware(
  config?: Partial<ContentTypeConfig>,
): (req: Request, res: Response, next: NextFunction) => void {
  const allowedTypes = config?.allowedTypes ?? DEFAULT_ALLOWED_TYPES;
  const methods = new Set((config?.methods ?? DEFAULT_METHODS).map((m) => m.toUpperCase()));

  return (req: Request, res: Response, next: NextFunction): void => {
    // Only validate methods that typically carry a body
    if (!methods.has(req.method.toUpperCase())) {
      next();
      return;
    }

    // Skip validation when there is no body (Content-Length: 0 or absent)
    const contentLength = req.headers['content-length'];
    if (contentLength === '0' || (!contentLength && !req.headers['transfer-encoding'])) {
      next();
      return;
    }

    const contentType = req.headers['content-type'];
    if (!contentType) {
      sendUnsupportedMediaType(req, res, 'Content-Type header is required');
      return;
    }

    const lower = contentType.toLowerCase();
    const isAllowed = allowedTypes.some((allowed) => lower.startsWith(allowed.toLowerCase()));

    if (!isAllowed) {
      sendUnsupportedMediaType(
        req,
        res,
        `Unsupported Content-Type: ${contentType}. Expected: ${allowedTypes.join(', ')}`,
      );
      return;
    }

    next();
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sendUnsupportedMediaType(req: Request, res: Response, message: string): void {
  const correlationId = req.context?.correlationId ?? 'unknown';
  res.status(415).json({
    success: false,
    error: {
      code: GATEWAY_ERROR_CODES.VALIDATION_FAILED,
      message,
      correlationId,
      timestamp: new Date().toISOString(),
    },
  });
}
