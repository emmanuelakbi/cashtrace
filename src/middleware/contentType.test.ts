/**
 * Unit tests for the Content-Type validation middleware.
 *
 * @module middleware/contentType.test
 * @see Requirement 2.7
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createContentTypeMiddleware } from './contentType.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTestApp(
  config?: Parameters<typeof createContentTypeMiddleware>[0],
): express.Express {
  const app = express();

  // Fake context for correlationId
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

  app.use(createContentTypeMiddleware(config));
  app.use(express.json());

  app.get('/test', (_req, res) => {
    res.json({ success: true });
  });

  app.post('/test', (_req, res) => {
    res.status(201).json({ success: true });
  });

  app.put('/test', (_req, res) => {
    res.json({ success: true });
  });

  app.patch('/test', (_req, res) => {
    res.json({ success: true });
  });

  app.delete('/test', (_req, res) => {
    res.json({ success: true });
  });

  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('contentType middleware', () => {
  describe('GET requests', () => {
    it('passes through without Content-Type validation', async () => {
      const app = createTestApp();
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('DELETE requests', () => {
    it('passes through without Content-Type validation', async () => {
      const app = createTestApp();
      const res = await request(app).delete('/test');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST requests', () => {
    it('allows application/json Content-Type', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/test')
        .set('Content-Type', 'application/json')
        .send({ data: 'test' });
      expect(res.status).toBe(201);
    });

    it('allows application/json with charset', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/test')
        .set('Content-Type', 'application/json; charset=utf-8')
        .send(JSON.stringify({ data: 'test' }));
      expect(res.status).toBe(201);
    });

    it('rejects text/plain Content-Type with 415', async () => {
      const app = createTestApp();
      const res = await request(app).post('/test').set('Content-Type', 'text/plain').send('hello');
      expect(res.status).toBe(415);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('GW_VALIDATION_FAILED');
      expect(res.body.error.message).toContain('Unsupported Content-Type');
    });

    it('rejects application/xml Content-Type with 415', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/test')
        .set('Content-Type', 'application/xml')
        .send('<data/>');
      expect(res.status).toBe(415);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('GW_VALIDATION_FAILED');
    });

    it('passes through POST with no body (Content-Length: 0)', async () => {
      const app = createTestApp();
      const res = await request(app).post('/test').set('Content-Length', '0');
      expect(res.status).toBe(201);
    });
  });

  describe('PUT requests', () => {
    it('validates Content-Type on PUT', async () => {
      const app = createTestApp();
      const res = await request(app).put('/test').set('Content-Type', 'text/xml').send('<data/>');
      expect(res.status).toBe(415);
    });
  });

  describe('PATCH requests', () => {
    it('validates Content-Type on PATCH', async () => {
      const app = createTestApp();
      const res = await request(app)
        .patch('/test')
        .set('Content-Type', 'application/json')
        .send({ patch: true });
      expect(res.status).toBe(200);
    });
  });

  describe('custom configuration', () => {
    it('allows custom Content-Types', async () => {
      const app = createTestApp({
        allowedTypes: ['application/json', 'multipart/form-data'],
      });
      const res = await request(app)
        .post('/test')
        .set('Content-Type', 'multipart/form-data; boundary=---')
        .send('---');
      expect(res.status).toBe(201);
    });

    it('includes correlationId in error response', async () => {
      const app = createTestApp();
      const res = await request(app).post('/test').set('Content-Type', 'text/plain').send('hello');
      expect(res.body.error.correlationId).toBe('test-corr-id');
    });
  });
});
