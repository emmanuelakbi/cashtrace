import { describe, it, expect, beforeEach } from 'vitest';
import { createMetricsCollector, type MetricsCollector } from './collector.js';
import { loadPrometheusConfig } from './prometheusConfig.js';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    const config = loadPrometheusConfig();
    collector = createMetricsCollector(config);
  });

  describe('counter', () => {
    it('increments by 1 by default', async () => {
      const counter = collector.counter('http_requests_total');
      counter.inc();
      counter.inc();

      const output = await collector.getMetricsOutput();
      expect(output).toContain('http_requests_total');
      expect(output).toContain('2');
    });

    it('increments by a custom value', async () => {
      const counter = collector.counter('bytes_sent');
      counter.inc(100);
      counter.inc(50);

      const output = await collector.getMetricsOutput();
      expect(output).toContain('bytes_sent');
      expect(output).toContain('150');
    });

    it('supports labels', async () => {
      const counter = collector.counter('http_requests_total');
      counter.inc(1, { method: 'GET' });
      counter.inc(1, { method: 'POST' });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('method="GET"');
      expect(output).toContain('method="POST"');
    });

    it('returns the same counter for the same name', () => {
      const c1 = collector.counter('my_counter');
      const c2 = collector.counter('my_counter');
      expect(c1).toBe(c2);
    });
  });

  describe('gauge', () => {
    it('sets a value', async () => {
      const gauge = collector.gauge('active_connections');
      gauge.set(42);

      const output = await collector.getMetricsOutput();
      expect(output).toContain('active_connections');
      expect(output).toContain('42');
    });

    it('increments and decrements', async () => {
      const gauge = collector.gauge('queue_size');
      gauge.inc(10);
      gauge.dec(3);

      const output = await collector.getMetricsOutput();
      expect(output).toContain('queue_size');
      expect(output).toContain('7');
    });

    it('supports labels on set', async () => {
      const gauge = collector.gauge('pool_size');
      gauge.set(5, { pool: 'main' });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('pool="main"');
    });

    it('increments by 1 by default', async () => {
      const gauge = collector.gauge('connections');
      gauge.inc();

      const output = await collector.getMetricsOutput();
      expect(output).toContain('1');
    });

    it('decrements by 1 by default', async () => {
      const gauge = collector.gauge('connections');
      gauge.set(5);
      gauge.dec();

      const output = await collector.getMetricsOutput();
      expect(output).toContain('4');
    });

    it('returns the same gauge for the same name', () => {
      const g1 = collector.gauge('my_gauge');
      const g2 = collector.gauge('my_gauge');
      expect(g1).toBe(g2);
    });
  });

  describe('histogram', () => {
    it('observes values', async () => {
      const histogram = collector.histogram('request_duration', [10, 50, 100, 500]);
      histogram.observe(42);

      const output = await collector.getMetricsOutput();
      expect(output).toContain('request_duration');
      expect(output).toContain('42');
    });

    it('supports labels', async () => {
      const histogram = collector.histogram('request_duration', [10, 50, 100]);
      histogram.observe(25, { route: '/api/health' });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('route="/api/health"');
    });

    it('returns the same histogram for the same name', () => {
      const h1 = collector.histogram('latency', [10, 50]);
      const h2 = collector.histogram('latency', [10, 50]);
      expect(h1).toBe(h2);
    });
  });

  describe('summary', () => {
    it('observes values', async () => {
      const summary = collector.summary('response_size', [0.5, 0.9, 0.99]);
      summary.observe(1024);

      const output = await collector.getMetricsOutput();
      expect(output).toContain('response_size');
      expect(output).toContain('1024');
    });

    it('supports labels', async () => {
      const summary = collector.summary('response_size', [0.5, 0.9]);
      summary.observe(512, { endpoint: '/api/data' });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('endpoint="/api/data"');
    });

    it('returns the same summary for the same name', () => {
      const s1 = collector.summary('size', [0.5]);
      const s2 = collector.summary('size', [0.5]);
      expect(s1).toBe(s2);
    });
  });

  describe('Prometheus output format', () => {
    it('includes HELP and TYPE lines', async () => {
      collector.counter('test_counter');
      const output = await collector.getMetricsOutput();
      expect(output).toContain('# HELP');
      expect(output).toContain('# TYPE');
      expect(output).toContain('counter');
    });

    it('applies the configured prefix', async () => {
      const counter = collector.counter('my_metric');
      counter.inc();

      const output = await collector.getMetricsOutput();
      expect(output).toContain('cashtrace_my_metric');
    });
  });

  describe('reset', () => {
    it('clears all metrics', async () => {
      collector.counter('c').inc();
      collector.gauge('g').set(1);
      collector.histogram('h', [10]).observe(5);
      collector.summary('s', [0.5]).observe(100);

      collector.reset();

      const output = await collector.getMetricsOutput();
      expect(output).toBe('');
    });

    it('allows re-registering metrics after reset', async () => {
      collector.counter('reuse').inc(5);
      collector.reset();

      const counter = collector.counter('reuse');
      counter.inc(3);

      const output = await collector.getMetricsOutput();
      expect(output).toContain('3');
    });
  });

  describe('default config', () => {
    it('creates collector without explicit config', async () => {
      const defaultCollector = createMetricsCollector();
      const counter = defaultCollector.counter('auto_config_test');
      counter.inc();

      const output = await defaultCollector.getMetricsOutput();
      expect(output).toContain('auto_config_test');
    });
  });
});
