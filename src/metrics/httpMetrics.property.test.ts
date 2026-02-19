/**
 * Property-based tests for HTTP Metric Accuracy
 *
 * **Property 3: Metric Accuracy**
 * For any HTTP request, latency histogram SHALL accurately reflect
 * the actual request duration within 1ms.
 *
 * **Validates: Requirements 3.1**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createMetricsCollector, type MetricsCollector } from './collector.js';
import { createHttpMetrics, classifyStatusCode, type HttpMetrics } from './httpMetrics.js';
import type { PrometheusConfig } from './prometheusConfig.js';

// ─── Test Config ─────────────────────────────────────────────────────────────

const TEST_CONFIG: PrometheusConfig = {
  enabled: true,
  port: 9090,
  metricsPath: '/metrics',
  defaultLabels: {},
  prefix: 'test_',
  collectDefaultMetrics: false,
  defaultMetricsInterval: 10000,
};

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid HTTP method. */
const httpMethodArb = fc.constantFrom('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS');

/** Generate a realistic route path. */
const routeArb = fc
  .tuple(
    fc.constantFrom('/api', '/v1', '/v2'),
    fc.constantFrom('/users', '/transactions', '/invoices', '/payments', '/reports', '/auth'),
    fc.oneof(fc.constant(''), fc.constant('/:id'), fc.constant('/list'), fc.constant('/search')),
  )
  .map(([prefix, resource, suffix]) => `${prefix}${resource}${suffix}`);

/** Generate a valid HTTP status code. */
const statusCodeArb = fc.oneof(
  fc.constantFrom(200, 201, 204),
  fc.constantFrom(301, 302, 304),
  fc.constantFrom(400, 401, 403, 404, 422, 429),
  fc.constantFrom(500, 502, 503, 504),
);

/** Generate a positive duration in milliseconds (0.01ms to 30000ms). */
const durationMsArb = fc.double({ min: 0.01, max: 30000, noNaN: true, noDefaultInfinity: true });

/** Generate a complete HTTP request info record. */
const httpRequestInfoArb = fc.record({
  method: httpMethodArb,
  route: routeArb,
  statusCode: statusCodeArb,
  durationMs: durationMsArb,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function freshCollectorAndMetrics(): { collector: MetricsCollector; httpMetrics: HttpMetrics } {
  const collector = createMetricsCollector(TEST_CONFIG);
  const httpMetrics = createHttpMetrics(collector);
  return { collector, httpMetrics };
}

/**
 * Parse the numeric value from a Prometheus metric line.
 * Lines look like: `test_http_requests_total{method="GET",...} 1`
 */
function parseMetricValue(line: string): number {
  return parseFloat(line.split(' ').pop()!);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Property 3: Metric Accuracy', () => {
  /**
   * **Validates: Requirements 3.1**
   *
   * For any HTTP request with arbitrary method, route, status code, and duration,
   * the latency histogram SHALL record the duration value accurately (within 1ms).
   */
  it('records latency accurately within 1ms for any HTTP request', async () => {
    await fc.assert(
      fc.asyncProperty(httpRequestInfoArb, async (requestInfo) => {
        const { collector, httpMetrics } = freshCollectorAndMetrics();

        httpMetrics.recordRequest(requestInfo);

        const output = await collector.getMetricsOutput();
        const lines = output.split('\n');

        // Find the histogram data line (not HELP or TYPE comments)
        const histogramLine = lines.find(
          (line) => line.startsWith('test_http_request_duration_ms{') && !line.startsWith('#'),
        );
        expect(histogramLine).toBeDefined();

        const recordedValue = parseMetricValue(histogramLine!);
        const difference = Math.abs(recordedValue - requestInfo.durationMs);
        expect(difference).toBeLessThanOrEqual(1);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * For any HTTP request, the request counter SHALL accurately count
   * each request exactly once with correct method, route, and status labels.
   */
  it('counts each request exactly once with correct labels', async () => {
    await fc.assert(
      fc.asyncProperty(httpRequestInfoArb, async (requestInfo) => {
        const { collector, httpMetrics } = freshCollectorAndMetrics();

        httpMetrics.recordRequest(requestInfo);

        const output = await collector.getMetricsOutput();
        const methodUpper = requestInfo.method.toUpperCase();
        const lines = output.split('\n');

        // Find the counter line matching our labels
        const counterLine = lines.find(
          (line) =>
            line.startsWith('test_http_requests_total{') &&
            line.includes(`method="${methodUpper}"`) &&
            line.includes(`route="${requestInfo.route}"`) &&
            line.includes(`status_code="${requestInfo.statusCode}"`),
        );
        expect(counterLine).toBeDefined();
        expect(parseMetricValue(counterLine!)).toBe(1);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * For any HTTP request, the status class counter SHALL correctly
   * classify the status code (e.g. 200 → "2xx", 404 → "4xx").
   */
  it('classifies status codes correctly into status classes', async () => {
    await fc.assert(
      fc.asyncProperty(httpRequestInfoArb, async (requestInfo) => {
        const { collector, httpMetrics } = freshCollectorAndMetrics();

        httpMetrics.recordRequest(requestInfo);

        const expectedClass = classifyStatusCode(requestInfo.statusCode);
        const output = await collector.getMetricsOutput();
        const lines = output.split('\n');

        const statusLine = lines.find(
          (line) =>
            line.startsWith('test_http_status_total{') &&
            line.includes(`status_class="${expectedClass}"`),
        );
        expect(statusLine).toBeDefined();
        expect(parseMetricValue(statusLine!)).toBe(1);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * For any sequence of HTTP requests to the same route, the request counter
   * SHALL accumulate correctly (counter monotonically increases).
   */
  it('accumulates request counts correctly for multiple requests', async () => {
    await fc.assert(
      fc.asyncProperty(
        httpMethodArb,
        routeArb,
        statusCodeArb,
        fc.array(durationMsArb, { minLength: 2, maxLength: 10 }),
        async (method, route, statusCode, durations) => {
          const { collector, httpMetrics } = freshCollectorAndMetrics();

          for (const durationMs of durations) {
            httpMetrics.recordRequest({ method, route, statusCode, durationMs });
          }

          const output = await collector.getMetricsOutput();
          const methodUpper = method.toUpperCase();
          const lines = output.split('\n');

          // Verify request counter equals the number of requests
          const counterLine = lines.find(
            (line) =>
              line.startsWith('test_http_requests_total{') &&
              line.includes(`method="${methodUpper}"`) &&
              line.includes(`route="${route}"`),
          );
          expect(counterLine).toBeDefined();
          expect(parseMetricValue(counterLine!)).toBe(durations.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
