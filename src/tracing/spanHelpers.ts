/**
 * Span Helpers
 *
 * Utility functions for creating spans around common operations
 * like database queries and HTTP/API calls. Automatically sets
 * semantic attributes following OpenTelemetry conventions.
 *
 * Requirements: 4.3 (create spans for significant operations),
 *               4.4 (include span metadata: service, operation, duration, status)
 */

import type { Tracer, Span, SpanAttributes } from './tracer.js';

export interface DbSpanOptions {
  /** Database system (e.g. 'postgres', 'mysql', 'redis') */
  dbSystem: string;
  /** The SQL statement or query string */
  dbStatement?: string;
  /** The operation name (e.g. 'SELECT', 'INSERT', 'findOne') */
  dbOperation?: string;
  /** Database name */
  dbName?: string;
  /** Additional span attributes */
  attributes?: SpanAttributes;
}

export interface HttpSpanOptions {
  /** HTTP method (GET, POST, etc.) */
  method: string;
  /** Target URL */
  url: string;
  /** Additional span attributes */
  attributes?: SpanAttributes;
}

export interface OperationSpanOptions {
  /** Span kind (defaults to 'internal') */
  kind?: 'internal' | 'server' | 'client' | 'producer' | 'consumer';
  /** Additional span attributes */
  attributes?: SpanAttributes;
}

/**
 * Wraps a database query in a span with standard db.* attributes.
 *
 * Automatically sets:
 * - db.system, db.statement, db.operation, db.name
 * - span kind = 'client'
 * - status based on success/failure
 * - duration via span start/end
 */
export async function withDbSpan<T>(
  tracer: Tracer,
  options: DbSpanOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const spanName = options.dbOperation
    ? `${options.dbSystem}.${options.dbOperation}`
    : options.dbSystem;

  const attrs: SpanAttributes = {
    'db.system': options.dbSystem,
    ...(options.dbStatement != null && { 'db.statement': options.dbStatement }),
    ...(options.dbOperation != null && { 'db.operation': options.dbOperation }),
    ...(options.dbName != null && { 'db.name': options.dbName }),
    ...options.attributes,
  };

  const span = tracer.startSpan(spanName, {
    kind: 'client',
    attributes: attrs,
  });

  return tracer.withSpan(span, async () => {
    try {
      const result = await fn(span);
      span.setStatus('ok');
      return result;
    } catch (error) {
      span.setStatus('error');
      span.addEvent('exception', {
        'exception.message': error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Wraps an HTTP/API call in a span with standard http.* attributes.
 *
 * Automatically sets:
 * - http.method, http.url
 * - http.status_code (via returned value or setAttributes in callback)
 * - span kind = 'client'
 * - status based on success/failure
 * - duration via span start/end
 */
export async function withHttpSpan<T>(
  tracer: Tracer,
  options: HttpSpanOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const spanName = `HTTP ${options.method}`;

  const attrs: SpanAttributes = {
    'http.method': options.method,
    'http.url': options.url,
    ...options.attributes,
  };

  const span = tracer.startSpan(spanName, {
    kind: 'client',
    attributes: attrs,
  });

  return tracer.withSpan(span, async () => {
    try {
      const result = await fn(span);
      span.setStatus('ok');
      return result;
    } catch (error) {
      span.setStatus('error');
      span.addEvent('exception', {
        'exception.message': error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Generic operation wrapper that creates a span, runs the operation,
 * and ends the span with proper status.
 *
 * Use this for any significant operation that doesn't fit the DB or HTTP patterns.
 */
export async function withOperationSpan<T>(
  tracer: Tracer,
  name: string,
  options: OperationSpanOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = tracer.startSpan(name, {
    kind: options.kind ?? 'internal',
    attributes: options.attributes,
  });

  return tracer.withSpan(span, async () => {
    try {
      const result = await fn(span);
      span.setStatus('ok');
      return result;
    } catch (error) {
      span.setStatus('error');
      span.addEvent('exception', {
        'exception.message': error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
