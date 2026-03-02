/**
 * Property-based tests for Compression Efficiency.
 *
 * **Property 10: Compression Efficiency**
 * For any response larger than 1KB, it SHALL be compressed if the client
 * supports it. For any response smaller than the threshold, no compression
 * is applied.
 *
 * **Validates: Requirements 11.1, 11.2**
 *
 * @module middleware/gatewayCompression.property.test
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import express from 'express';
import http from 'http';
import { gunzipSync } from 'zlib';

import { createCompressionMiddleware } from './gatewayCompression.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 1024;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTestApp(
  body: string,
  config?: Parameters<typeof createCompressionMiddleware>[0],
): express.Express {
  const app = express();
  app.use(createCompressionMiddleware(config));

  app.get('/test', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.end(body);
  });

  return app;
}

/**
 * Raw HTTP request that does NOT auto-decompress, unlike supertest.
 * Keeps the server open until the full response is received to avoid
 * race conditions with async compression streams.
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

      const req = http.request(
        { hostname: '127.0.0.1', port: addr.port, path, headers, agent: false },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
            });
          });
          res.on('error', (err) => reject(err));
        },
      );
      req.on('error', (err) => reject(err));
      req.end();

      // Close server after a generous timeout to ensure all in-flight
      // responses complete, rather than closing immediately on response end.
      server.unref();
      setTimeout(() => server.close(), 500);
    });
  });
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a string body that is larger than the default threshold. */
const largeBodyArb = fc
  .integer({ min: DEFAULT_THRESHOLD + 1, max: DEFAULT_THRESHOLD * 10 })
  .map((size) => 'a'.repeat(size));

/** Generate a string body that is smaller than the default threshold. */
const smallBodyArb = fc
  .integer({ min: 1, max: DEFAULT_THRESHOLD - 1 })
  .map((size) => 'b'.repeat(size));

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Compression Efficiency (Property 10)', { timeout: 60_000 }, () => {
  /**
   * **Validates: Requirements 11.1, 11.2**
   * For any response body larger than the threshold with gzip accepted,
   * the compressed response SHALL be smaller than the original and
   * decompress back to the original content.
   */
  it('compresses all responses above threshold when gzip is accepted', () => {
    return fc.assert(
      fc.asyncProperty(largeBodyArb, async (body) => {
        const app = createTestApp(body);

        const res = await rawGet(app, '/test', { 'accept-encoding': 'gzip' });

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-encoding']).toBe('gzip');

        // Compressed size should be smaller than original
        expect(res.body.length).toBeLessThan(Buffer.byteLength(body));

        // Decompressed content must match original
        const decompressed = gunzipSync(res.body);
        expect(decompressed.toString()).toBe(body);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 11.1, 11.2**
   * For any response body smaller than the threshold, no compression
   * SHALL be applied regardless of Accept-Encoding.
   */
  it('does not compress responses below threshold', () => {
    return fc.assert(
      fc.asyncProperty(smallBodyArb, async (body) => {
        const app = createTestApp(body);

        const res = await rawGet(app, '/test', { 'accept-encoding': 'gzip' });

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.body.toString()).toBe(body);
      }),
      { numRuns: 100 },
    );
  });
});
