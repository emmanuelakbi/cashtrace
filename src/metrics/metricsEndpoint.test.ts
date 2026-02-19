import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createMetricsCollector, type MetricsCollector } from './collector.js';
import { createMetricsEndpoint, PROMETHEUS_CONTENT_TYPE } from './metricsEndpoint.js';
import { loadPrometheusConfig } from './prometheusConfig.js';

describe('metricsEndpoint', () => {
  let collector: MetricsCollector;
  let app: express.Express;

  beforeEach(() => {
    collector = createMetricsCollector(loadPrometheusConfig());
    app = express();
    app.use(createMetricsEndpoint(collector));
  });

  it('responds with 200 on GET /metrics', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
  });

  it('returns Prometheus content type header', async () => {
    const res = await request(app).get('/metrics');
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.headers['content-type']).toContain('version=0.0.4');
  });

  it('returns empty body when no metrics are registered', async () => {
    const res = await request(app).get('/metrics');
    expect(res.text).toBe('');
  });

  it('returns counter metrics in Prometheus format', async () => {
    const counter = collector.counter('http_requests_total');
    counter.inc(5);

    const res = await request(app).get('/metrics');
    expect(res.text).toContain('# HELP cashtrace_http_requests_total');
    expect(res.text).toContain('# TYPE cashtrace_http_requests_total counter');
    expect(res.text).toContain('cashtrace_http_requests_total');
  });

  it('returns gauge metrics in Prometheus format', async () => {
    const gauge = collector.gauge('active_connections');
    gauge.set(42);

    const res = await request(app).get('/metrics');
    expect(res.text).toContain('# TYPE cashtrace_active_connections gauge');
    expect(res.text).toContain('42');
  });

  it('returns histogram metrics in Prometheus format', async () => {
    const histogram = collector.histogram('request_duration_ms', [10, 50, 100]);
    histogram.observe(25, { route: '/api/health' });

    const res = await request(app).get('/metrics');
    expect(res.text).toContain('# TYPE cashtrace_request_duration_ms histogram');
    expect(res.text).toContain('route="/api/health"');
  });

  it('returns multiple metrics together', async () => {
    collector.counter('req_count').inc(3);
    collector.gauge('mem_usage').set(1024);

    const res = await request(app).get('/metrics');
    expect(res.text).toContain('cashtrace_req_count');
    expect(res.text).toContain('cashtrace_mem_usage');
  });

  it('returns 500 when collector throws', async () => {
    // Create a collector that throws on getMetricsOutput
    const brokenCollector: MetricsCollector = {
      counter: collector.counter,
      gauge: collector.gauge,
      histogram: collector.histogram,
      summary: collector.summary,
      reset: collector.reset,
      async getMetricsOutput(): Promise<string> {
        throw new Error('registry failure');
      },
    };

    const errorApp = express();
    errorApp.use(createMetricsEndpoint(brokenCollector));

    const res = await request(errorApp).get('/metrics');
    expect(res.status).toBe(500);
    expect(res.text).toContain('Error collecting metrics');
  });

  it('exports PROMETHEUS_CONTENT_TYPE constant', () => {
    expect(PROMETHEUS_CONTENT_TYPE).toBe('text/plain; version=0.0.4; charset=utf-8');
  });
});
