/**
 * Metrics Collector
 *
 * High-level Prometheus-compatible metrics collector that provides
 * counter, gauge, histogram, and summary metric types.
 * Wraps the underlying MetricsRegistry for metric creation and management.
 */

import {
  type MetricsRegistry,
  type Labels,
  type PrometheusConfig,
  createMetricsRegistry,
  loadPrometheusConfig,
} from './prometheusConfig.js';

export type { Labels } from './prometheusConfig.js';

export interface Counter {
  inc(value?: number, labels?: Labels): void;
}

export interface Gauge {
  set(value: number, labels?: Labels): void;
  inc(value?: number, labels?: Labels): void;
  dec(value?: number, labels?: Labels): void;
}

export interface Histogram {
  observe(value: number, labels?: Labels): void;
}

export interface Summary {
  observe(value: number, labels?: Labels): void;
}

export interface MetricsCollector {
  counter(name: string, labels?: Labels): Counter;
  gauge(name: string, labels?: Labels): Gauge;
  histogram(name: string, buckets: number[], labels?: Labels): Histogram;
  summary(name: string, percentiles: number[], labels?: Labels): Summary;
  getMetricsOutput(): Promise<string>;
  reset(): void;
}

/**
 * Creates a MetricsCollector backed by an in-memory MetricsRegistry.
 * Caches metric instances by name so repeated calls return the same metric.
 */
export function createMetricsCollector(config?: PrometheusConfig): MetricsCollector {
  const resolvedConfig = config ?? loadPrometheusConfig();
  const registry: MetricsRegistry = createMetricsRegistry(resolvedConfig);

  const counters = new Map<string, Counter>();
  const gauges = new Map<string, Gauge>();
  const histograms = new Map<string, Histogram>();
  const summaries = new Map<string, Summary>();

  return {
    counter(name: string, _labels?: Labels): Counter {
      const existing = counters.get(name);
      if (existing) return existing;

      const raw = registry.registerCounter({
        name,
        help: `Counter: ${name}`,
        type: 'counter',
        labelNames: _labels ? Object.keys(_labels) : undefined,
      });

      const counter: Counter = {
        inc(value = 1, labels?: Labels) {
          raw.inc(labels, value);
        },
      };

      counters.set(name, counter);
      return counter;
    },

    gauge(name: string, _labels?: Labels): Gauge {
      const existing = gauges.get(name);
      if (existing) return existing;

      const raw = registry.registerGauge({
        name,
        help: `Gauge: ${name}`,
        type: 'gauge',
        labelNames: _labels ? Object.keys(_labels) : undefined,
      });

      const gauge: Gauge = {
        set(value: number, labels?: Labels) {
          raw.set(labels ?? {}, value);
        },
        inc(value = 1, labels?: Labels) {
          raw.inc(labels, value);
        },
        dec(value = 1, labels?: Labels) {
          raw.dec(labels, value);
        },
      };

      gauges.set(name, gauge);
      return gauge;
    },

    histogram(name: string, buckets: number[], _labels?: Labels): Histogram {
      const existing = histograms.get(name);
      if (existing) return existing;

      const raw = registry.registerHistogram({
        name,
        help: `Histogram: ${name}`,
        type: 'histogram',
        buckets,
        labelNames: _labels ? Object.keys(_labels) : undefined,
      });

      const histogram: Histogram = {
        observe(value: number, labels?: Labels) {
          raw.observe(labels ?? {}, value);
        },
      };

      histograms.set(name, histogram);
      return histogram;
    },

    summary(name: string, percentiles: number[], _labels?: Labels): Summary {
      const existing = summaries.get(name);
      if (existing) return existing;

      const raw = registry.registerSummary({
        name,
        help: `Summary: ${name}`,
        type: 'summary',
        percentiles,
        labelNames: _labels ? Object.keys(_labels) : undefined,
      });

      const summary: Summary = {
        observe(value: number, labels?: Labels) {
          raw.observe(labels ?? {}, value);
        },
      };

      summaries.set(name, summary);
      return summary;
    },

    async getMetricsOutput(): Promise<string> {
      return registry.getMetricsOutput();
    },

    reset() {
      counters.clear();
      gauges.clear();
      histograms.clear();
      summaries.clear();
      registry.reset();
    },
  };
}
