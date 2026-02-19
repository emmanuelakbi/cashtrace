/**
 * Metrics Module
 *
 * Provides Prometheus-compatible metrics collection including
 * counters, gauges, histograms, and summaries for CashTrace observability.
 */

export {
  type PrometheusConfig,
  type MetricType,
  type MetricDefinition,
  type Labels,
  type MetricsRegistry,
  type CounterMetric,
  type GaugeMetric,
  type HistogramMetric,
  type SummaryMetric,
  loadPrometheusConfig,
  createMetricsRegistry,
} from './prometheusConfig.js';

export {
  type HttpMetrics,
  type HttpMetricsOptions,
  type HttpRequestInfo,
  createHttpMetrics,
  classifyStatusCode,
} from './httpMetrics.js';

export {
  type DbMetrics,
  type DbMetricsOptions,
  type DbQueryInfo,
  type DbOperationType,
  createDbMetrics,
  normalizeOperation,
} from './dbMetrics.js';

export {
  type BusinessMetrics,
  type TransactionInfo,
  type DocumentParseInfo,
  type TransactionType,
  type TransactionStatus,
  type DocumentType,
  type DocumentStatus,
  createBusinessMetrics,
  normalizeTransactionType,
  normalizeTransactionStatus,
  normalizeDocumentType,
  normalizeDocumentStatus,
} from './businessMetrics.js';

export {
  type MetricsCollector,
  type Counter,
  type Gauge,
  type Histogram,
  type Summary,
  createMetricsCollector,
} from './collector.js';

export { PROMETHEUS_CONTENT_TYPE, createMetricsEndpoint } from './metricsEndpoint.js';
