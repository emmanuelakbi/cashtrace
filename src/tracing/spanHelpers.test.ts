import { describe, it, expect } from 'vitest';
import { createTracer } from './tracer.js';
import type { Span } from './tracer.js';
import { withDbSpan, withHttpSpan, withOperationSpan } from './spanHelpers.js';

function makeTracer() {
  return createTracer({ serviceName: 'test-service' });
}

describe('withDbSpan (Req 4.3, 4.4)', () => {
  it('creates a span with db.system attribute', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await withDbSpan(tracer, { dbSystem: 'postgres' }, async (s) => {
      span = s;
      return 'result';
    });

    const data = span!.toSpanData();
    expect(data.attributes['db.system']).toBe('postgres');
  });

  it('sets db.statement and db.operation when provided', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await withDbSpan(
      tracer,
      { dbSystem: 'postgres', dbStatement: 'SELECT * FROM users', dbOperation: 'SELECT' },
      async (s) => {
        span = s;
      },
    );

    const data = span!.toSpanData();
    expect(data.attributes['db.statement']).toBe('SELECT * FROM users');
    expect(data.attributes['db.operation']).toBe('SELECT');
  });

  it('sets db.name when provided', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await withDbSpan(tracer, { dbSystem: 'postgres', dbName: 'cashtrace' }, async (s) => {
      span = s;
    });

    expect(span!.toSpanData().attributes['db.name']).toBe('cashtrace');
  });

  it('names the span as dbSystem.dbOperation', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await withDbSpan(tracer, { dbSystem: 'postgres', dbOperation: 'SELECT' }, async (s) => {
      span = s;
    });

    expect(span!.toSpanData().name).toBe('postgres.SELECT');
  });

  it('names the span as dbSystem when no operation', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await withDbSpan(tracer, { dbSystem: 'redis' }, async (s) => {
      span = s;
    });

    expect(span!.toSpanData().name).toBe('redis');
  });

  it('uses client span kind', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await withDbSpan(tracer, { dbSystem: 'postgres' }, async (s) => {
      span = s;
    });

    expect(span!.toSpanData().kind).toBe('client');
  });

  it('sets status to ok on success', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await withDbSpan(tracer, { dbSystem: 'postgres' }, async (s) => {
      span = s;
    });

    expect(span!.toSpanData().status).toBe('ok');
  });

  it('returns the result from the callback', async () => {
    const tracer = makeTracer();
    const result = await withDbSpan(tracer, { dbSystem: 'postgres' }, async () => 42);
    expect(result).toBe(42);
  });

  it('sets status to error and records exception on failure', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await expect(
      withDbSpan(tracer, { dbSystem: 'postgres' }, async (s) => {
        span = s;
        throw new Error('connection refused');
      }),
    ).rejects.toThrow('connection refused');

    const data = span!.toSpanData();
    expect(data.status).toBe('error');
    expect(data.events).toHaveLength(1);
    expect(data.events[0]!.name).toBe('exception');
    expect(data.events[0]!.attributes!['exception.message']).toBe('connection refused');
  });

  it('ends the span even on failure', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await expect(
      withDbSpan(tracer, { dbSystem: 'postgres' }, async (s) => {
        span = s;
        throw new Error('fail');
      }),
    ).rejects.toThrow();

    expect(span!.isEnded()).toBe(true);
    expect(span!.toSpanData().endTime).toBeDefined();
  });

  it('merges additional attributes', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await withDbSpan(
      tracer,
      { dbSystem: 'postgres', attributes: { 'db.connection_string': 'localhost:5432' } },
      async (s) => {
        span = s;
      },
    );

    const data = span!.toSpanData();
    expect(data.attributes['db.connection_string']).toBe('localhost:5432');
    expect(data.attributes['db.system']).toBe('postgres');
  });
});

