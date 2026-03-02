/**
 * Unit tests for the context builder middleware.
 *
 * @module middleware/contextBuilder.test
 * @see Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { validate as uuidValidate } from 'uuid';

import {
  buildContext,
  attachContext,
  getContext,
  contextBuilderMiddleware,
  resolveCorrelationId,
  extractClientIP,
  CORRELATION_ID_HEADER,
} from './contextBuilder.js';

import { makeJWTPayload, makeAPIKeyPayload } from '../gateway/testHelpers.js';

// ─── Helper: minimal Express app with context middleware ─────────────────────

function createTestApp(): express.Express {
  const app = express();
  app.set('trust proxy', true);
  app.use(contextBuilderMiddleware());
  app.get('/test', (req, res) => {
    res.json(req.context);
  });
  return app;
}

// ─── resolveCorrelationId ────────────────────────────────────────────────────

describe('resolveCorrelationId', () => {
  it('generates a valid UUID when no header is present', () => {
    const req = { headers: {} } as express.Request;
    const id = resolveCorrelationId(req);
    expect(uuidValidate(id)).toBe(true);
  });

  it('uses X-Correlation-ID header when present and valid', () => {
    const expected = '550e8400-e29b-41d4-a716-446655440000';
    const req = { headers: { [CORRELATION_ID_HEADER]: expected } } as express.Request;
    expect(resolveCorrelationId(req)).toBe(expected);
  });

  it('falls back to X-Request-ID when X-Correlation-ID is absent', () => {
    const expected = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    const req = { headers: { 'x-request-id': expected } } as express.Request;
    expect(resolveCorrelationId(req)).toBe(expected);
  });

  it('generates a new UUID when header value is not a valid UUID', () => {
    const req = { headers: { [CORRELATION_ID_HEADER]: 'not-a-uuid' } } as express.Request;
    const id = resolveCorrelationId(req);
    expect(id).not.toBe('not-a-uuid');
    expect(uuidValidate(id)).toBe(true);
  });

  it('prefers X-Correlation-ID over X-Request-ID', () => {
    const correlationId = '550e8400-e29b-41d4-a716-446655440000';
    const requestId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    const req = {
      headers: {
        [CORRELATION_ID_HEADER]: correlationId,
        'x-request-id': requestId,
      },
    } as express.Request;
    expect(resolveCorrelationId(req)).toBe(correlationId);
  });
});

// ─── extractClientIP ─────────────────────────────────────────────────────────

describe('extractClientIP', () => {
  it('extracts the first IP from X-Forwarded-For', () => {
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.50, 70.41.3.18, 150.172.238.178' },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as express.Request;
    expect(extractClientIP(req)).toBe('203.0.113.50');
  });

  it('falls back to req.ip when X-Forwarded-For is absent', () => {
    const req = {
      headers: {},
      ip: '10.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as express.Request;
    expect(extractClientIP(req)).toBe('10.0.0.1');
  });

  it('falls back to socket.remoteAddress when req.ip is undefined', () => {
    const req = {
      headers: {},
      ip: undefined,
      socket: { remoteAddress: '192.168.1.100' },
    } as unknown as express.Request;
    expect(extractClientIP(req)).toBe('192.168.1.100');
  });

  it('returns "unknown" when no IP source is available', () => {
    const req = {
      headers: {},
      ip: undefined,
      socket: { remoteAddress: undefined },
    } as unknown as express.Request;
    expect(extractClientIP(req)).toBe('unknown');
  });
});

// ─── buildContext ────────────────────────────────────────────────────────────

describe('buildContext', () => {
  const baseReq = {
    headers: { 'user-agent': 'TestAgent/1.0' },
    ip: '10.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as express.Request;

  it('creates a context with correlation ID, IP, user agent, and timestamp', () => {
    const ctx = buildContext(baseReq);
    expect(uuidValidate(ctx.correlationId)).toBe(true);
    expect(ctx.clientIP).toBe('10.0.0.1');
    expect(ctx.userAgent).toBe('TestAgent/1.0');
    expect(ctx.timestamp).toBeInstanceOf(Date);
    expect(ctx.permissions).toEqual([]);
    expect(ctx.userId).toBeUndefined();
    expect(ctx.businessId).toBeUndefined();
  });

  it('populates userId, businessId, permissions from JWTPayload (Req 9.1, 9.2)', () => {
    const jwt = makeJWTPayload({
      userId: 'user-123',
      businessId: 'biz-456',
      permissions: ['read', 'write'],
    });
    const ctx = buildContext(baseReq, jwt);
    expect(ctx.userId).toBe('user-123');
    expect(ctx.businessId).toBe('biz-456');
    expect(ctx.permissions).toEqual(['read', 'write']);
  });

  it('populates permissions from APIKeyPayload without userId/businessId', () => {
    const apiKey = makeAPIKeyPayload({ permissions: ['internal:read'] });
    const ctx = buildContext(baseReq, apiKey);
    expect(ctx.userId).toBeUndefined();
    expect(ctx.businessId).toBeUndefined();
    expect(ctx.permissions).toEqual(['internal:read']);
  });

  it('defaults user agent to "unknown" when header is missing', () => {
    const req = {
      headers: {},
      ip: '10.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as express.Request;
    const ctx = buildContext(req);
    expect(ctx.userAgent).toBe('unknown');
  });
});

// ─── attachContext / getContext ───────────────────────────────────────────────

describe('attachContext / getContext', () => {
  it('attaches and retrieves context from request', () => {
    const req = {} as express.Request;
    const ctx = buildContext({
      headers: {},
      ip: '10.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as express.Request);

    attachContext(req, ctx);
    expect(getContext(req)).toBe(ctx);
  });

  it('throws when context is not attached', () => {
    const req = {} as express.Request;
    expect(() => getContext(req)).toThrow('RequestContext not found');
  });
});

// ─── contextBuilderMiddleware (integration via supertest) ────────────────────

describe('contextBuilderMiddleware', () => {
  it('attaches context to request and sets correlation ID response header', async () => {
    const app = createTestApp();
    const res = await request(app).get('/test');

    expect(res.status).toBe(200);
    expect(res.headers[CORRELATION_ID_HEADER]).toBeDefined();
    expect(uuidValidate(res.headers[CORRELATION_ID_HEADER] as string)).toBe(true);
    expect(res.body.correlationId).toBe(res.headers[CORRELATION_ID_HEADER]);
  });

  it('propagates an existing valid correlation ID (Req 9.3)', async () => {
    const app = createTestApp();
    const existingId = '550e8400-e29b-41d4-a716-446655440000';

    const res = await request(app).get('/test').set(CORRELATION_ID_HEADER, existingId);

    expect(res.headers[CORRELATION_ID_HEADER]).toBe(existingId);
    expect(res.body.correlationId).toBe(existingId);
  });

  it('generates a new ID when provided correlation ID is invalid', async () => {
    const app = createTestApp();

    const res = await request(app).get('/test').set(CORRELATION_ID_HEADER, 'bad-value');

    expect(res.headers[CORRELATION_ID_HEADER]).not.toBe('bad-value');
    expect(uuidValidate(res.headers[CORRELATION_ID_HEADER] as string)).toBe(true);
  });

  it('extracts client IP from X-Forwarded-For (Req 9.4)', async () => {
    const app = createTestApp();

    const res = await request(app).get('/test').set('x-forwarded-for', '203.0.113.50, 70.41.3.18');

    expect(res.body.clientIP).toBe('203.0.113.50');
  });

  it('captures user agent (Req 9.4)', async () => {
    const app = createTestApp();

    const res = await request(app).get('/test').set('user-agent', 'CashTrace-Mobile/2.1');

    expect(res.body.userAgent).toBe('CashTrace-Mobile/2.1');
  });

  it('includes a timestamp (Req 9.5)', async () => {
    const app = createTestApp();
    const before = Date.now();

    const res = await request(app).get('/test');

    const timestamp = new Date(res.body.timestamp as string).getTime();
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(Date.now());
  });
});
