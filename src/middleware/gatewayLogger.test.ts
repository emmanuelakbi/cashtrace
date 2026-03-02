/**
 * Unit tests for gateway logger middleware.
 *
 * @module middleware/gatewayLogger.test
 * @see Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import type { RequestLog } from '../gateway/types.js';
import type { LoggerFn } from './gatewayLogger.js';
import { createLoggerMiddleware, redactValue, redactObject } from './gatewayLogger.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal Express app with context + logger middleware and a test route.
 */
function createTestApp(logger: LoggerFn) {
  const app = express();
  app.use(express.json());

  // Attach a fake request context (simulates contextBuilder middleware).
  app.use((req, _res, next) => {
    req.context = {
      correlationId: 'test-corr-id',
      clientIP: '127.0.0.1',
      userAgent: 'test-agent',
      timestamp: new Date(),
      permissions: [],
    };
    next();
  });

  app.use(createLoggerMiddleware(logger));

  app.get('/test', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.post('/test', (_req, res) => {
    res.status(201).json({ created: true });
  });

  return app;
}

/**
 * Build an app where the context includes userId and businessId.
 */
function createAuthenticatedApp(logger: LoggerFn) {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    req.context = {
      correlationId: 'auth-corr-id',
      userId: 'user-42',
      businessId: 'biz-7',
      clientIP: '10.0.0.1',
      userAgent: 'auth-agent',
      timestamp: new Date(),
      permissions: ['read'],
    };
    next();
  });

  app.use(createLoggerMiddleware(logger));

  app.get('/secure', (_req, res) => {
    res.status(200).json({ data: 'secret' });
  });

  return app;
}

// ─── redactValue ─────────────────────────────────────────────────────────────

describe('redactValue', () => {
  it('should redact password fields', () => {
    expect(redactValue('password', 'hunter2')).toBe('[REDACTED]');
    expect(redactValue('newPassword', 'abc123')).toBe('[REDACTED]');
    expect(redactValue('old_password', 'xyz')).toBe('[REDACTED]');
  });

  it('should redact token and authorization fields', () => {
    expect(redactValue('token', 'jwt.value')).toBe('[REDACTED]');
    expect(redactValue('refreshToken', 'rt-123')).toBe('[REDACTED]');
    expect(redactValue('authorization', 'Bearer xyz')).toBe('[REDACTED]');
    expect(redactValue('Authorization', 'Bearer xyz')).toBe('[REDACTED]');
  });

  it('should redact secret, cookie, api_key, apiKey, credit_card, ssn', () => {
    expect(redactValue('secret', 'val')).toBe('[REDACTED]');
    expect(redactValue('cookie', 'val')).toBe('[REDACTED]');
    expect(redactValue('api_key', 'val')).toBe('[REDACTED]');
    expect(redactValue('apiKey', 'val')).toBe('[REDACTED]');
    expect(redactValue('credit_card', '4111')).toBe('[REDACTED]');
    expect(redactValue('ssn', '123-45-6789')).toBe('[REDACTED]');
  });

  it('should not redact non-sensitive fields', () => {
    expect(redactValue('email', 'a@b.com')).toBe('a@b.com');
    expect(redactValue('name', 'Alice')).toBe('Alice');
    expect(redactValue('path', '/api/test')).toBe('/api/test');
  });
});

// ─── redactObject ────────────────────────────────────────────────────────────

describe('redactObject', () => {
  it('should redact top-level sensitive fields', () => {
    const result = redactObject({ username: 'alice', password: 'secret123' });
    expect(result).toEqual({ username: 'alice', password: '[REDACTED]' });
  });

  it('should redact nested sensitive fields', () => {
    const result = redactObject({
      user: {
        name: 'Bob',
        credentials: {
          password: 'p@ss',
          token: 'jwt-abc',
        },
      },
    });
    expect(result).toEqual({
      user: {
        name: 'Bob',
        credentials: {
          password: '[REDACTED]',
          token: '[REDACTED]',
        },
      },
    });
  });

  it('should preserve non-string, non-object values', () => {
    const result = redactObject({ count: 42, active: true, tags: ['a', 'b'] });
    expect(result).toEqual({ count: 42, active: true, tags: ['a', 'b'] });
  });

  it('should handle empty objects', () => {
    expect(redactObject({})).toEqual({});
  });
});

// ─── createLoggerMiddleware ──────────────────────────────────────────────────

