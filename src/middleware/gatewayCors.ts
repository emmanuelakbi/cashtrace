/**
 * CORS middleware for the API Gateway.
 *
 * Manually implements CORS handling for full control over origin rejection
 * behavior (responding 403 for unauthorized origins).
 *
 * @module middleware/gatewayCors
 * @see Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

import type { Request, Response, NextFunction } from 'express';

import { GATEWAY_ERROR_CODES } from '../gateway/types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration for the CORS middleware. */
export interface CorsConfig {
  /** Origins allowed to make cross-origin requests. */
  allowedOrigins: string[];
  /** Whether to include Access-Control-Allow-Credentials header. */
  allowCredentials: boolean;
  /** HTTP methods allowed for cross-origin requests. */
  allowedMethods: string[];
  /** Headers allowed in cross-origin requests. */
  allowedHeaders: string[];
  /** Preflight response cache duration in seconds. */
  maxAge: number;
}

// ─── Origin Presets ──────────────────────────────────────────────────────────

/** Development origins (local dev servers). */
export const DEV_ORIGINS: string[] = ['http://localhost:3000', 'http://localhost:5173'];

/** Production origins. */
export const PROD_ORIGINS: string[] = ['https://cashtrace.ng', 'https://app.cashtrace.ng'];

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_METHODS: string[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];

const DEFAULT_HEADERS: string[] = [
  'Authorization',
  'Content-Type',
  'X-Correlation-ID',
  'X-API-Key',
  'Accept',
  'Origin',
];

const DEFAULT_MAX_AGE = 86_400; // 24 hours in seconds

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create CORS middleware with the given configuration.
 *
 * - Valid origins receive appropriate CORS headers.
 * - OPTIONS preflight requests are answered with 204.
 * - Invalid origins are rejected with 403.
 * - Requests without an Origin header (same-origin) pass through.
 */
export function createCorsMiddleware(
  config: Partial<CorsConfig> & Pick<CorsConfig, 'allowedOrigins'>,
): (req: Request, res: Response, next: NextFunction) => void {
  const resolved: CorsConfig = {
    allowCredentials: config.allowCredentials ?? true,
    allowedMethods: config.allowedMethods ?? DEFAULT_METHODS,
    allowedHeaders: config.allowedHeaders ?? DEFAULT_HEADERS,
    maxAge: config.maxAge ?? DEFAULT_MAX_AGE,
    allowedOrigins: config.allowedOrigins,
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;

    // No Origin header → same-origin request, pass through
    if (!origin) {
      next();
      return;
    }

    // Check if origin is allowed
    if (!resolved.allowedOrigins.includes(origin)) {
      res.status(403).json({
        success: false,
        error: {
          code: GATEWAY_ERROR_CODES.FORBIDDEN,
          message: 'Origin not allowed',
        },
      });
      return;
    }

    // Set CORS headers for valid origins
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');

    if (resolved.allowCredentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', resolved.allowedMethods.join(', '));
      res.setHeader('Access-Control-Allow-Headers', resolved.allowedHeaders.join(', '));
      res.setHeader('Access-Control-Max-Age', String(resolved.maxAge));
      res.status(204).end();
      return;
    }

    next();
  };
}
