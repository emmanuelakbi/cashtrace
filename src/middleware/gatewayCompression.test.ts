/**
 * Unit tests for the gateway compression middleware.
 *
 * @module middleware/gatewayCompression.test
 * @see Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'http';
import { gunzipSync, brotliDecompressSync } from 'zlib';

import { createCompressionMiddleware } from './gatewayCompression.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SMALL_BODY = 'x'.repeat(500); // < 1KB
const LARGE_BODY = 'x'.repeat(2048); // > 1KB

function createTestApp(
  config?: Parameters<typeof createCompressionMiddleware>[0],
  contentType = 'text/plain',
  body = LARGE_BODY,
): express.Express {
  const app = express();
  app.use(createCompressionMiddleware(config));

  app.get('/test', (_req, res) => {
    res.setHeader('Content-Type', contentType);
    res.end(body);
  });

  return app;
}

/**
 * Make a raw HTTP request that does NOT auto-decompress.
 * supertest/superagent auto-decompresses gzip, so we use raw http for
 * assertions on the compressed bytes.
 */
function rawGet(
  app: express.Express,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Could not get server address'));
        return;
      }

      const req = http.request({ hostname: '127.0.0.1', port: addr.port, path, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          server.close();
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      });
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      req.end();
    });
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('gatewayCompression', () => {
  describe('gzip compression', () => {
    it('compresses responses >1KB with gzip when Accept-Encoding: gzip', async () => {
      const app = createTestApp();

      const res = await rawGet(app, '/test', { 'accept-encoding': 'gzip' });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-encoding']).toBe('gzip');
      expect(res.headers['content-length']).toBeUndefined();

      const decompressed = gunzipSync(res.body);
      expect(decompressed.toString()).toBe(LARGE_BODY);
    });
  });

  describe('Brotli compression', () => {
    it('compresses responses >1KB with Brotli when Accept-Encoding: br', async () => {
      const app = createTestApp();

      const res = await rawGet(app, '/test', { 'accept-encoding': 'br' });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-encoding']).toBe('br');
      expect(res.headers['content-length']).toBeUndefined();

      const decompressed = brotliDecompressSync(res.body);
      expect(decompressed.toString()).toBe(LARGE_BODY);
    });

    it('prefers Brotli over gzip when both accepted', async () => {
      const app = createTestApp();

      const res = await rawGet(app, '/test', { 'accept-encoding': 'gzip, br' });

      expect(res.headers['content-encoding']).toBe('br');
    });
  });

  describe('no compression', () => {
    it('does not compress responses <1KB', async () => {
      const app = createTestApp(undefined, 'text/plain', SMALL_BODY);

      const res = await rawGet(app, '/test', { 'accept-encoding': 'gzip' });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-encoding']).toBeUndefined();
      expect(res.body.toString()).toBe(SMALL_BODY);
    });

    it('does not compress when Accept-Encoding is absent', async () => {
      const app = createTestApp();

      const res = await rawGet(app, '/test');

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-encoding']).toBeUndefined();
      expect(res.body.toString()).toBe(LARGE_BODY);
    });
  });

  describe('skip already compressed content (Req 11.5)', () => {
    it('does not compress images (Content-Type: image/png)', async () => {
      const app = createTestApp(undefined, 'image/png');

      const res = await rawGet(app, '/test', { 'accept-encoding': 'gzip' });

      expect(res.headers['content-encoding']).toBeUndefined();
    });

    it('does not compress PDFs (Content-Type: application/pdf)', async () => {
      const app = createTestApp(undefined, 'application/pdf');

      const res = await rawGet(app, '/test', { 'accept-encoding': 'gzip' });

      expect(res.headers['content-encoding']).toBeUndefined();
    });

    it('does not compress zip files (Content-Type: application/zip)', async () => {
      const app = createTestApp(undefined, 'application/zip');

      const res = await rawGet(app, '/test', { 'accept-encoding': 'gzip' });

      expect(res.headers['content-encoding']).toBeUndefined();
    });

    it('does not compress video (Content-Type: video/mp4)', async () => {
      const app = createTestApp(undefined, 'video/mp4');

      const res = await rawGet(app, '/test', { 'accept-encoding': 'gzip' });

      expect(res.headers['content-encoding']).toBeUndefined();
    });

    it('does not compress audio (Content-Type: audio/mpeg)', async () => {
      const app = createTestApp(undefined, 'audio/mpeg');

      const res = await rawGet(app, '/test', { 'accept-encoding': 'gzip' });

      expect(res.headers['content-encoding']).toBeUndefined();
    });
  });

  describe('Content-Encoding header (Req 11.4)', () => {
    it('sets Content-Encoding: gzip for gzip-compressed responses', async () => {
      const app = createTestApp();

      const res = await rawGet(app, '/test', { 'accept-encoding': 'gzip' });

      expect(res.headers['content-encoding']).toBe('gzip');
    });

    it('sets Content-Encoding: br for Brotli-compressed responses', async () => {
      const app = createTestApp();

      const res = await rawGet(app, '/test', { 'accept-encoding': 'br' });

      expect(res.headers['content-encoding']).toBe('br');
    });
  });

  describe('custom threshold', () => {
    it('compresses when body exceeds custom threshold', async () => {
      const app = createTestApp({ threshold: 100 }, 'text/plain', 'y'.repeat(200));

      const res = await rawGet(app, '/test', { 'accept-encoding': 'gzip' });

      expect(res.headers['content-encoding']).toBe('gzip');
    });

    it('does not compress when body is below custom threshold', async () => {
      const app = createTestApp({ threshold: 5000 });

      const res = await rawGet(app, '/test', { 'accept-encoding': 'gzip' });

      expect(res.headers['content-encoding']).toBeUndefined();
    });
  });
});
