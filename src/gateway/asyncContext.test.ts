/**
 * Unit tests for async local storage context propagation.
 *
 * @module gateway/asyncContext.test
 * @see Requirements: 9.6
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

import { asyncLocalStorage, getCurrentContext, runWithContext } from './asyncContext.js';
import { makeRequestContext } from './testHelpers.js';
import { contextBuilderMiddleware, CORRELATION_ID_HEADER } from '../middleware/contextBuilder.js';

// ─── runWithContext ──────────────────────────────────────────────────────────

describe('runWithContext', () => {
  it('makes context available via getCurrentContext inside the callback', () => {
    const ctx = makeRequestContext({ correlationId: 'test-abc' });

    runWithContext(ctx, () => {
      const retrieved = getCurrentContext();
      expect(retrieved).toBe(ctx);
      expect(retrieved?.correlationId).toBe('test-abc');
    });
  });

  it('returns the callback return value', () => {
    const ctx = makeRequestContext();
    const result = runWithContext(ctx, () => 42);
    expect(result).toBe(42);
  });

  it('context is undefined outside runWithContext scope', () => {
    expect(getCurrentContext()).toBeUndefined();
  });

  it('supports nested contexts — inner overrides outer', () => {
    const outer = makeRequestContext({ correlationId: 'outer' });
    const inner = makeRequestContext({ correlationId: 'inner' });

    runWithContext(outer, () => {
      expect(getCurrentContext()?.correlationId).toBe('outer');

      runWithContext(inner, () => {
        expect(getCurrentContext()?.correlationId).toBe('inner');
      });

      // outer is restored after inner scope exits
      expect(getCurrentContext()?.correlationId).toBe('outer');
    });
  });

  it('propagates context through async continuations', async () => {
    const ctx = makeRequestContext({ clientIP: '10.0.0.1' });

    await runWithContext(ctx, async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      const retrieved = getCurrentContext();
      expect(retrieved?.clientIP).toBe('10.0.0.1');
    });
  });
});

// ─── asyncLocalStorage instance ──────────────────────────────────────────────

describe('asyncLocalStorage', () => {
  it('is an AsyncLocalStorage instance', () => {
    expect(asyncLocalStorage).toBeDefined();
    expect(typeof asyncLocalStorage.run).toBe('function');
    expect(typeof asyncLocalStorage.getStore).toBe('function');
  });
});

// ─── Integration: contextBuilderMiddleware + AsyncLocalStorage ───────────────

describe('contextBuilderMiddleware + AsyncLocalStorage (Req 9.6)', () => {
  function createTestApp(): express.Express {
    const app = express();
    app.set('trust proxy', true);
    app.use(contextBuilderMiddleware());

    // Handler retrieves context from async local storage (not from req.context)
    app.get('/als-test', (_req, res) => {
      const ctx = getCurrentContext();
      if (!ctx) {
        res.status(500).json({ error: 'no async context' });
        return;
      }
      res.json({
        correlationId: ctx.correlationId,
        clientIP: ctx.clientIP,
        userAgent: ctx.userAgent,
      });
    });

    return app;
  }

  it('makes context available via getCurrentContext inside route handler', async () => {
    const app = createTestApp();
    const res = await request(app).get('/als-test').set('user-agent', 'TestBot/1.0');

    expect(res.status).toBe(200);
    expect(res.body.correlationId).toBeDefined();
    expect(res.body.userAgent).toBe('TestBot/1.0');
  });

  it('async local storage context matches the req.context', async () => {
    const app = express();
    app.set('trust proxy', true);
    app.use(contextBuilderMiddleware());
    app.get('/compare', (req, res) => {
      const alsCtx = getCurrentContext();
      res.json({
        alsCorrelationId: alsCtx?.correlationId,
        reqCorrelationId: req.context?.correlationId,
        match: alsCtx === req.context,
      });
    });

    const res = await request(app).get('/compare');

    expect(res.status).toBe(200);
    expect(res.body.match).toBe(true);
    expect(res.body.alsCorrelationId).toBe(res.body.reqCorrelationId);
  });

  it('propagates the incoming correlation ID through async local storage', async () => {
    const app = createTestApp();
    const existingId = '550e8400-e29b-41d4-a716-446655440000';

    const res = await request(app)
      .get('/als-test')
      .set(CORRELATION_ID_HEADER, existingId);

    expect(res.body.correlationId).toBe(existingId);
  });

  it('extracts client IP via async local storage', async () => {
    const app = createTestApp();

    const res = await request(app)
      .get('/als-test')
      .set('x-forwarded-for', '203.0.113.50');

    expect(res.body.clientIP).toBe('203.0.113.50');
  });
});
