/**
 * Unit tests for the request size limit middleware.
 *
 * @see Requirements: 2.6 — enforce maximum request body size
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

import {
  createSizeLimitMiddleware,
  DEFAULT_SIZE_LIMIT,
  FILE_UPLOAD_SIZE_LIMIT,
} from './sizeLimit.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTestApp(options?: Parameters<typeof createSizeLimitMiddleware>[0]): express.Express {
  const app = express();

  // Attach a fake context with correlationId
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

  app.use(createSizeLimitMiddleware(options));

  app.post('/test', (_req, res) => {
    res.json({ success: true });
  });

  app.post('/upload', (_req, res) => {
    res.json({ success: true });
  });

  app.post('/api/files/doc', (_req, res) => {
    res.json({ success: true });
  });

  app.post('/api/documents/receipt', (_req, res) => {
    res.json({ success: true });
  });

  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createSizeLimitMiddleware', () => {
  describe('default limits', () => {
    it('passes requests within the default 10MB limit', async () => {
      const app = createTestApp();

      const response = await request(app)
        .post('/test')
        .set('Content-Length', String(1024))
        .send('x')
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('returns 413 for requests exceeding the default 10MB limit', async () => {
      const app = createTestApp();
      const oversized = DEFAULT_SIZE_LIMIT + 1;

      const response = await request(app)
        .post('/test')
        .set('Content-Length', String(oversized))
        .send('x')
        .expect(413);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('GW_PAYLOAD_TOO_LARGE');
      expect(response.body.error.correlationId).toBe('test-corr-id');
      expect(response.body.error.details.contentLength).toBe(oversized);
      expect(response.body.error.details.maxSize).toBe(DEFAULT_SIZE_LIMIT);
    });

    it('passes requests at exactly the default limit', async () => {
      const app = createTestApp();

      await request(app)
        .post('/test')
        .set('Content-Length', String(DEFAULT_SIZE_LIMIT))
        .send('x')
        .expect(200);
    });
  });

  describe('file upload limits', () => {
    it('allows file uploads within the 50MB limit', async () => {
      const app = createTestApp();
      // 20MB — within the 50MB file upload limit
      const size = 20 * 1024 * 1024;

      await request(app).post('/upload').set('Content-Length', String(size)).send('x').expect(200);
    });

    it('returns 413 for file uploads exceeding the 50MB limit', async () => {
      const app = createTestApp();
      const oversized = FILE_UPLOAD_SIZE_LIMIT + 1;

      const response = await request(app)
        .post('/upload')
        .set('Content-Length', String(oversized))
        .send('x')
        .expect(413);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('GW_PAYLOAD_TOO_LARGE');
      expect(response.body.error.details.maxSize).toBe(FILE_UPLOAD_SIZE_LIMIT);
    });

    it('matches /files route as file upload', async () => {
      const app = createTestApp();
      // 20MB — exceeds default 10MB but within 50MB file upload limit
      const size = 20 * 1024 * 1024;

      await request(app)
        .post('/api/files/doc')
        .set('Content-Length', String(size))
        .send('x')
        .expect(200);
    });

    it('matches /documents route as file upload', async () => {
      const app = createTestApp();
      const size = 20 * 1024 * 1024;

      await request(app)
        .post('/api/documents/receipt')
        .set('Content-Length', String(size))
        .send('x')
        .expect(200);
    });
  });

  describe('custom limits', () => {
    it('respects custom default limit', async () => {
      const app = createTestApp({ defaultLimit: 1024 });

      await request(app).post('/test').set('Content-Length', '512').send('x').expect(200);

      const response = await request(app)
        .post('/test')
        .set('Content-Length', '2048')
        .send('x')
        .expect(413);

      expect(response.body.error.details.maxSize).toBe(1024);
    });

    it('respects custom file upload limit', async () => {
      const app = createTestApp({ fileUploadLimit: 2048 });

      const response = await request(app)
        .post('/upload')
        .set('Content-Length', '4096')
        .send('x')
        .expect(413);

      expect(response.body.error.details.maxSize).toBe(2048);
    });

    it('respects custom file upload patterns', async () => {
      const app = createTestApp({
        defaultLimit: 100,
        fileUploadLimit: 5000,
        fileUploadPatterns: [/\/custom-upload/i],
      });

      // /upload no longer matches — uses default limit
      await request(app).post('/upload').set('Content-Length', '200').send('x').expect(413);
    });
  });

  describe('edge cases', () => {
    it('passes requests without Content-Length header', async () => {
      const app = createTestApp();

      // GET requests typically have no Content-Length
      app.get('/no-body', (_req, res) => {
        res.json({ success: true });
      });

      await request(app).get('/no-body').expect(200);
    });

    it('includes correlationId as unknown when context is missing', async () => {
      const app = express();
      // No context middleware
      app.use(createSizeLimitMiddleware({ defaultLimit: 10 }));
      app.post('/test', (_req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/test')
        .set('Content-Length', '100')
        .send('x')
        .expect(413);

      expect(response.body.error.correlationId).toBe('unknown');
    });
  });
});
