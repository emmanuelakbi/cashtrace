/**
 * Unit tests for OpenTelemetry span exporters.
 *
 * Tests cover:
 * - OTLP span formatting (Jaeger-compatible)
 * - X-Ray segment formatting
 * - Jaeger exporter with retry logic
 * - X-Ray exporter with retry logic
 * - Batching exporter wrapper
 *
 * Validates: Requirements 4.5 (OpenTelemetry trace format support)
 */

import { describe, it, expect } from 'vitest';
import type { SpanData } from './opentelemetryConfig.js';
import {
  formatSpanToOTLP,
  formatSpanToXRay,
  buildOTLPExportPayload,
  convertToXRayTraceId,
  createJaegerExporter,
  createXRayExporter,
  createBatchingExporter,
  withRetry,
  isRetryableError,
  HttpExportError,
  type HttpTransport,
  type HttpResponse,
} from './exporters.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeSpan(overrides?: Partial<SpanData>): SpanData {
  return {
    name: 'test-operation',
    kind: 'server',
    startTime: 1700000000000,
    endTime: 1700000000150,
    attributes: { 'http.method': 'GET', 'http.status_code': 200 },
    status: 'ok',
    events: [],
    context: {
      traceId: 'abcdef1234567890abcdef1234567890',
      spanId: '1234567890abcdef',
      traceFlags: 1,
    },
    ...overrides,
  };
}

function createMockTransport(response?: Partial<HttpResponse>): HttpTransport & {
  calls: Array<{ url: string; body: string; headers: Record<string, string> }>;
} {
  const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  return {
    calls,
    async send(url: string, body: string, headers: Record<string, string>): Promise<HttpResponse> {
      calls.push({ url, body, headers });
      return { status: response?.status ?? 200, statusText: response?.statusText ?? 'OK' };
    },
  };
}

// ─── OTLP Formatting ────────────────────────────────────────────────────────

describe('formatSpanToOTLP', () => {
  it('should convert span data to OTLP format with correct fields', () => {
    const span = makeSpan();
    const otlp = formatSpanToOTLP(span, 'cashtrace', '1.0.0', 'production');

    expect(otlp.traceId).toBe(span.context.traceId);
    expect(otlp.spanId).toBe(span.context.spanId);
    expect(otlp.name).toBe('test-operation');
    expect(otlp.kind).toBe(2); // server = 2
    expect(otlp.startTimeUnixNano).toBe(1700000000000 * 1_000_000);
    expect(otlp.endTimeUnixNano).toBe(1700000000150 * 1_000_000);
    expect(otlp.status.code).toBe(1); // ok = 1
  });

  it('should map span kinds to correct OTLP numeric values', () => {
    const kinds = [
      { kind: 'internal' as const, expected: 1 },
      { kind: 'server' as const, expected: 2 },
      { kind: 'client' as const, expected: 3 },
      { kind: 'producer' as const, expected: 4 },
      { kind: 'consumer' as const, expected: 5 },
    ];

    for (const { kind, expected } of kinds) {
      const otlp = formatSpanToOTLP(makeSpan({ kind }), 'svc');
      expect(otlp.kind).toBe(expected);
    }
  });

  it('should map status codes to correct OTLP numeric values', () => {
    expect(formatSpanToOTLP(makeSpan({ status: 'unset' }), 'svc').status.code).toBe(0);
    expect(formatSpanToOTLP(makeSpan({ status: 'ok' }), 'svc').status.code).toBe(1);
    expect(formatSpanToOTLP(makeSpan({ status: 'error' }), 'svc').status.code).toBe(2);
  });

  it('should convert attributes to OTLP key-value format', () => {
    const span = makeSpan({
      attributes: {
        'str.attr': 'hello',
        'num.attr': 42,
        'bool.attr': true,
      },
    });
    const otlp = formatSpanToOTLP(span, 'svc');

    const attrMap = new Map(otlp.attributes.map((a) => [a.key, a.value]));
    expect(attrMap.get('str.attr')).toEqual({ stringValue: 'hello' });
    expect(attrMap.get('num.attr')).toEqual({ intValue: 42 });
    expect(attrMap.get('bool.attr')).toEqual({ boolValue: true });
  });

  it('should include service.name in attributes', () => {
    const otlp = formatSpanToOTLP(makeSpan(), 'my-service');
    const attrMap = new Map(otlp.attributes.map((a) => [a.key, a.value]));
    expect(attrMap.get('service.name')).toEqual({ stringValue: 'my-service' });
  });

  it('should convert events to OTLP format', () => {
    const span = makeSpan({
      events: [
        {
          name: 'exception',
          timestamp: 1700000000100,
          attributes: { 'exception.message': 'oops' },
        },
      ],
    });
    const otlp = formatSpanToOTLP(span, 'svc');

    expect(otlp.events).toHaveLength(1);
    expect(otlp.events[0]!.name).toBe('exception');
    expect(otlp.events[0]!.timeUnixNano).toBe(1700000000100 * 1_000_000);
  });

  it('should set parentSpanId to empty string when no parent', () => {
    const otlp = formatSpanToOTLP(makeSpan({ parentSpanId: undefined }), 'svc');
    expect(otlp.parentSpanId).toBe('');
  });

  it('should set parentSpanId when parent exists', () => {
    const otlp = formatSpanToOTLP(makeSpan({ parentSpanId: 'aabbccdd11223344' }), 'svc');
    expect(otlp.parentSpanId).toBe('aabbccdd11223344');
  });
});

