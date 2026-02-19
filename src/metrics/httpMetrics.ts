/**
 * HTTP Metrics
 *
 * Collects HTTP request metrics: count, latency, and status codes.
 * Integrates with the MetricsCollector to expose Prometheus-compatible metrics.
 *
 * Requirements: 3.1 - THE Observability_Service SHALL collect HTTP request metrics
 */

import { type MetricsCollector, type Counter, type Histogram, type Labels } from './collector.js';

/** Default latency histogram buckets in milliseconds */
const DEFAULT_LATENCY_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

export interface HttpMetricsOptions {
  /** Custom latency histogram buckets in ms (default: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]) */
  latencyBuckets?: number[];
}

export interface HttpRequestInfo {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}

export interface HttpMetrics {
  /** Record a completed HTTP request */
  recordRequest(info: HttpRequestInfo): void;
  /** Get the underlying request count counter */
  getRequestCounter(): Counter;
  /** Get the underlying latency histogram */
  getLatencyHistogram(): Histogram;
  /** Get the underlying status code counter */
  getStatusCounter(): Counter;
}

/**
 * Classifies an HTTP status code into its class (e.g. "2xx", "4xx").
 */
export function classifyStatusCode(statusCode: number): string {
  const classDigit = Math.floor(statusCode / 100);
  return `${classDigit}xx`;
}

/**
 * Creates an HttpMetrics instance backed by the given MetricsCollector.
 */
export function createHttpMetrics(
  collector: MetricsCollector,
  options?: HttpMetricsOptions,
): HttpMetrics {
  const buckets = options?.latencyBuckets ?? DEFAULT_LATENCY_BUCKETS;

  const requestCounter = collector.counter('http_requests_total', {
    method: '',
    route: '',
    status_code: '',
  });

  const latencyHistogram = collector.histogram('http_request_duration_ms', buckets, {
    method: '',
    route: '',
  });

  const statusCounter = collector.counter('http_status_total', {
    status_class: '',
  });

  return {
    recordRequest(info: HttpRequestInfo): void {
      const { method, route, statusCode, durationMs } = info;
      const methodUpper = method.toUpperCase();
      const statusStr = String(statusCode);

      const requestLabels: Labels = {
        method: methodUpper,
        route,
        status_code: statusStr,
      };
      requestCounter.inc(1, requestLabels);

      const latencyLabels: Labels = {
        method: methodUpper,
        route,
      };
      latencyHistogram.observe(durationMs, latencyLabels);

      const statusClass = classifyStatusCode(statusCode);
      statusCounter.inc(1, { status_class: statusClass });
    },

    getRequestCounter(): Counter {
      return requestCounter;
    },

    getLatencyHistogram(): Histogram {
      return latencyHistogram;
    },

    getStatusCounter(): Counter {
      return statusCounter;
    },
  };
}