describe('withHttpSpan (Req 4.3, 4.4)', () => {
  it('creates a span with http.method and http.url', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await withHttpSpan(
      tracer,
      { method: 'GET', url: 'https://api.example.com/users' },
      async (s) => {
        span = s;
      },
    );

    const data = span!.toSpanData();
    expect(data.attributes['http.method']).toBe('GET');
    expect(data.attributes['http.url']).toBe('https://api.example.com/users');
  });

  it('names the span as HTTP {method}', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await withHttpSpan(tracer, { method: 'POST', url: '/api/data' }, async (s) => {
      span = s;
    });

    expect(span!.toSpanData().name).toBe('HTTP POST');
  });

  it('uses client span kind', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await withHttpSpan(tracer, { method: 'GET', url: '/api' }, async (s) => {
      span = s;
    });

    expect(span!.toSpanData().kind).toBe('client');
  });

  it('allows setting http.status_code via callback', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await withHttpSpan(tracer, { method: 'GET', url: '/api' }, async (s) => {
      span = s;
      s.setAttributes({ 'http.status_code': 200 });
      return 'ok';
    });

    expect(span!.toSpanData().attributes['http.status_code']).toBe(200);
  });

  it('sets status to ok on success', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await withHttpSpan(tracer, { method: 'GET', url: '/api' }, async (s) => {
      span = s;
    });

    expect(span!.toSpanData().status).toBe('ok');
  });

  it('returns the result from the callback', async () => {
    const tracer = makeTracer();
    const result = await withHttpSpan(tracer, { method: 'GET', url: '/api' }, async () => ({
      status: 200,
      body: 'hello',
    }));
    expect(result).toEqual({ status: 200, body: 'hello' });
  });

  it('sets status to error and records exception on failure', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await expect(
      withHttpSpan(tracer, { method: 'POST', url: '/api' }, async (s) => {
        span = s;
        throw new Error('timeout');
      }),
    ).rejects.toThrow('timeout');

    const data = span!.toSpanData();
    expect(data.status).toBe('error');
    expect(data.events[0]!.attributes!['exception.message']).toBe('timeout');
  });

  it('merges additional attributes', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await withHttpSpan(
      tracer,
      { method: 'GET', url: '/api', attributes: { 'http.target': '/api/v2/users' } },
      async (s) => {
        span = s;
      },
    );

    const data = span!.toSpanData();
    expect(data.attributes['http.target']).toBe('/api/v2/users');
    expect(data.attributes['http.method']).toBe('GET');
  });
});

describe('withOperationSpan (Req 4.3, 4.4)', () => {
  it('creates a span with the given name', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await withOperationSpan(tracer, 'process-invoice', {}, async (s) => {
      span = s;
    });

    expect(span!.toSpanData().name).toBe('process-invoice');
  });

  it('defaults to internal span kind', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await withOperationSpan(tracer, 'compute', {}, async (s) => {
      span = s;
    });

    expect(span!.toSpanData().kind).toBe('internal');
  });

  it('accepts a custom span kind', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await withOperationSpan(tracer, 'send-email', { kind: 'producer' }, async (s) => {
      span = s;
    });

    expect(span!.toSpanData().kind).toBe('producer');
  });

  it('sets status to ok on success', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await withOperationSpan(tracer, 'op', {}, async (s) => {
      span = s;
    });

    expect(span!.toSpanData().status).toBe('ok');
  });

  it('returns the result from the callback', async () => {
    const tracer = makeTracer();
    const result = await withOperationSpan(tracer, 'op', {}, async () => 99);
    expect(result).toBe(99);
  });

  it('sets status to error and records exception on failure', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await expect(
      withOperationSpan(tracer, 'op', {}, async (s) => {
        span = s;
        throw new Error('something broke');
      }),
    ).rejects.toThrow('something broke');

    const data = span!.toSpanData();
    expect(data.status).toBe('error');
    expect(data.events[0]!.name).toBe('exception');
    expect(data.events[0]!.attributes!['exception.message']).toBe('something broke');
  });

  it('ends the span even on failure', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await expect(
      withOperationSpan(tracer, 'op', {}, async (s) => {
        span = s;
        throw new Error('fail');
      }),
    ).rejects.toThrow();

    expect(span!.isEnded()).toBe(true);
    expect(span!.toSpanData().endTime).toBeDefined();
  });

  it('applies custom attributes', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await withOperationSpan(
      tracer,
      'parse-document',
      { attributes: { 'document.type': 'invoice', 'document.pages': 3 } },
      async (s) => {
        span = s;
      },
    );

    const data = span!.toSpanData();
    expect(data.attributes['document.type']).toBe('invoice');
    expect(data.attributes['document.pages']).toBe(3);
  });

  it('handles non-Error thrown values', async () => {
    const tracer = makeTracer();
    let span: Span | undefined;

    await expect(
      withOperationSpan(tracer, 'op', {}, async (s) => {
        span = s;
        throw 'string error';
      }),
    ).rejects.toBe('string error');

    const data = span!.toSpanData();
    expect(data.status).toBe('error');
    expect(data.events[0]!.attributes!['exception.message']).toBe('string error');
  });

  it('sets current span context during execution', async () => {
    const tracer = makeTracer();
    let currentDuringExec: Span | null = null;

    await withOperationSpan(tracer, 'op', {}, async () => {
      currentDuringExec = tracer.getCurrentSpan();
    });

    expect(currentDuringExec).not.toBeNull();
    expect(currentDuringExec!.name).toBe('op');
  });
});