describe('buildOTLPExportPayload', () => {
  it('should wrap spans in OTLP resource/scope envelope', () => {
    const span = makeSpan();
    const otlpSpan = formatSpanToOTLP(span, 'cashtrace');
    const payload = buildOTLPExportPayload([otlpSpan], 'cashtrace', '1.0.0', 'prod');

    expect(payload.resourceSpans).toHaveLength(1);
    const rs = payload.resourceSpans[0]!;

    // Resource attributes
    const resAttrs = new Map(rs.resource.attributes.map((a) => [a.key, a.value]));
    expect(resAttrs.get('service.name')).toEqual({ stringValue: 'cashtrace' });
    expect(resAttrs.get('service.version')).toEqual({ stringValue: '1.0.0' });
    expect(resAttrs.get('deployment.environment')).toEqual({ stringValue: 'prod' });

    // Scope spans
    expect(rs.scopeSpans).toHaveLength(1);
    expect(rs.scopeSpans[0]!.scope.name).toBe('cashtrace');
    expect(rs.scopeSpans[0]!.spans).toHaveLength(1);
  });
});

// ─── X-Ray Formatting ───────────────────────────────────────────────────────

describe('formatSpanToXRay', () => {
  it('should convert span data to X-Ray segment format', () => {
    const span = makeSpan();
    const segment = formatSpanToXRay(span, 'cashtrace');

    expect(segment.name).toBe('cashtrace');
    expect(segment.id).toBe(span.context.spanId);
    expect(segment.start_time).toBe(1700000000000 / 1000);
    expect(segment.end_time).toBe(1700000000150 / 1000);
  });

  it('should format trace ID in X-Ray format (1-epoch-random)', () => {
    const span = makeSpan();
    const segment = formatSpanToXRay(span, 'svc');

    expect(segment.trace_id).toMatch(/^1-[0-9a-f]{8}-[0-9a-f]{24}$/);
  });

  it('should set type=subsegment and parent_id when parent exists', () => {
    const span = makeSpan({ parentSpanId: 'aabbccdd11223344' });
    const segment = formatSpanToXRay(span, 'svc');

    expect(segment.parent_id).toBe('aabbccdd11223344');
    expect(segment.type).toBe('subsegment');
  });

  it('should not set parent_id or type for root spans', () => {
    const span = makeSpan({ parentSpanId: undefined });
    const segment = formatSpanToXRay(span, 'svc');

    expect(segment.parent_id).toBeUndefined();
    expect(segment.type).toBeUndefined();
  });

  it('should set fault=true for error status', () => {
    const segment = formatSpanToXRay(makeSpan({ status: 'error' }), 'svc');
    expect(segment.fault).toBe(true);
  });

  it('should not set fault for ok status', () => {
    const segment = formatSpanToXRay(makeSpan({ status: 'ok' }), 'svc');
    expect(segment.fault).toBeUndefined();
  });

  it('should map attributes to annotations with dots replaced by underscores', () => {
    const span = makeSpan({ attributes: { 'http.method': 'POST', 'db.system': 'postgres' } });
    const segment = formatSpanToXRay(span, 'svc');

    expect(segment.annotations['http_method']).toBe('POST');
    expect(segment.annotations['db_system']).toBe('postgres');
  });

  it('should include operation name in annotations', () => {
    const segment = formatSpanToXRay(makeSpan({ name: 'db.query' }), 'svc');
    expect(segment.annotations['operation']).toBe('db.query');
  });

  it('should map events to metadata', () => {
    const span = makeSpan({
      events: [
        {
          name: 'exception',
          timestamp: 1700000000100,
          attributes: { 'exception.message': 'fail' },
        },
      ],
    });
    const segment = formatSpanToXRay(span, 'svc');

    expect(segment.metadata['events']).toBeDefined();
    const events = segment.metadata['events'] as Array<{ name: string }>;
    expect(events).toHaveLength(1);
    expect(events[0]!.name).toBe('exception');
  });
});