describe('createLoggerMiddleware', () => {
  it('should log method, path, and status code (Req 6.1)', async () => {
    const logger = vi.fn<LoggerFn>();
    const app = createTestApp(logger);

    await request(app).get('/test').expect(200);

    expect(logger).toHaveBeenCalledOnce();
    const entry: RequestLog = logger.mock.calls[0][0];
    expect(entry.method).toBe('GET');
    expect(entry.path).toBe('/test');
    expect(entry.statusCode).toBe(200);
  });

  it('should include a positive duration (Req 6.1)', async () => {
    const logger = vi.fn<LoggerFn>();
    const app = createTestApp(logger);

    await request(app).get('/test').expect(200);

    const entry: RequestLog = logger.mock.calls[0][0];
    expect(entry.duration).toBeGreaterThanOrEqual(0);
    expect(typeof entry.duration).toBe('number');
  });

  it('should include correlation ID (Req 6.2)', async () => {
    const logger = vi.fn<LoggerFn>();
    const app = createTestApp(logger);

    await request(app).get('/test').expect(200);

    const entry: RequestLog = logger.mock.calls[0][0];
    expect(entry.correlationId).toBe('test-corr-id');
  });

  it('should include user ID for authenticated requests (Req 6.3)', async () => {
    const logger = vi.fn<LoggerFn>();
    const app = createAuthenticatedApp(logger);

    await request(app).get('/secure').expect(200);

    const entry: RequestLog = logger.mock.calls[0][0];
    expect(entry.userId).toBe('user-42');
    expect(entry.businessId).toBe('biz-7');
  });

  it('should omit user ID for unauthenticated requests (Req 6.3)', async () => {
    const logger = vi.fn<LoggerFn>();
    const app = createTestApp(logger);

    await request(app).get('/test').expect(200);

    const entry: RequestLog = logger.mock.calls[0][0];
    expect(entry.userId).toBeUndefined();
  });

  it('should log request and response sizes (Req 6.5)', async () => {
    const logger = vi.fn<LoggerFn>();
    const app = createTestApp(logger);

    await request(app)
      .post('/test')
      .send({ data: 'hello' })
      .set('Content-Type', 'application/json')
      .expect(201);

    const entry: RequestLog = logger.mock.calls[0][0];
    expect(entry.requestSize).toBeGreaterThan(0);
    expect(entry.responseSize).toBeGreaterThan(0);
  });

  it('should default request size to 0 when Content-Length is absent', async () => {
    const logger = vi.fn<LoggerFn>();
    const app = createTestApp(logger);

    await request(app).get('/test').expect(200);

    const entry: RequestLog = logger.mock.calls[0][0];
    expect(entry.requestSize).toBe(0);
  });

  it('should call logger exactly once per request', async () => {
    const logger = vi.fn<LoggerFn>();
    const app = createTestApp(logger);

    await request(app).get('/test').expect(200);

    expect(logger).toHaveBeenCalledOnce();
  });

  it('should include a valid timestamp', async () => {
    const logger = vi.fn<LoggerFn>();
    const app = createTestApp(logger);

    await request(app).get('/test').expect(200);

    const entry: RequestLog = logger.mock.calls[0][0];
    expect(entry.timestamp).toBeInstanceOf(Date);
  });

  it('should include a unique id per log entry', async () => {
    const logger = vi.fn<LoggerFn>();
    const app = createTestApp(logger);

    await request(app).get('/test').expect(200);
    await request(app).get('/test').expect(200);

    const id1 = logger.mock.calls[0][0].id;
    const id2 = logger.mock.calls[1][0].id;
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });

  it('should log client IP and user agent from context', async () => {
    const logger = vi.fn<LoggerFn>();
    const app = createTestApp(logger);

    await request(app).get('/test').expect(200);

    const entry: RequestLog = logger.mock.calls[0][0];
    expect(entry.clientIP).toBe('127.0.0.1');
    expect(entry.userAgent).toBe('test-agent');
  });

  it('should handle POST with status 201', async () => {
    const logger = vi.fn<LoggerFn>();
    const app = createTestApp(logger);

    await request(app).post('/test').send({ name: 'test' }).expect(201);

    const entry: RequestLog = logger.mock.calls[0][0];
    expect(entry.method).toBe('POST');
    expect(entry.statusCode).toBe(201);
  });

  // ── Per-endpoint log levels (Req 6.6) ──────────────────────────────────

  describe('per-endpoint log levels (Req 6.6)', () => {
    it('should suppress logging for endpoints with "silent" level', async () => {
      const logger = vi.fn<LoggerFn>();
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.context = {
          correlationId: 'test-corr-id',
          clientIP: '127.0.0.1',
          userAgent: 'test-agent',
          timestamp: new Date(),
          permissions: [],
        };
        next();
      });
      app.use(
        createLoggerMiddleware(logger, {
          endpointLogLevels: new Map([['/health', 'silent']]),
        }),
      );
      app.get('/health', (_req, res) => res.json({ ok: true }));
      app.get('/test', (_req, res) => res.json({ ok: true }));

      await request(app).get('/health').expect(200);
      expect(logger).not.toHaveBeenCalled();

      await request(app).get('/test').expect(200);
      expect(logger).toHaveBeenCalledOnce();
    });

    it('should log normally for endpoints without a configured level', async () => {
      const logger = vi.fn<LoggerFn>();
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.context = {
          correlationId: 'test-corr-id',
          clientIP: '127.0.0.1',
          userAgent: 'test-agent',
          timestamp: new Date(),
          permissions: [],
        };
        next();
      });
      app.use(
        createLoggerMiddleware(logger, {
          endpointLogLevels: new Map([['/health', 'silent']]),
        }),
      );
      app.get('/api/data', (_req, res) => res.json({ data: true }));

      await request(app).get('/api/data').expect(200);
      expect(logger).toHaveBeenCalledOnce();
    });

    it('should log for endpoints with non-silent levels', async () => {
      const logger = vi.fn<LoggerFn>();
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.context = {
          correlationId: 'test-corr-id',
          clientIP: '127.0.0.1',
          userAgent: 'test-agent',
          timestamp: new Date(),
          permissions: [],
        };
        next();
      });
      app.use(
        createLoggerMiddleware(logger, {
          endpointLogLevels: new Map([['/test', 'warn']]),
        }),
      );
      app.get('/test', (_req, res) => res.json({ ok: true }));

      await request(app).get('/test').expect(200);
      expect(logger).toHaveBeenCalledOnce();
    });
  });
});
