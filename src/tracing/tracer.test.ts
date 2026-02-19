import { describe, it, expect, vi } from 'vitest';
import { createTracer, generateTraceId, generateSpanId } from './tracer.js';
import type { TracerConfig, Span } from './tracer.js';
import type { SpanData, SpanExporter, ContextPropagator } from './opentelemetryConfig.js';
import { createW3CPropagator } from './opentelemetryConfig.js';

describe('Trace ID Generation (Req 4.1)', () => {
  it('generates a 32-character hex trace ID', () => {
    const traceId = generateTraceId();
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('generates unique trace IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
    expect(ids.size).toBe(100);
  });

  it('generates a 16-character hex span ID', () => {
    const spanId = generateSpanId();
    expect(spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('generates unique span IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateSpanId()));
    expect(ids.size).toBe(100);
  });
});

describe('Tracer', () => {
  function makeConfig(overrides?: Partial<TracerConfig>): TracerConfig {
    return { serviceName: 'test-service', ...overrides };
  }

  describe('startSpan', () => {
    it('creates a span with a new trace ID when no parent', () => {
      const tracer = createTracer(makeConfig({ samplingRate: 1 }));
      const span = tracer.startSpan('root-span');

      expect(span.name).toBe('root-span');
      expect(span.context.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(span.context.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(span.context.traceFlags).toBe(1);
      expect(span.parentSpanId).toBeUndefined();
    });

    it('inherits trace ID from explicit parent span', () => {
      const tracer = createTracer(makeConfig());
      const parent = tracer.startSpan('parent');
      const child = tracer.startSpan('child', { parent });

      expect(child.context.traceId).toBe(parent.context.traceId);
      expect(child.context.spanId).not.toBe(parent.context.spanId);
      expect(child.parentSpanId).toBe(parent.context.spanId);
    });

    it('inherits trace ID from current span via withSpan', () => {
      const tracer = createTracer(makeConfig());
      const parent = tracer.startSpan('parent');

      let child: Span | undefined;
      tracer.withSpan(parent, () => {
        child = tracer.startSpan('child');
      });

      expect(child).toBeDefined();
      expect(child!.context.traceId).toBe(parent.context.traceId);
      expect(child!.parentSpanId).toBe(parent.context.spanId);
    });

    it('applies span kind from options', () => {
      const tracer = createTracer(makeConfig());
      const span = tracer.startSpan('server-span', { kind: 'server' });
      const data = span.toSpanData();
      expect(data.kind).toBe('server');
    });

    it('defaults span kind to internal', () => {
      const tracer = createTracer(makeConfig());
      const span = tracer.startSpan('internal-span');
      const data = span.toSpanData();
      expect(data.kind).toBe('internal');
    });

    it('applies initial attributes from options', () => {
      const tracer = createTracer(makeConfig());
      const span = tracer.startSpan('span', {
        attributes: { 'http.method': 'GET', 'http.url': '/api/test' },
      });
      const data = span.toSpanData();
      expect(data.attributes['http.method']).toBe('GET');
      expect(data.attributes['http.url']).toBe('/api/test');
    });
  });

  describe('Span operations', () => {
    it('sets attributes on a span', () => {
      const tracer = createTracer(makeConfig());
      const span = tracer.startSpan('span');
      span.setAttributes({ 'db.system': 'postgres', 'db.statement': 'SELECT 1' });
      const data = span.toSpanData();
      expect(data.attributes['db.system']).toBe('postgres');
    });

    it('adds events to a span', () => {
      const tracer = createTracer(makeConfig());
      const span = tracer.startSpan('span');
      span.addEvent('query-start', { query: 'SELECT 1' });
      span.addEvent('query-end');
      const data = span.toSpanData();
      expect(data.events).toHaveLength(2);
      expect(data.events[0]!.name).toBe('query-start');
      expect(data.events[1]!.name).toBe('query-end');
    });

    it('sets status on a span', () => {
      const tracer = createTracer(makeConfig());
      const span = tracer.startSpan('span');
      expect(span.toSpanData().status).toBe('unset');
      span.setStatus('ok');
      expect(span.toSpanData().status).toBe('ok');
    });

    it('ends a span and records end time', () => {
      const tracer = createTracer(makeConfig());
      const span = tracer.startSpan('span');
      expect(span.isEnded()).toBe(false);
      expect(span.toSpanData().endTime).toBeUndefined();

      span.end();
      expect(span.isEnded()).toBe(true);
      expect(span.toSpanData().endTime).toBeDefined();
      expect(span.toSpanData().endTime).toBeGreaterThanOrEqual(span.toSpanData().startTime);
    });

    it('ignores operations after span is ended', () => {
      const tracer = createTracer(makeConfig());
      const span = tracer.startSpan('span');
      span.end();

      span.setAttributes({ late: 'attribute' });
      span.addEvent('late-event');
      span.setStatus('error');

      const data = span.toSpanData();
      expect(data.attributes['late']).toBeUndefined();
      expect(data.events).toHaveLength(0);
      expect(data.status).toBe('unset');
    });

    it('end() is idempotent', () => {
      const tracer = createTracer(makeConfig());
      const span = tracer.startSpan('span');
      span.end();
      const firstEndTime = span.toSpanData().endTime;
      span.end();
      expect(span.toSpanData().endTime).toBe(firstEndTime);
    });
  });

  describe('getCurrentSpan / withSpan', () => {
    it('returns null when no span is active', () => {
      const tracer = createTracer(makeConfig());
      expect(tracer.getCurrentSpan()).toBeNull();
    });

    it('returns the active span inside withSpan', () => {
      const tracer = createTracer(makeConfig());
      const span = tracer.startSpan('active');

      tracer.withSpan(span, () => {
        expect(tracer.getCurrentSpan()).toBe(span);
      });
    });

    it('restores previous span after withSpan completes', () => {
      const tracer = createTracer(makeConfig());
      const outer = tracer.startSpan('outer');
      const inner = tracer.startSpan('inner', { parent: outer });

      tracer.withSpan(outer, () => {
        expect(tracer.getCurrentSpan()).toBe(outer);
        tracer.withSpan(inner, () => {
          expect(tracer.getCurrentSpan()).toBe(inner);
        });
        expect(tracer.getCurrentSpan()).toBe(outer);
      });

      expect(tracer.getCurrentSpan()).toBeNull();
    });

    it('restores previous span even if fn throws', () => {
      const tracer = createTracer(makeConfig());
      const span = tracer.startSpan('span');

      expect(() => {
        tracer.withSpan(span, () => {
          throw new Error('boom');
        });
      }).toThrow('boom');

      expect(tracer.getCurrentSpan()).toBeNull();
    });

    it('returns the value from fn', () => {
      const tracer = createTracer(makeConfig());
      const span = tracer.startSpan('span');
      const result = tracer.withSpan(span, () => 42);
      expect(result).toBe(42);
    });
  });

  describe('Context Propagation (Req 4.2)', () => {
    it('injects trace context into headers via propagator', () => {
      const propagator = createW3CPropagator();
      const tracer = createTracer(makeConfig({ propagator }));
      const span = tracer.startSpan('outgoing-call', { kind: 'client' });

      const headers = tracer.injectContext(span);
      expect(headers['traceparent']).toBeDefined();
      expect(headers['traceparent']).toContain(span.context.traceId);
      expect(headers['traceparent']).toContain(span.context.spanId);
    });

    it('extracts trace context from incoming headers', () => {
      const propagator = createW3CPropagator();
      const tracer = createTracer(makeConfig({ propagator }));

      const traceId = generateTraceId();
      const spanId = generateSpanId();
      const headers = {
        traceparent: `00-${traceId}-${spanId}-01`,
      };

      const extracted = tracer.extractContext(headers);
      expect(extracted).not.toBeNull();
      expect(extracted!.traceId).toBe(traceId);
      expect(extracted!.spanId).toBe(spanId);
      expect(extracted!.traceFlags).toBe(1);
    });

    it('returns null when extracting from empty headers', () => {
      const propagator = createW3CPropagator();
      const tracer = createTracer(makeConfig({ propagator }));
      const extracted = tracer.extractContext({});
      expect(extracted).toBeNull();
    });

    it('returns empty headers when no propagator configured', () => {
      const tracer = createTracer(makeConfig());
      const span = tracer.startSpan('span');
      const headers = tracer.injectContext(span);
      expect(headers).toEqual({});
    });

    it('returns null extract when no propagator configured', () => {
      const tracer = createTracer(makeConfig());
      const result = tracer.extractContext({ traceparent: '00-abc-def-01' });
      expect(result).toBeNull();
    });

    it('round-trips context through inject/extract', () => {
      const propagator = createW3CPropagator();
      const tracer = createTracer(makeConfig({ propagator }));
      const span = tracer.startSpan('request', { kind: 'server' });

      const headers = tracer.injectContext(span);
      const extracted = tracer.extractContext(headers);

      expect(extracted).not.toBeNull();
      expect(extracted!.traceId).toBe(span.context.traceId);
      expect(extracted!.spanId).toBe(span.context.spanId);
    });
  });

  describe('Exporter integration', () => {
    it('flushes completed spans to exporter', async () => {
      const exported: SpanData[][] = [];
      const exporter: SpanExporter = {
        async export(spans) {
          exported.push(spans);
        },
        async shutdown() {},
      };

      const tracer = createTracer(makeConfig({ exporter, samplingRate: 1 }));
      const span = tracer.startSpan('op');
      span.setStatus('ok');
      span.end();

      tracer.withSpan(span, () => {});
      await tracer.flush();

      expect(exported).toHaveLength(1);
      expect(exported[0]![0]!.name).toBe('op');
      expect(exported[0]![0]!.status).toBe('ok');
    });

    it('does not flush when no spans completed', async () => {
      const exported: SpanData[][] = [];
      const exporter: SpanExporter = {
        async export(spans) {
          exported.push(spans);
        },
        async shutdown() {},
      };

      const tracer = createTracer(makeConfig({ exporter }));
      await tracer.flush();
      expect(exported).toHaveLength(0);
    });

    it('shutdown flushes and shuts down exporter', async () => {
      const shutdownCalled = vi.fn();
      const exporter: SpanExporter = {
        async export() {},
        async shutdown() {
          shutdownCalled();
        },
      };

      const tracer = createTracer(makeConfig({ exporter }));
      const span = tracer.startSpan('op');
      span.end();
      tracer.withSpan(span, () => {});

      await tracer.shutdown();
      expect(shutdownCalled).toHaveBeenCalledOnce();
    });
  });
});
