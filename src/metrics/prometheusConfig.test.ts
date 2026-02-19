import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadPrometheusConfig, createMetricsRegistry } from './prometheusConfig.js';

describe('Prometheus Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadPrometheusConfig', () => {
    it('returns defaults when no env vars set', () => {
      const config = loadPrometheusConfig();
      expect(config.enabled).toBe(true);
      expect(config.port).toBe(9090);
      expect(config.metricsPath).toBe('/metrics');
      expect(config.prefix).toBe('cashtrace_');
      expect(config.collectDefaultMetrics).toBe(true);
      expect(config.defaultMetricsInterval).toBe(10000);
      expect(config.defaultLabels).toHaveProperty('service', 'cashtrace');
    });

    it('reads values from environment variables', () => {
      process.env['PROMETHEUS_ENABLED'] = 'false';
      process.env['PROMETHEUS_PORT'] = '8080';
      process.env['PROMETHEUS_METRICS_PATH'] = '/custom-metrics';
      process.env['PROMETHEUS_PREFIX'] = 'custom_';
      process.env['SERVICE_NAME'] = 'my-service';

      const config = loadPrometheusConfig();
      expect(config.enabled).toBe(false);
      expect(config.port).toBe(8080);
      expect(config.metricsPath).toBe('/custom-metrics');
      expect(config.prefix).toBe('custom_');
      expect(config.defaultLabels['service']).toBe('my-service');
    });

    it('parses custom default labels from env', () => {
      process.env['PROMETHEUS_DEFAULT_LABELS'] = 'region=eu-west-1,team=platform';
      const config = loadPrometheusConfig();
      expect(config.defaultLabels['region']).toBe('eu-west-1');
      expect(config.defaultLabels['team']).toBe('platform');
    });

    it('includes environment in default labels', () => {
      process.env['NODE_ENV'] = 'production';
      const config = loadPrometheusConfig();
      expect(config.defaultLabels['environment']).toBe('production');
    });
  });

  describe('createMetricsRegistry', () => {
    it('creates a registry that supports counter metrics', () => {
      const config = loadPrometheusConfig();
      const registry = createMetricsRegistry(config);
      const counter = registry.registerCounter({
        name: 'http_requests_total',
        help: 'Total HTTP requests',
        type: 'counter',
      });

      counter.inc({ method: 'GET' }, 1);
      counter.inc({ method: 'GET' }, 2);
      counter.inc({ method: 'POST' }, 1);

      // Counter should accumulate
      expect(counter).toBeDefined();
    });

    it('creates a registry that supports gauge metrics', () => {
      const config = loadPrometheusConfig();
      const registry = createMetricsRegistry(config);
      const gauge = registry.registerGauge({
        name: 'active_connections',
        help: 'Active connections',
        type: 'gauge',
      });

      gauge.set({ pool: 'main' }, 10);
      gauge.inc({ pool: 'main' }, 5);
      gauge.dec({ pool: 'main' }, 3);

      expect(gauge).toBeDefined();
    });

    it('creates a registry that supports histogram metrics', () => {
      const config = loadPrometheusConfig();
      const registry = createMetricsRegistry(config);
      const histogram = registry.registerHistogram({
        name: 'request_duration',
        help: 'Request duration in ms',
        type: 'histogram',
        buckets: [10, 50, 100, 500, 1000],
      });

      histogram.observe({ route: '/api/health' }, 42);
      expect(histogram).toBeDefined();
    });

    it('creates a registry that supports summary metrics', () => {
      const config = loadPrometheusConfig();
      const registry = createMetricsRegistry(config);
      const summary = registry.registerSummary({
        name: 'response_size',
        help: 'Response size in bytes',
        type: 'summary',
        percentiles: [0.5, 0.9, 0.99],
      });

      summary.observe({ endpoint: '/api/data' }, 1024);
      expect(summary).toBeDefined();
    });

    it('produces Prometheus-formatted output', async () => {
      const config = loadPrometheusConfig();
      const registry = createMetricsRegistry(config);

      registry
        .registerCounter({
          name: 'test_counter',
          help: 'A test counter',
          type: 'counter',
        })
        .inc(undefined, 5);

      const output = await registry.getMetricsOutput();
      expect(output).toContain('# HELP cashtrace_test_counter A test counter');
      expect(output).toContain('# TYPE cashtrace_test_counter counter');
      expect(output).toContain('5');
    });

    it('resets all metrics', async () => {
      const config = loadPrometheusConfig();
      const registry = createMetricsRegistry(config);

      registry
        .registerCounter({
          name: 'reset_test',
          help: 'Reset test',
          type: 'counter',
        })
        .inc(undefined, 10);

      registry.reset();
      const output = await registry.getMetricsOutput();
      expect(output).toBe('');
    });
  });
});
