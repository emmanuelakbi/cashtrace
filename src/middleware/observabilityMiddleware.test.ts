import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  requestLogger,
  requestMetrics,
  requestTracer,
  observabilityMiddleware,
} from './observabilityMiddleware.js';
import { createLogger, type LogEntry } from '../logging/index.js';
import { createMetricsCollector } from '../metrics/index.js';
import { createTracer } from '../tracing/index.js';

// ── Test helpers ────────────────────────────────────────────────────────────

function createMockReq(overrides: Record<string, unknown> = {}) {
  return {
    method: 'GET',
    url: '/api/test',
    originalUrl: '/api/test',
    path: '/api/test',
    headers: {} as Record<string, string | string[] | undefined>,
    ...overrides,
  };
}

function createMockRes() {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    statusCode: 200,
    _headers: {} as Record<string, string>,
    on(event: string, listener: () => void) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event]!.push(listener);
    },
    setHeader(name: string, value: string) {
      this._headers[name] = value;
    },
    getHeader(name: string) {
      return this._headers[name];
    },
    emit(event: string) {
      for (const fn of listeners[event] ?? []) fn();
    },
  };
}

const nextFn = vi.fn();

describe('requestLogger', () => {
  let entries: LogEntry[];
  let logger: ReturnType<typeof createLogger>;

  beforeEach(() => {
    entries = [];
    logger = createLogger({
      service: 'test',
      level: 'debug',
      debugSampleRate: 1,
      output: (entry) => entries.push(entry),
    });
    nextFn.mockClear();
  });

  it('calls next()', () => {
    const mw = requestLogger(logger);
    const req = createMockReq();
    const res = createMockRes();

    mw(req, res, nextFn);
    expect(nextFn).toHaveBeenCalledOnce();
  });

  it('generates a correlation ID when none provided', () => {
    const mw = requestLogger(logger);
    const req = createMockReq();
    const res = createMockRes();

    mw(req, res, nextFn);

    expect(req.correlationId).toBeDefined();
    expect(typeof req.correlationId).toBe('string');
    expect(res._headers['x-correlation-id']).toBe(req.correlationId);
  });

  it('reuses existing correlation ID from header', () => {
    const mw = requestLogger(logger);
    const req = createMockReq({
      headers: { 'x-correlation-id': 'existing-id-123' },
    });
    const res = createMockRes();

    mw(req, res, nextFn);

    expect(req.correlationId).toBe('existing-id-123');
    expect(res._headers['x-correlation-id']).toBe('existing-id-123');
  });

  it('logs request start and completion', () => {
    const mw = requestLogger(logger);
    const req = createMockReq();
    const res = createMockRes();

    mw(req, res, nextFn);

    // Start log
    expect(entries).toHaveLength(1);
    expect(entries[0]!.message).toBe('request started');

    // Simulate response finish
    res.emit('finish');

    expect(entries).toHaveLength(2);
    expect(entries[1]!.message).toBe('request completed');
    expect(entries[1]!.metadata).toMatchObject({
      method: 'GET',
      url: '/api/test',
      statusCode: 200,
    });
  });

  it('includes correlationId in log entries', () => {
    const mw = requestLogger(logger);
    const req = createMockReq({
      headers: { 'x-correlation-id': 'corr-abc' },
    });
    const res = createMockRes();

    mw(req, res, nextFn);
    res.emit('finish');

    for (const entry of entries) {
      expect(entry.correlationId).toBe('corr-abc');
    }
  });
});

describe('requestMetrics', () => {
  let collector: ReturnType<typeof createMetricsCollector>;

  beforeEach(() => {
    collector = createMetricsCollector();
    nextFn.mockClear();
  });

  it('calls next()', () => {
    const mw = requestMetrics(collector);
    const req = createMockReq();
    const res = createMockRes();

    mw(req, res, nextFn);
    expect(nextFn).toHaveBeenCalledOnce();
  });

  it('records HTTP metrics on response finish', async () => {
    const mw = requestMetrics(collector);
    const req = createMockReq({ method: 'POST', path: '/api/data' });
    const res = createMockRes();
    res.statusCode = 201;

    mw(req, res, nextFn);
    res.emit('finish');

    const output = await collector.getMetricsOutput();
    expect(output).toContain('http_requests_total');
    expect(output).toContain('POST');
  });
});

describe('requestTracer', () => {
  let tracer: ReturnType<typeof createTracer>;

  beforeEach(() => {
    tracer = createTracer({ serviceName: 'test', samplingRate: 1 });
    nextFn.mockClear();
  });

  it('calls next()', () => {
    const mw = requestTracer(tracer);
    const req = createMockReq();
    const res = createMockRes();

    mw(req, res, nextFn);
    expect(nextFn).toHaveBeenCalledOnce();
  });

  it('attaches a span to the request', () => {
    const mw = requestTracer(tracer);
    const req = createMockReq();
    const res = createMockRes();

    mw(req, res, nextFn);

    expect(req.span).toBeDefined();
    expect(req.span!.name).toBe('HTTP GET /api/test');
  });

  it('ends the span on response finish', () => {
    const mw = requestTracer(tracer);
    const req = createMockReq();
    const res = createMockRes();

    mw(req, res, nextFn);
    expect(req.span!.isEnded()).toBe(false);

    res.emit('finish');
    expect(req.span!.isEnded()).toBe(true);
  });

  it('sets error status for 4xx/5xx responses', () => {
    const mw = requestTracer(tracer);
    const req = createMockReq();
    const res = createMockRes();
    res.statusCode = 500;

    mw(req, res, nextFn);
    res.emit('finish');

    const spanData = req.span!.toSpanData();
    expect(spanData.status).toBe('error');
  });

  it('sets ok status for 2xx responses', () => {
    const mw = requestTracer(tracer);
    const req = createMockReq();
    const res = createMockRes();
    res.statusCode = 200;

    mw(req, res, nextFn);
    res.emit('finish');

    const spanData = req.span!.toSpanData();
    expect(spanData.status).toBe('ok');
  });
});

describe('observabilityMiddleware', () => {
  it('returns an array of three middleware functions', () => {
    const logger = createLogger({ output: () => {} });
    const collector = createMetricsCollector();
    const tracer = createTracer({ serviceName: 'test' });

    const middlewares = observabilityMiddleware({
      logger,
      metricsCollector: collector,
      tracer,
    });

    expect(middlewares).toHaveLength(3);
    for (const mw of middlewares) {
      expect(typeof mw).toBe('function');
    }
  });

  it('each middleware calls next()', () => {
    const logger = createLogger({ output: () => {} });
    const collector = createMetricsCollector();
    const tracer = createTracer({ serviceName: 'test' });

    const middlewares = observabilityMiddleware({
      logger,
      metricsCollector: collector,
      tracer,
    });

    for (const mw of middlewares) {
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn();
      mw(req, res, next);
      expect(next).toHaveBeenCalledOnce();
    }
  });
});