describe('convertToXRayTraceId', () => {
  it('should produce X-Ray format: 1-<epoch hex>-<24 hex chars>', () => {
    const result = convertToXRayTraceId('abcdef1234567890abcdef1234567890', 1700000000000);
    expect(result).toMatch(/^1-[0-9a-f]{8}-[0-9a-f]{24}$/);
  });

  it('should use epoch seconds from startTimeMs', () => {
    const result = convertToXRayTraceId('abcdef1234567890abcdef1234567890', 1700000000000);
    const epochHex = Math.floor(1700000000000 / 1000)
      .toString(16)
      .padStart(8, '0');
    expect(result).toContain(`1-${epochHex}-`);
  });
});

// ─── Retry Logic ─────────────────────────────────────────────────────────────

describe('withRetry', () => {
  it('should succeed on first attempt without retrying', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        return 'ok';
      },
      3,
      10,
      () => true,
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(1);
  });

  it('should retry on transient failure and succeed', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error('transient');
        return 'ok';
      },
      3,
      10,
      () => true,
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('should throw after exhausting retries', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error('always fails');
        },
        2,
        10,
        () => true,
      ),
    ).rejects.toThrow('always fails');
    expect(attempts).toBe(3); // initial + 2 retries
  });

  it('should not retry non-retryable errors', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error('fatal');
        },
        3,
        10,
        () => false,
      ),
    ).rejects.toThrow('fatal');
    expect(attempts).toBe(1);
  });
});

describe('isRetryableError', () => {
  it('should retry on 500 server errors', () => {
    expect(isRetryableError(new HttpExportError('fail', 500))).toBe(true);
  });

  it('should retry on 503 service unavailable', () => {
    expect(isRetryableError(new HttpExportError('fail', 503))).toBe(true);
  });

  it('should retry on 429 rate limit', () => {
    expect(isRetryableError(new HttpExportError('fail', 429))).toBe(true);
  });

  it('should not retry on 400 client errors', () => {
    expect(isRetryableError(new HttpExportError('fail', 400))).toBe(false);
  });

  it('should not retry on 404 not found', () => {
    expect(isRetryableError(new HttpExportError('fail', 404))).toBe(false);
  });

  it('should retry on generic errors (network failures)', () => {
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
  });
});

// ─── Jaeger Exporter ─────────────────────────────────────────────────────────

