/**
 * Request context builder middleware.
 *
 * Generates/propagates correlation IDs, extracts client IP (proxy-aware),
 * captures user agent, and attaches a RequestContext to each request.
 * Auth payload (JWT or API key) can be used to populate user/business fields.
 *
 * @module middleware/contextBuilder
 * @see Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { v4 as uuidv4, validate as uuidValidate } from 'uuid';
import type { Request, Response, NextFunction } from 'express';

import { runWithContext } from '../gateway/asyncContext.js';
import type { APIKeyPayload, JWTPayload, RequestContext } from '../gateway/types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Header used to propagate correlation IDs across services. */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/** Fallback header for correlation ID (common alternative). */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Header containing the original client IP when behind a proxy. */
export const FORWARDED_FOR_HEADER = 'x-forwarded-for';

// ─── Express Request Augmentation ────────────────────────────────────────────

/** Extend Express Request to carry gateway context. */
declare global {
  namespace Express {
    interface Request {
      context?: RequestContext;
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve the correlation ID from incoming headers or generate a new one.
 * Accepts X-Correlation-ID or X-Request-ID; validates UUID format.
 */
export function resolveCorrelationId(req: Request): string {
  const fromCorrelation = req.headers[CORRELATION_ID_HEADER];
  const fromRequestId = req.headers[REQUEST_ID_HEADER];

  const candidate =
    typeof fromCorrelation === 'string'
      ? fromCorrelation.trim()
      : typeof fromRequestId === 'string'
        ? fromRequestId.trim()
        : undefined;

  if (candidate && uuidValidate(candidate)) {
    return candidate;
  }

  return uuidv4();
}

/**
 * Extract the real client IP address, handling reverse proxies.
 * Uses the first entry in X-Forwarded-For, falling back to req.ip.
 */
export function extractClientIP(req: Request): string {
  const forwarded = req.headers[FORWARDED_FOR_HEADER];
  if (typeof forwarded === 'string') {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

// ─── Context Builder Functions ───────────────────────────────────────────────

/**
 * Build a RequestContext from the incoming request and optional auth payload.
 *
 * - Requirement 9.1: includes authenticated user ID and email (via JWT)
 * - Requirement 9.2: includes active business ID (via JWT)
 * - Requirement 9.3: includes correlation ID for distributed tracing
 * - Requirement 9.4: includes client IP address (proxy-aware)
 * - Requirement 9.5: includes request timestamp
 */
export function buildContext(req: Request, auth?: JWTPayload | APIKeyPayload): RequestContext {
  const correlationId = resolveCorrelationId(req);
  const clientIP = extractClientIP(req);
  const userAgent = req.headers['user-agent'] ?? 'unknown';

  const context: RequestContext = {
    correlationId,
    clientIP,
    userAgent,
    timestamp: new Date(),
    permissions: [],
  };

  if (auth) {
    if ('userId' in auth) {
      // JWTPayload
      context.userId = auth.userId;
      context.businessId = auth.businessId;
      context.permissions = auth.permissions;
    } else if ('serviceId' in auth) {
      // APIKeyPayload
      context.permissions = auth.permissions;
    }
  }

  return context;
}

/**
 * Attach a RequestContext to the Express request object.
 */
export function attachContext(req: Request, context: RequestContext): void {
  req.context = context;
}

/**
 * Retrieve the RequestContext from an Express request.
 * Throws if context has not been attached.
 */
export function getContext(req: Request): RequestContext {
  if (!req.context) {
    throw new Error('RequestContext not found on request. Is contextBuilder middleware applied?');
  }
  return req.context;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Express middleware that builds and attaches a RequestContext,
 * sets the correlation ID on the response header, and runs
 * downstream handlers inside async local storage so the context
 * is accessible anywhere via {@link getCurrentContext}.
 *
 * @see Requirements: 9.6
 */
export function contextBuilderMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const context = buildContext(req);
    attachContext(req, context);
    res.setHeader(CORRELATION_ID_HEADER, context.correlationId);
    runWithContext(context, () => {
      next();
    });
  };
}
