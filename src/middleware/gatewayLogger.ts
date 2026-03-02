/**
 * API Gateway request logging middleware.
 *
 * Logs method, path, status, duration, correlation ID, user ID,
 * and request/response sizes. Redacts sensitive PII fields.
 *
 * @module middleware/gatewayLogger
 * @see Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

import { v4 as uuidv4 } from 'uuid';
import type { Request, Response, NextFunction } from 'express';

import type { RequestLog } from '../gateway/types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Logger function signature injected into the middleware. */
export type LoggerFn = (entry: RequestLog) => void;

/** Log level for controlling per-endpoint verbosity (Req 6.6). */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/** Configuration for the gateway logger middleware (Req 6.6). */
export interface GatewayLoggerConfig {
  /** Per-endpoint log level overrides. Paths matching a key are logged at that level. */
  endpointLogLevels?: Map<string, LogLevel>;
}

// ─── PII Redaction ───────────────────────────────────────────────────────────

/** Regex patterns matching sensitive field names that must be redacted. */
export const PII_PATTERNS: RegExp[] = [
  /password/i,
  /token/i,
  /secret/i,
  /authorization/i,
  /cookie/i,
  /api_key/i,
  /apiKey/i,
  /credit_card/i,
  /ssn/i,
];

/** Sentinel value used to replace redacted content. */
const REDACTED = '[REDACTED]';

/**
 * Return '[REDACTED]' if the key matches any PII pattern, otherwise the original value.
 *
 * @see Requirement 6.4
 */
export function redactValue(key: string, value: string): string {
  for (const pattern of PII_PATTERNS) {
    if (pattern.test(key)) {
      return REDACTED;
    }
  }
  return value;
}

/**
 * Recursively redact sensitive fields in an object.
 * String values whose keys match PII_PATTERNS are replaced with '[REDACTED]'.
 * Nested objects are traversed recursively.
 *
 * @see Requirement 6.4
 */
export function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = redactValue(key, value);
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = redactObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Factory that creates Express middleware for structured request logging.
 *
 * The middleware:
 * - Records start time to compute duration (Req 6.1)
 * - Captures request size from Content-Length header (Req 6.5)
 * - Hooks into `res.end` to capture response size and status (Req 6.5)
 * - Builds a {@link RequestLog} entry with correlation ID (Req 6.2) and user ID (Req 6.3)
 * - Delegates to the injected logger function
 * - Supports per-endpoint log level configuration (Req 6.6)
 *
 * @param logger - function called with each completed request log entry
 * @param config - optional configuration for per-endpoint log levels
 */
export function createLoggerMiddleware(logger: LoggerFn, config?: GatewayLoggerConfig) {
  const endpointLogLevels = config?.endpointLogLevels;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Check if this endpoint is silenced (Req 6.6)
    if (endpointLogLevels) {
      const requestPath = req.originalUrl || req.url;
      const level = endpointLogLevels.get(requestPath);
      if (level === 'silent') {
        next();
        return;
      }
    }

    const startTime = Date.now();
    const requestSize = parseInt(req.headers['content-length'] ?? '0', 10) || 0;

    // Intercept res.end to capture response size and log on completion.
    const originalEnd = res.end.bind(res);
    let responseSize = 0;

    // Override res.end with a compatible signature.
    res.end = function overriddenEnd(
      ...args: Parameters<Response['end']>
    ): ReturnType<Response['end']> {
      const chunk = args[0];
      if (chunk) {
        if (typeof chunk === 'string') {
          responseSize = Buffer.byteLength(chunk);
        } else if (Buffer.isBuffer(chunk)) {
          responseSize = chunk.length;
        }
      }

      const duration = Date.now() - startTime;
      const context = req.context;

      const entry: RequestLog = {
        id: uuidv4(),
        correlationId: context?.correlationId ?? 'unknown',
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: res.statusCode,
        duration,
        userId: context?.userId,
        businessId: context?.businessId,
        clientIP: context?.clientIP ?? req.ip ?? 'unknown',
        userAgent: context?.userAgent ?? req.headers['user-agent'] ?? 'unknown',
        requestSize,
        responseSize,
        timestamp: new Date(),
      };

      logger(entry);

      return originalEnd(...args);
    } as typeof res.end;

    next();
  };
}
