/**
 * Tests for mock collectors used in observability property-based testing.
 *
 * Validates that mock log, metrics, and span collectors correctly capture
 * data for assertion in tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  createMockLogCollector,
  createMockMetricsCollector,
  createMockSpanCollector,
  createMockCollectors,
} from './mockCollectors.js';
import type { SpanData } from '../tracing/opentelemetryConfig.js';
import { logLevelArb, metricNameArb, latencyMsArb } from './arbitraries.js';

describe('MockLogCollector', () => {
  it('captures sent log entries', async () => {
    const collector = createMockLogCollector();
    await collector.send([{ timestamp: '2024-01-01T00:00:00Z', message: 'test log' }]);

    expect(collector.entries).toHaveLength(1);
    expect(collector.entries[0]!.message).toBe('test log');
    expect(collector.sendCount).toBe(1);
  });

  it('captures multiple batches', async () => {
    const collector = createMockLogCollector();
    await collector.send([{ timestamp: '2024-01-01T00:00:00Z', message: 'first' }]);
    await collector.send([{ timestamp: '2024-01-01T00:00:01Z', message: 'second' }]);

    expect(collector.entries).toHaveLength(2);
    expect(collector.sendCount).toBe(2);
  });

  it('clears all state', async () => {
    const collector = createMockLogCollector();
    await collector.send([{ timestamp: '2024-01-01T00:00:00Z', message: 'test' }]);
    collector.clear();

    expect(collector.entries).toHaveLength(0);
    expect(collector.sendCount).toBe(0);
  });

  it('reports healthy', async () => {
    const collector = createMockLogCollector();
    expect(await collector.healthCheck()).toBe(true);
  });

  it('captures all entries from any batch (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 20 }),
        async (messages) => {
          const collector = createMockLogCollector();
          const batch = messages.map((m) => ({
            timestamp: new Date().toISOString(),
            message: m,
          }));
          await collector.send(batch);
          expect(collector.entries).toHaveLength(messages.length);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe('MockMetricsCollector', () => {
  it('captures counter increments', () => {
    const collector = createMockMetricsCollector();
    const counter = collector.registerCounter({
      name: 'requests',
      help: 'Total requests',
      type: 'counter',
    });
    counter.inc({ method: 'GET' }, 1);

    expect(collector.observations).toHaveLength(1);
    expect(collector.observations[0]!.name).toBe('requests');
    expect(collector.observations[0]!.type).toBe('counter');
    expect(collector.observations[0]!.value).toBe(1);
  });

  it('captures histogram observations', () => {
    const collector = createMockMetricsCollector();
    const histogram = collector.registerHistogram({
      name: 'latency',
      help: 'Request latency',
      type: 'histogram',
      buckets: [10, 50, 100, 500],
    });
    histogram.observe({ endpoint: '/api' }, 42.5);

    expect(collector.observations).toHaveLength(1);
    expect(collector.observations[0]!.value).toBe(42.5);
  });

  it('captures gauge set/inc/dec', () => {
    const collector = createMockMetricsCollector();
    const gauge = collector.registerGauge({
      name: 'connections',
      help: 'Active connections',
      type: 'gauge',
    });
    gauge.set({ pool: 'main' }, 10);
    gauge.inc({ pool: 'main' }, 2);
    gauge.dec({ pool: 'main' }, 1);

    expect(collector.observations).toHaveLength(3);
    expect(collector.observations[0]!.value).toBe(10);
    expect(collector.observations[1]!.value).toBe(2);
    expect(collector.observations[2]!.value).toBe(-1);
  });

  it('clears all state', () => {
    const collector = createMockMetricsCollector();
    const counter = collector.registerCounter({ name: 'test', help: 'test', type: 'counter' });
    counter.inc();
    collector.clear();

    expect(collector.observations).toHaveLength(0);
  });

  it('records every observation with correct type (property)', () => {
    fc.assert(
      fc.property(metricNameArb, latencyMsArb, (name, value) => {
        const collector = createMockMetricsCollector();
        const histogram = collector.registerHistogram({
          name,
          help: `Help for ${name}`,
          type: 'histogram',
        });
        histogram.observe({}, value);

        expect(collector.observations).toHaveLength(1);
        expect(collector.observations[0]!.name).toBe(name);
        expect(collector.observations[0]!.type).toBe('histogram');
        expect(collector.observations[0]!.value).toBe(value);
      }),
      { numRuns: 50 },
    );
  });
});

describe('MockSpanCollector', () => {
  const makeSpan = (overrides: Partial<SpanData> = {}): SpanData => ({
    name: 'test-span',
    kind: 'internal',
    startTime: Date.now(),
    endTime: Date.now() + 100,
    attributes: {},
    status: 'ok',
    events: [],
    context: { traceId: 'trace-1', spanId: 'span-1', traceFlags: 1 },
    ...overrides,
  });

  it('captures exported spans', async () => {
    const collector = createMockSpanCollector();
    await collector.export([makeSpan()]);

    expect(collector.spans).toHaveLength(1);
    expect(collector.exportCount).toBe(1);
  });

  it('finds spans by name', async () => {
    const collector = createMockSpanCollector();
    await collector.export([
      makeSpan({ name: 'db-query' }),
      makeSpan({ name: 'http-request' }),
      makeSpan({ name: 'db-query' }),
    ]);

    expect(collector.findByName('db-query')).toHaveLength(2);
    expect(collector.findByName('http-request')).toHaveLength(1);
    expect(collector.findByName('nonexistent')).toHaveLength(0);
  });

  it('finds spans by trace ID', async () => {
    const collector = createMockSpanCollector();
    await collector.export([
      makeSpan({ context: { traceId: 'trace-a', spanId: 's1', traceFlags: 1 } }),
      makeSpan({ context: { traceId: 'trace-b', spanId: 's2', traceFlags: 1 } }),
      makeSpan({ context: { traceId: 'trace-a', spanId: 's3', traceFlags: 1 } }),
    ]);

    expect(collector.findByTraceId('trace-a')).toHaveLength(2);
    expect(collector.findByTraceId('trace-b')).toHaveLength(1);
  });

  it('clears all state', async () => {
    const collector = createMockSpanCollector();
    await collector.export([makeSpan()]);
    collector.clear();

    expect(collector.spans).toHaveLength(0);
    expect(collector.exportCount).toBe(0);
  });
});

describe('createMockCollectors', () => {
  let mocks: ReturnType<typeof createMockCollectors>;

  beforeEach(() => {
    mocks = createMockCollectors();
  });

  it('provides all three collectors', () => {
    expect(mocks.logs).toBeDefined();
    expect(mocks.metrics).toBeDefined();
    expect(mocks.spans).toBeDefined();
  });

  it('clearAll resets all collectors', async () => {
    await mocks.logs.send([{ timestamp: new Date().toISOString(), message: 'test' }]);
    const counter = mocks.metrics.registerCounter({ name: 'c', help: 'c', type: 'counter' });
    counter.inc();
    await mocks.spans.export([
      {
        name: 'span',
        kind: 'internal',
        startTime: Date.now(),
        attributes: {},
        status: 'ok',
        events: [],
        context: { traceId: 't', spanId: 's', traceFlags: 1 },
      },
    ]);

    mocks.clearAll();

    expect(mocks.logs.entries).toHaveLength(0);
    expect(mocks.metrics.observations).toHaveLength(0);
    expect(mocks.spans.spans).toHaveLength(0);
  });
});
