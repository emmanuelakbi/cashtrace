import { describe, it, expect, beforeEach } from 'vitest';
import { createMetricsCollector, type MetricsCollector } from './collector.js';
import { createHttpMetrics, classifyStatusCode, type HttpMetrics } from './httpMetrics.js';
import { loadPrometheusConfig } from './prometheusConfig.js';

describe('HttpMetrics', () => {
  let collector: MetricsCollector;
  let httpMetrics: HttpMetrics;

  beforeEach(() => {
    collector = createMetricsCollector(loadPrometheusConfig());
    httpMetrics = createHttpMetrics(collector);
  });

  describe('classifyStatusCode', () => {
    it('classifies 2xx status codes', () => {
      expect(classifyStatusCode(200)).toBe('2xx');
      expect(classifyStatusCode(201)).toBe('2xx');
      expect(classifyStatusCode(204)).toBe('2xx');
    });

    it('classifies 3xx status codes', () => {
      expect(classifyStatusCode(301)).toBe('3xx');
      expect(classifyStatusCode(304)).toBe('3xx');
    });

    it('classifies 4xx status codes', () => {
      expect(classifyStatusCode(400)).toBe('4xx');
      expect(classifyStatusCode(404)).toBe('4xx');
      expect(classifyStatusCode(422)).toBe('4xx');
    });

    it('classifies 5xx status codes', () => {
      expect(classifyStatusCode(500)).toBe('5xx');
      expect(classifyStatusCode(503)).toBe('5xx');
    });

    it('classifies 1xx status codes', () => {
      expect(classifyStatusCode(100)).toBe('1xx');
    });
  });

  describe('recordRequest', () => {
    it('increments request count with method, route, and status_code labels', async () => {
      httpMetrics.recordRequest({
        method: 'GET',
        route: '/api/users',
        statusCode: 200,
        durationMs: 50,
      });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('http_requests_total');
      expect(output).toContain('method="GET"');
      expect(output).toContain('route="/api/users"');
      expect(output).toContain('status_code="200"');
    });

    it('records latency in the histogram with method and route labels', async () => {
      httpMetrics.recordRequest({
        method: 'POST',
        route: '/api/transactions',
        statusCode: 201,
        durationMs: 123.45,
      });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('http_request_duration_ms');
      expect(output).toContain('method="POST"');
      expect(output).toContain('route="/api/transactions"');
    });

    it('increments status class counter', async () => {
      httpMetrics.recordRequest({
        method: 'GET',
        route: '/api/health',
        statusCode: 200,
        durationMs: 5,
      });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('http_status_total');
      expect(output).toContain('status_class="2xx"');
    });

    it('normalizes method to uppercase', async () => {
      httpMetrics.recordRequest({
        method: 'get',
        route: '/api/data',
        statusCode: 200,
        durationMs: 10,
      });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('method="GET"');
    });

    it('tracks multiple requests with different routes', async () => {
      httpMetrics.recordRequest({
        method: 'GET',
        route: '/api/users',
        statusCode: 200,
        durationMs: 30,
      });
      httpMetrics.recordRequest({
        method: 'GET',
        route: '/api/transactions',
        statusCode: 200,
        durationMs: 80,
      });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('route="/api/users"');
      expect(output).toContain('route="/api/transactions"');
    });

    it('tracks multiple status classes from different requests', async () => {
      httpMetrics.recordRequest({
        method: 'GET',
        route: '/api/users',
        statusCode: 200,
        durationMs: 10,
      });
      httpMetrics.recordRequest({
        method: 'GET',
        route: '/api/missing',
        statusCode: 404,
        durationMs: 5,
      });
      httpMetrics.recordRequest({
        method: 'POST',
        route: '/api/fail',
        statusCode: 500,
        durationMs: 200,
      });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('status_class="2xx"');
      expect(output).toContain('status_class="4xx"');
      expect(output).toContain('status_class="5xx"');
    });
  });

  describe('custom latency buckets', () => {
    it('accepts custom latency buckets', async () => {
      const customMetrics = createHttpMetrics(collector, {
        latencyBuckets: [1, 5, 10],
      });

      customMetrics.recordRequest({
        method: 'GET',
        route: '/fast',
        statusCode: 200,
        durationMs: 2,
      });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('http_request_duration_ms');
    });
  });

  describe('accessor methods', () => {
    it('returns the request counter', () => {
      const counter = httpMetrics.getRequestCounter();
      expect(counter).toBeDefined();
      expect(typeof counter.inc).toBe('function');
    });

    it('returns the latency histogram', () => {
      const histogram = httpMetrics.getLatencyHistogram();
      expect(histogram).toBeDefined();
      expect(typeof histogram.observe).toBe('function');
    });

    it('returns the status counter', () => {
      const counter = httpMetrics.getStatusCounter();
      expect(counter).toBeDefined();
      expect(typeof counter.inc).toBe('function');
    });
  });
});
