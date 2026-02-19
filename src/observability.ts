/**
 * Observability SDK
 *
 * Unified entry point for CashTrace observability. Provides a single
 * factory to initialise logger, PII scrubber, metrics collector, tracer,
 * alert manager, and health monitor together.
 *
 * @module observability
 */

// ── Imports ──────────────────────────────────────────────────────────────────

import { createAlertManager, type AlertManager, type MetricQueryFn } from './alerting/index.js';
import { createSloTracker, type SloTracker } from './dashboards/index.js';
import {
  createLogger,
  createPIIScrubber,
  type Logger,
  type LoggerOptions,
  type LogLevel,
  type LogEntry,
  type LogContext,
  type LogMetadata,
  type PIIScrubber,
} from './logging/index.js';
import {
  createMetricsCollector,
  createHttpMetrics,
  type MetricsCollector,
  type Counter,
  type Gauge,
  type Histogram,
  type Summary,
  type HttpMetrics,
  type HttpRequestInfo,
  type PrometheusConfig,
} from './metrics/index.js';
import {
  createHealthMonitor,
  type HealthMonitor,
  type HealthMonitorOptions,
} from './monitoring/index.js';
import {
  createTracer,
  type Tracer,
  type TracerConfig,
  type Span,
  type SpanOptions,
} from './tracing/index.js';

// ── Re-exports from sub-modules ─────────────────────────────────────────────

export { createAlertManager, type AlertManager };

export { createSloTracker, type SloTracker };

export {
  createLogger,
  createPIIScrubber,
  type Logger,
  type LoggerOptions,
  type LogLevel,
  type LogEntry,
  type LogContext,
  type LogMetadata,
  type PIIScrubber,
};

export {
  createMetricsCollector,
  createHttpMetrics,
  type MetricsCollector,
  type Counter,
  type Gauge,
  type Histogram,
  type Summary,
  type HttpMetrics,
  type HttpRequestInfo,
};

export { createHealthMonitor, type HealthMonitor };

export { createTracer, type Tracer, type TracerConfig, type Span, type SpanOptions };

export interface ObservabilityConfig {
  /** Options forwarded to createLogger */
  logger?: LoggerOptions;
  /** Options forwarded to createMetricsCollector */
  metrics?: PrometheusConfig;
  /** Options forwarded to createTracer (serviceName defaults to logger service) */
  tracer?: Omit<TracerConfig, 'serviceName'> & { serviceName?: string };
  /** Metric query function required by the alert manager */
  alertQueryFn?: MetricQueryFn;
  /** Options forwarded to createHealthMonitor */
  healthMonitor?: HealthMonitorOptions;
}

export interface ObservabilitySDK {
  logger: Logger;
  piiScrubber: PIIScrubber;
  metricsCollector: MetricsCollector;
  tracer: Tracer;
  alertManager: AlertManager;
  healthMonitor: HealthMonitor;
}

/**
 * Initialise all observability components in one call.
 */
export function createObservabilitySDK(config: ObservabilityConfig = {}): ObservabilitySDK {
  const serviceName = config.logger?.service ?? 'cashtrace';

  const logger = createLogger(config.logger);
  const piiScrubber = createPIIScrubber();
  const metricsCollector = createMetricsCollector(config.metrics);
  const tracer = createTracer({
    serviceName,
    ...config.tracer,
  });
  const alertManager = createAlertManager(
    config.alertQueryFn ?? ((): Promise<undefined> => Promise.resolve(undefined)),
  );
  const healthMonitor = createHealthMonitor(config.healthMonitor);

  return { logger, piiScrubber, metricsCollector, tracer, alertManager, healthMonitor };
}

/**
 * Gracefully shut down observability components that hold resources.
 * Currently flushes the tracer; extend as needed.
 */
export async function shutdownObservability(sdk: ObservabilitySDK): Promise<void> {
  // The tracer returned by createTracer exposes shutdown() on the extended type.
  // We call it if available.
  const tracerAny = sdk.tracer as unknown as Record<string, unknown>;
  if (typeof tracerAny['shutdown'] === 'function') {
    await (tracerAny['shutdown'] as () => Promise<void>)();
  }
}
