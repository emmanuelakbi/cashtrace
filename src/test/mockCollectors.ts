/**
 * Mock collectors for observability property-based testing.
 *
 * Provides in-memory collectors that capture log entries, metric observations,
 * and trace spans for assertion in tests. These replace real external backends
 * (CloudWatch, Prometheus, Jaeger) so tests run fast and deterministically.
 *
 * @module test/mockCollectors
 */

import type { LogBatchEntry, LogAggregationClient } from '../logging/cloudwatchConfig.js';
import type {
  Labels,
  MetricDefinition,
  MetricsRegistry,
  CounterMetric,
  GaugeMetric,
  HistogramMetric,
  SummaryMetric,
} from '../metrics/prometheusConfig.js';
import type { SpanData, SpanExporter } from '../tracing/opentelemetryConfig.js';

// ─── Log Collector ───────────────────────────────────────────────────────────

export interface CapturedLogEntry {
  timestamp: string;
  message: string;
  receivedAt: number;
}

export interface MockLogCollector extends LogAggregationClient {
  /** All log entries captured so far. */
  readonly entries: ReadonlyArray<CapturedLogEntry>;
  /** Clear all captured entries. */
  clear(): void;
  /** Number of send() calls made. */
  readonly sendCount: number;
}

export function createMockLogCollector(): MockLogCollector {
  const entries: CapturedLogEntry[] = [];
  let sendCount = 0;

  return {
    get entries() {
      return entries;
    },
    get sendCount() {
      return sendCount;
    },
    async send(batch: LogBatchEntry[]): Promise<void> {
      sendCount++;
      const now = Date.now();
      for (const entry of batch) {
        entries.push({
          timestamp: entry.timestamp,
          message: entry.message,
          receivedAt: now,
        });
      }
    },
    async healthCheck(): Promise<boolean> {
      return true;
    },
    async close(): Promise<void> {
      // no-op
    },
    clear() {
      entries.length = 0;
      sendCount = 0;
    },
  };
}

// ─── Metrics Collector ───────────────────────────────────────────────────────

export interface MetricObservation {
  name: string;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  labels: Labels;
  value: number;
  observedAt: number;
}

export interface MockMetricsCollector extends MetricsRegistry {
  /** All metric observations captured so far. */
  readonly observations: ReadonlyArray<MetricObservation>;
  /** Clear all captured observations. */
  clear(): void;
}

export function createMockMetricsCollector(): MockMetricsCollector {
  const observations: MetricObservation[] = [];
  const definitions = new Map<string, MetricDefinition>();

  function record(name: string, type: MetricObservation['type'], labels: Labels, value: number) {
    observations.push({ name, type, labels: { ...labels }, value, observedAt: Date.now() });
  }

  return {
    get observations() {
      return observations;
    },

    registerCounter(def: MetricDefinition): CounterMetric {
      definitions.set(def.name, def);
      return {
        inc(labels?: Labels, value = 1) {
          record(def.name, 'counter', labels ?? {}, value);
        },
      };
    },

    registerGauge(def: MetricDefinition): GaugeMetric {
      definitions.set(def.name, def);
      return {
        set(labels: Labels, value: number) {
          record(def.name, 'gauge', labels, value);
        },
        inc(labels?: Labels, value = 1) {
          record(def.name, 'gauge', labels ?? {}, value);
        },
        dec(labels?: Labels, value = 1) {
          record(def.name, 'gauge', labels ?? {}, -value);
        },
      };
    },

    registerHistogram(def: MetricDefinition): HistogramMetric {
      definitions.set(def.name, def);
      return {
        observe(labels: Labels, value: number) {
          record(def.name, 'histogram', labels, value);
        },
      };
    },

    registerSummary(def: MetricDefinition): SummaryMetric {
      definitions.set(def.name, def);
      return {
        observe(labels: Labels, value: number) {
          record(def.name, 'summary', labels, value);
        },
      };
    },

    async getMetricsOutput(): Promise<string> {
      // Simplified output for testing
      return observations
        .map((o) => `${o.name}{${JSON.stringify(o.labels)}} ${o.value}`)
        .join('\n');
    },

    reset() {
      observations.length = 0;
      definitions.clear();
    },

    clear() {
      observations.length = 0;
      definitions.clear();
    },
  };
}

// ─── Span Collector ──────────────────────────────────────────────────────────

export interface MockSpanCollector extends SpanExporter {
  /** All spans captured so far. */
  readonly spans: ReadonlyArray<SpanData>;
  /** Clear all captured spans. */
  clear(): void;
  /** Number of export() calls made. */
  readonly exportCount: number;
  /** Find spans by name. */
  findByName(name: string): SpanData[];
  /** Find spans belonging to a specific trace. */
  findByTraceId(traceId: string): SpanData[];
}

export function createMockSpanCollector(): MockSpanCollector {
  const spans: SpanData[] = [];
  let exportCount = 0;

  return {
    get spans() {
      return spans;
    },
    get exportCount() {
      return exportCount;
    },
    async export(batch: SpanData[]): Promise<void> {
      exportCount++;
      spans.push(...batch);
    },
    async shutdown(): Promise<void> {
      // no-op
    },
    clear() {
      spans.length = 0;
      exportCount = 0;
    },
    findByName(name: string): SpanData[] {
      return spans.filter((s) => s.name === name);
    },
    findByTraceId(traceId: string): SpanData[] {
      return spans.filter((s) => s.context.traceId === traceId);
    },
  };
}

// ─── Convenience: Create All Mock Collectors ─────────────────────────────────

export interface MockCollectors {
  logs: MockLogCollector;
  metrics: MockMetricsCollector;
  spans: MockSpanCollector;
  /** Reset all collectors at once. */
  clearAll(): void;
}

/**
 * Create a full set of mock collectors for observability tests.
 * Call `clearAll()` in beforeEach to reset state between tests.
 */
export function createMockCollectors(): MockCollectors {
  const logs = createMockLogCollector();
  const metrics = createMockMetricsCollector();
  const spans = createMockSpanCollector();

  return {
    logs,
    metrics,
    spans,
    clearAll() {
      logs.clear();
      metrics.clear();
      spans.clear();
    },
  };
}