describe('createJaegerExporter', () => {
  it('should send spans to the configured endpoint in OTLP format', async () => {
    const transport = createMockTransport();
    const exporter = createJaegerExporter(
      { endpoint: 'http://jaeger:4318/v1/traces', serviceName: 'cashtrace' },
      transport,
    );

    await exporter.export([makeSpan()]);

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]!.url).toBe('http://jaeger:4318/v1/traces');
    expect(transport.calls[0]!.headers['Content-Type']).toBe('application/json');

    const payload = JSON.parse(transport.calls[0]!.body);
    expect(payload.resourceSpans).toBeDefined();
    expect(payload.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);
  });

  it('should include custom headers', async () => {
    const transport = createMockTransport();
    const exporter = createJaegerExporter(
      {
        endpoint: 'http://jaeger:4318/v1/traces',
        serviceName: 'cashtrace',
        headers: { Authorization: 'Bearer token123' },
      },
      transport,
    );

    await exporter.export([makeSpan()]);
    expect(transport.calls[0]!.headers['Authorization']).toBe('Bearer token123');
  });

  it('should not send when no spans provided', async () => {
    const transport = createMockTransport();
    const exporter = createJaegerExporter(
      { endpoint: 'http://jaeger:4318/v1/traces', serviceName: 'svc' },
      transport,
    );

    await exporter.export([]);
    expect(transport.calls).toHaveLength(0);
  });

  it('should retry on server errors', async () => {
    let callCount = 0;
    const transport: HttpTransport = {
      async send(): Promise<HttpResponse> {
        callCount++;
        if (callCount < 3) return { status: 503, statusText: 'Service Unavailable' };
        return { status: 200, statusText: 'OK' };
      },
    };

    const exporter = createJaegerExporter(
      {
        endpoint: 'http://jaeger:4318/v1/traces',
        serviceName: 'svc',
        maxRetries: 3,
        retryDelayMs: 10,
      },
      transport,
    );

    await exporter.export([makeSpan()]);
    expect(callCount).toBe(3);
  });

  it('should throw on non-retryable client errors', async () => {
    const transport: HttpTransport = {
      async send(): Promise<HttpResponse> {
        return { status: 400, statusText: 'Bad Request' };
      },
    };

    const exporter = createJaegerExporter(
      {
        endpoint: 'http://jaeger:4318/v1/traces',
        serviceName: 'svc',
        maxRetries: 2,
        retryDelayMs: 10,
      },
      transport,
    );

    await expect(exporter.export([makeSpan()])).rejects.toThrow('Jaeger export failed: 400');
  });

  it('should not export after shutdown', async () => {
    const transport = createMockTransport();
    const exporter = createJaegerExporter(
      { endpoint: 'http://jaeger:4318/v1/traces', serviceName: 'svc' },
      transport,
    );

    await exporter.shutdown();
    await exporter.export([makeSpan()]);
    expect(transport.calls).toHaveLength(0);
  });
});

// ─── X-Ray Exporter ──────────────────────────────────────────────────────────

describe('createXRayExporter', () => {
  it('should send spans in X-Ray segment format', async () => {
    const transport = createMockTransport();
    const exporter = createXRayExporter(
      { endpoint: 'https://xray.us-east-1.amazonaws.com', serviceName: 'cashtrace' },
      transport,
    );

    await exporter.export([makeSpan()]);

    expect(transport.calls).toHaveLength(1);
    const payload = JSON.parse(transport.calls[0]!.body);
    expect(payload.TraceSegmentDocuments).toBeDefined();
    expect(payload.TraceSegmentDocuments).toHaveLength(1);

    // Each document is a JSON string
    const segment = JSON.parse(payload.TraceSegmentDocuments[0]);
    expect(segment.name).toBe('cashtrace');
    expect(segment.trace_id).toMatch(/^1-[0-9a-f]{8}-[0-9a-f]{24}$/);
  });

  it('should retry on server errors', async () => {
    let callCount = 0;
    const transport: HttpTransport = {
      async send(): Promise<HttpResponse> {
        callCount++;
        if (callCount < 2) return { status: 500, statusText: 'Internal Server Error' };
        return { status: 200, statusText: 'OK' };
      },
    };

    const exporter = createXRayExporter(
      {
        endpoint: 'https://xray.us-east-1.amazonaws.com',
        serviceName: 'svc',
        maxRetries: 3,
        retryDelayMs: 10,
      },
      transport,
    );

    await exporter.export([makeSpan()]);
    expect(callCount).toBe(2);
  });

  it('should not export after shutdown', async () => {
    const transport = createMockTransport();
    const exporter = createXRayExporter(
      { endpoint: 'https://xray.us-east-1.amazonaws.com', serviceName: 'svc' },
      transport,
    );

    await exporter.shutdown();
    await exporter.export([makeSpan()]);
    expect(transport.calls).toHaveLength(0);
  });
});

