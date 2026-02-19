/**
 * Prometheus Client Configuration
 *
 * Provides configuration and client abstraction for Prometheus-compatible
 * metrics collection. Configurable via environment variables.
 */

export interface PrometheusConfig {
  enabled: boolean;
  port: number;
  metricsPath: string;
  defaultLabels: Record<string, string>;
  prefix: string;
  collectDefaultMetrics: boolean;
  defaultMetricsInterval: number;
}

export function loadPrometheusConfig(): PrometheusConfig {
  const defaultLabelsEnv = process.env['PROMETHEUS_DEFAULT_LABELS'] ?? '';
  const defaultLabels: Record<string, string> = {
    service: process.env['SERVICE_NAME'] ?? 'cashtrace',
    environment: process.env['NODE_ENV'] ?? 'development',
  };

  if (defaultLabelsEnv) {
    for (const pair of defaultLabelsEnv.split(',')) {
      const [key, value] = pair.split('=');
      if (key && value) {
        defaultLabels[key.trim()] = value.trim();
      }
    }
  }

  return {
    enabled: process.env['PROMETHEUS_ENABLED'] !== 'false',
    port: parseInt(process.env['PROMETHEUS_PORT'] ?? '9090', 10),
    metricsPath: process.env['PROMETHEUS_METRICS_PATH'] ?? '/metrics',
    defaultLabels,
    prefix: process.env['PROMETHEUS_PREFIX'] ?? 'cashtrace_',
    collectDefaultMetrics: process.env['PROMETHEUS_COLLECT_DEFAULT'] !== 'false',
    defaultMetricsInterval: parseInt(
      process.env['PROMETHEUS_DEFAULT_METRICS_INTERVAL'] ?? '10000',
      10,
    ),
  };
}

/**
 * Metric type definitions for the Prometheus-compatible collector.
 */
export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

export interface MetricDefinition {
  name: string;
  help: string;
  type: MetricType;
  labelNames?: string[];
  buckets?: number[];
  percentiles?: number[];
}

export type Labels = Record<string, string>;

/**
 * Abstraction over a Prometheus-compatible metrics registry.
 * In production, this would wrap prom-client.
 */
export interface MetricsRegistry {
  registerCounter(def: MetricDefinition): CounterMetric;
  registerGauge(def: MetricDefinition): GaugeMetric;
  registerHistogram(def: MetricDefinition): HistogramMetric;
  registerSummary(def: MetricDefinition): SummaryMetric;
  getMetricsOutput(): Promise<string>;
  reset(): void;
}

export interface CounterMetric {
  inc(labels?: Labels, value?: number): void;
}

export interface GaugeMetric {
  set(labels: Labels, value: number): void;
  inc(labels?: Labels, value?: number): void;
  dec(labels?: Labels, value?: number): void;
}

export interface HistogramMetric {
  observe(labels: Labels, value: number): void;
}

export interface SummaryMetric {
  observe(labels: Labels, value: number): void;
}

/**
 * In-memory metrics registry for development and testing.
 * In production, replace with prom-client backed implementation.
 */
export function createMetricsRegistry(config: PrometheusConfig): MetricsRegistry {
  const metrics = new Map<string, { def: MetricDefinition; values: Map<string, number> }>();

  function labelsKey(labels?: Labels): string {
    if (!labels || Object.keys(labels).length === 0) return '__default__';
    const merged = { ...config.defaultLabels, ...labels };
    return Object.entries(merged)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }

  return {
    registerCounter(def: MetricDefinition): CounterMetric {
      const entry = { def, values: new Map<string, number>() };
      metrics.set(def.name, entry);
      return {
        inc(labels?: Labels, value = 1) {
          const key = labelsKey(labels);
          entry.values.set(key, (entry.values.get(key) ?? 0) + value);
        },
      };
    },

    registerGauge(def: MetricDefinition): GaugeMetric {
      const entry = { def, values: new Map<string, number>() };
      metrics.set(def.name, entry);
      return {
        set(labels: Labels, value: number) {
          entry.values.set(labelsKey(labels), value);
        },
        inc(labels?: Labels, value = 1) {
          const key = labelsKey(labels);
          entry.values.set(key, (entry.values.get(key) ?? 0) + value);
        },
        dec(labels?: Labels, value = 1) {
          const key = labelsKey(labels);
          entry.values.set(key, (entry.values.get(key) ?? 0) - value);
        },
      };
    },

    registerHistogram(def: MetricDefinition): HistogramMetric {
      const entry = { def, values: new Map<string, number>() };
      metrics.set(def.name, entry);
      return {
        observe(labels: Labels, value: number) {
          const key = labelsKey(labels);
          // Store latest observation; full histogram bucketing is handled in production by prom-client
          entry.values.set(key, value);
        },
      };
    },

    registerSummary(def: MetricDefinition): SummaryMetric {
      const entry = { def, values: new Map<string, number>() };
      metrics.set(def.name, entry);
      return {
        observe(labels: Labels, value: number) {
          const key = labelsKey(labels);
          entry.values.set(key, value);
        },
      };
    },

    async getMetricsOutput(): Promise<string> {
      const lines: string[] = [];
      for (const [name, entry] of metrics) {
        lines.push(`# HELP ${config.prefix}${name} ${entry.def.help}`);
        lines.push(`# TYPE ${config.prefix}${name} ${entry.def.type}`);
        for (const [labelKey, value] of entry.values) {
          if (labelKey === '__default__') {
            lines.push(`${config.prefix}${name} ${value}`);
          } else {
            lines.push(`${config.prefix}${name}{${labelKey}} ${value}`);
          }
        }
      }
      return lines.join('\n');
    },

    reset() {
      metrics.clear();
    },
  };
}
