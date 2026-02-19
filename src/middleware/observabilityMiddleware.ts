/**
 * Observability Middleware
 *
 * Express-compatible middleware factories for automatic HTTP
 * request logging, metrics recording, and distributed tracing.
 *
 * Each factory accepts the relevant SDK component so the middleware
 * stays decoupled from global state.
 *
 * @module middleware/observabilityMiddleware
 */

import { randomUUID } from 'node:crypto';
import type { Logger } from '../logging/index.js';
import type { MetricsCollector } from '../metrics/index.js';
import { createHttpMetrics } from '../metrics/index.js';
import type { Tracer, Span } from '../tracing/index.js';

// ── Express-compatible types (avoid hard dep on @types/express) ─────────────

interface Request {
  method: string;
  url: string;
  originalUrl?: string;
  path?: string;
  headers: Record<string, string | string[] | undefined>;
  correlationId?: string;
  span?: Span;
}

interface Response {
  statusCode: number;
  on(event: string, listener: () => void): void;
  setHeader(name: string, value: string): void;
  getHeader(name: string): string | number | string[] | undefined;
}

type NextFunction = (err?: unknown) => void;
type Middleware = (req: Request, res: Response, next: NextFunction) => void;

// ── Correlation ID helper ───────────────────────────────────────────────────

const CORRELATION_HEADER = 'x-correlation-id';

function getOrCreateCorrelationId(req: Request): string {
  const existing = req.headers[CORRELATION_HEADER];
  if (typeof existing === 'string' && existing.length > 0) return existing;
  return randomUUID();
}

// ── Request Logger Middleware ────────────────────────────────────────────────

/**
 * Logs incoming requests and outgoing responses with correlation ID.
 */
export function requestLogger(logger: Logger): Middleware {
  return (req: Request, res: Response, next: NextFunction): void => {
    const correlationId = getOrCreateCorrelationId(req);
    req.correlationId = correlationId;
    res.setHeader(CORRELATION_HEADER, correlationId);

    const start = Date.now();
    const method = req.method;
    const url = req.originalUrl ?? req.url;

    const child = logger.child({ correlationId });
    child.info('request started', { method, url });

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      child.info('request completed', {
        method,
        url,
        statusCode: res.statusCode,
        durationMs,
      });
    });

    next();
  };
}

// ── Request Metrics Middleware ───────────────────────────────────────────────

/**
 * Records HTTP request count, latency, and status code metrics.
 */
export function requestMetrics(metricsCollector: MetricsCollector): Middleware {
  const httpMetrics = createHttpMetrics(metricsCollector);

  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      const route = req.path ?? req.url;
      httpMetrics.recordRequest({
        method: req.method,
        route,
        statusCode: res.statusCode,
        durationMs,
      });
    });

    next();
  };
}

// ── Request Tracer Middleware ────────────────────────────────────────────────

/**
 * Creates a span for each incoming HTTP request and attaches it to `req.span`.
 */
export function requestTracer(tracer: Tracer): Middleware {
  return (req: Request, res: Response, next: NextFunction): void => {
    const url = req.originalUrl ?? req.url;
    const span = tracer.startSpan(`HTTP ${req.method} ${url}`, {
      kind: 'server',
      attributes: {
        'http.method': req.method,
        'http.url': url,
      },
    });

    req.span = span;

    res.on('finish', () => {
      span.setAttributes({ 'http.status_code': res.statusCode });
      span.setStatus(res.statusCode < 400 ? 'ok' : 'error');
      span.end();
    });

    next();
  };
}

// ── Combined middleware ─────────────────────────────────────────────────────

export interface ObservabilityMiddlewareOptions {
  logger: Logger;
  metricsCollector: MetricsCollector;
  tracer: Tracer;
}

/**
 * Returns an array of middleware that applies logging, metrics, and tracing
 * in one shot.
 */
export function observabilityMiddleware(options: ObservabilityMiddlewareOptions): Middleware[] {
  return [
    requestLogger(options.logger),
    requestMetrics(options.metricsCollector),
    requestTracer(options.tracer),
  ];
}
