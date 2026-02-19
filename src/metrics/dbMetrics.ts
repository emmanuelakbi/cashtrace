/**
 * Database Metrics
 *
 * Collects database query metrics: count, latency, and errors.
 * Integrates with the MetricsCollector to expose Prometheus-compatible metrics.
 *
 * Requirements: 3.2 - THE Observability_Service SHALL collect database query metrics
 */

import { type MetricsCollector, type Counter, type Histogram, type Labels } from './collector.js';

/** Default query latency histogram buckets in milliseconds */
const DEFAULT_LATENCY_BUCKETS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

/** Valid database operation types */
export type DbOperationType = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

const VALID_OPERATIONS: ReadonlySet<string> = new Set<string>([
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
]);

export interface DbMetricsOptions {
  /** Custom latency histogram buckets in ms (default: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]) */
  latencyBuckets?: number[];
}

export interface DbQueryInfo {
  /** The operation type (SELECT, INSERT, UPDATE, DELETE) */
  operation: string;
  /** The table or collection being queried */
  table: string;
  /** Query duration in milliseconds */
  durationMs: number;
  /** Whether the query resulted in an error */
  error?: boolean;
}

export interface DbMetrics {
  /** Record a completed database query */
  recordQuery(info: DbQueryInfo): void;
  /** Get the underlying query count counter */
  getQueryCounter(): Counter;
  /** Get the underlying latency histogram */
  getLatencyHistogram(): Histogram;
  /** Get the underlying error counter */
  getErrorCounter(): Counter;
}

/**
 * Normalizes a database operation string to uppercase.
 * Returns the uppercased value if it's a valid operation, otherwise returns 'OTHER'.
 */
export function normalizeOperation(operation: string): string {
  const upper = operation.toUpperCase();
  return VALID_OPERATIONS.has(upper) ? upper : 'OTHER';
}

/**
 * Creates a DbMetrics instance backed by the given MetricsCollector.
 */
export function createDbMetrics(
  collector: MetricsCollector,
  options?: DbMetricsOptions,
): DbMetrics {
  const buckets = options?.latencyBuckets ?? DEFAULT_LATENCY_BUCKETS;

  const queryCounter = collector.counter('db_queries_total', {
    operation: '',
    table: '',
  });

  const latencyHistogram = collector.histogram('db_query_duration_ms', buckets, {
    operation: '',
    table: '',
  });

  const errorCounter = collector.counter('db_query_errors_total', {
    operation: '',
    table: '',
  });

  return {
    recordQuery(info: DbQueryInfo): void {
      const { operation, table, durationMs, error } = info;
      const normalizedOp = normalizeOperation(operation);

      const labels: Labels = {
        operation: normalizedOp,
        table,
      };

      queryCounter.inc(1, labels);
      latencyHistogram.observe(durationMs, labels);

      if (error) {
        errorCounter.inc(1, labels);
      }
    },

    getQueryCounter(): Counter {
      return queryCounter;
    },

    getLatencyHistogram(): Histogram {
      return latencyHistogram;
    },

    getErrorCounter(): Counter {
      return errorCounter;
    },
  };
}
