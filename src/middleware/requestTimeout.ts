/**
 * Request timeout middleware.
 *
 * Wraps each request with a configurable timeout guard. If the response
 * is not sent before the deadline, the middleware responds with 504
 * (Gateway Timeout) using the standard gateway error shape.
 *
 * Per-route timeouts are read from `req.routeConfig?.timeout`; otherwise
 * the factory default is used.
 *
 * @module middleware/requestTimeout
 * @see Requirement 4.4 — configurable request timeout per endpoint (default 30s)
 * @see Property 7 — requests exceeding timeout return 504
 */

import type { Request, Response, NextFunction } from 'express';

import { GATEWAY_ERROR_CODES, GATEWAY_ERROR_HTTP_STATUS } from '../gateway/types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default request timeout in milliseconds (30 seconds). */
export const DEFAULT_TIMEOUT_MS = 30_000;

// ─── Middleware Factory ──────────────────────────────────────────────────────

/**
 * Create Express middleware that enforces a request timeout.
 *
 * @param defaultTimeout - Fallback timeout in ms when no per-route value exists.
 *                         Defaults to {@link DEFAULT_TIMEOUT_MS}.
 */
export function createTimeoutMiddleware(defaultTimeout: number = DEFAULT_TIMEOUT_MS) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const timeout = req.routeConfig?.timeout ?? defaultTimeout;

    const timer = setTimeout(() => {
      if (res.headersSent) {
        return;
      }

      const correlationId = req.context?.correlationId ?? 'unknown';
      const status = GATEWAY_ERROR_HTTP_STATUS[GATEWAY_ERROR_CODES.TIMEOUT];

      res.status(status).json({
        success: false,
        error: {
          code: GATEWAY_ERROR_CODES.TIMEOUT,
          message: 'Request timed out',
          correlationId,
          timestamp: new Date().toISOString(),
        },
      });
    }, timeout);

    const cleanup = (): void => {
      clearTimeout(timer);
    };

    res.on('finish', cleanup);
    res.on('close', cleanup);

    next();
  };
}