// ─── Batching Exporter ───────────────────────────────────────────────────────

describe('createBatchingExporter', () => {
  it('should buffer spans until batch size is reached', async () => {
    const exported: SpanData[][] = [];
    const inner = {
      async export(spans: SpanData[]): Promise<void> {
        exported.push([...spans]);
      },
      async shutdown(): Promise<void> {},
    };

    const batcher = createBatchingExporter(inner, { maxBatchSize: 3, flushIntervalMs: 60000 });

    await batcher.export([makeSpan()]);
    await batcher.export([makeSpan()]);
    expect(exported).toHaveLength(0);
    expect(batcher.pendingCount()).toBe(2);

    // Third span triggers flush
    await batcher.export([makeSpan()]);
    expect(exported).toHaveLength(1);
    expect(exported[0]).toHaveLength(3);
    expect(batcher.pendingCount()).toBe(0);

    await batcher.shutdown();
  });

  it('should support explicit flush of buffered spans', async () => {
    const exported: SpanData[][] = [];
    const inner = {
      async export(spans: SpanData[]): Promise<void> {
        exported.push([...spans]);
      },
      async shutdown(): Promise<void> {},
    };

    const batcher = createBatchingExporter(inner, { maxBatchSize: 100, flushIntervalMs: 60000 });

    await batcher.export([makeSpan()]);
    expect(exported).toHaveLength(0);

    // Explicit flush should send buffered spans
    await batcher.flush();
    expect(exported).toHaveLength(1);
    expect(exported[0]).toHaveLength(1);

    await batcher.shutdown();
  });

  it('should flush remaining spans on shutdown', async () => {
    const exported: SpanData[][] = [];
    const inner = {
      async export(spans: SpanData[]): Promise<void> {
        exported.push([...spans]);
      },
      async shutdown(): Promise<void> {},
    };

    const batcher = createBatchingExporter(inner, { maxBatchSize: 100, flushIntervalMs: 60000 });

    await batcher.export([makeSpan(), makeSpan()]);
    expect(exported).toHaveLength(0);

    await batcher.shutdown();
    expect(exported).toHaveLength(1);
    expect(exported[0]).toHaveLength(2);
  });

  it('should not accept spans after shutdown', async () => {
    const exported: SpanData[][] = [];
    const inner = {
      async export(spans: SpanData[]): Promise<void> {
        exported.push([...spans]);
      },
      async shutdown(): Promise<void> {},
    };

    const batcher = createBatchingExporter(inner, { maxBatchSize: 100, flushIntervalMs: 60000 });
    await batcher.shutdown();

    await batcher.export([makeSpan()]);
    expect(batcher.pendingCount()).toBe(0);
  });

  it('should call inner shutdown', async () => {
    let shutdownCalled = false;
    const inner = {
      async export(): Promise<void> {},
      async shutdown(): Promise<void> {
        shutdownCalled = true;
      },
    };

    const batcher = createBatchingExporter(inner, { maxBatchSize: 100, flushIntervalMs: 60000 });
    await batcher.shutdown();
    expect(shutdownCalled).toBe(true);
  });
});
