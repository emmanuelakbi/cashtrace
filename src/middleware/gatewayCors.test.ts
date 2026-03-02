/**
 * Unit tests for the gateway CORS middleware.
 *
 * @module middleware/gatewayCors.test
 * @see Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createCorsMiddleware, DEV_ORIGINS, PROD_ORIGINS, type CorsConfig } from './gatewayCors.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ALLOWED_ORIGIN = 'http://localhost:3000';
const DISALLOWED_ORIGIN = 'http://evil.example.com';

function createTestApp(configOverrides: Partial<CorsConfig> = {}): express.Express {
  const app = express();

  app.use(
    createCorsMiddleware({
      allowedOrigins: DEV_ORIGINS,
      ...configOverrides,
    }),
  );

  app.get('/test', (_req, res) => {
    res.json({ success: true });
  });

  app.post('/test', (_req, res) => {
    res.json({ success: true });
  });

  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('gatewayCors', () => {
  describe('valid origin', () => {
    it('sets CORS headers for an allowed origin', async () => {
      const app = createTestApp();

      const res = await request(app).get('/test').set('Origin', ALLOWED_ORIGIN);

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['vary']).toContain('Origin');
    });
  });

  describe('invalid origin', () => {
    it('rejects requests from unauthorized origins with 403', async () => {
      const app = createTestApp();

      const res = await request(app).get('/test').set('Origin', DISALLOWED_ORIGIN);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('GW_FORBIDDEN');
      expect(res.body.error.message).toBe('Origin not allowed');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('preflight (OPTIONS)', () => {
    it('returns 204 with all CORS headers for valid origin', async () => {
      const app = createTestApp();

      const res = await request(app).options('/test').set('Origin', ALLOWED_ORIGIN);

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
      expect(res.headers['access-control-allow-methods']).toContain('GET');
      expect(res.headers['access-control-allow-methods']).toContain('POST');
      expect(res.headers['access-control-allow-methods']).toContain('DELETE');
      expect(res.headers['access-control-allow-headers']).toContain('Authorization');
      expect(res.headers['access-control-allow-headers']).toContain('Content-Type');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('includes max-age header in preflight response', async () => {
      const app = createTestApp();

      // Use a raw HTTP request to avoid supertest stripping headers on 204
      const res = await new Promise<{ headers: Record<string, string | undefined> }>(
        (resolve, reject) => {
          const http = require('http') as typeof import('http');
          const server = app.listen(0, () => {
            const addr = server.address();
            if (!addr || typeof addr === 'string') {
              server.close();
              reject(new Error('Could not get server address'));
              return;
            }
            const req = http.request(
              {
                hostname: '127.0.0.1',
                port: addr.port,
                path: '/test',
                method: 'OPTIONS',
                headers: { Origin: ALLOWED_ORIGIN },
              },
              (res) => {
                res.resume();
                res.on('end', () => {
                  server.close();
                  resolve({
                    headers: res.headers as Record<string, string | undefined>,
                  });
                });
              },
            );
            req.on('error', (err) => {
              server.close();
              reject(err);
            });
            req.end();
          });
        },
      );

      expect(res.headers['access-control-max-age']).toBe('86400');
    });

    it('uses custom max-age when configured', async () => {
      const app = createTestApp({ maxAge: 3600 });

      const res = await request(app).options('/test').set('Origin', ALLOWED_ORIGIN);

      expect(res.headers['access-control-max-age']).toBe('3600');
    });
  });

  describe('no Origin header (same-origin)', () => {
    it('passes through without CORS headers', async () => {
      const app = createTestApp();

      const res = await request(app).get('/test');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });

  describe('multiple allowed origins', () => {
    it('accepts any of the configured origins', async () => {
      const app = createTestApp({
        allowedOrigins: [...DEV_ORIGINS, ...PROD_ORIGINS],
      });

      const res1 = await request(app).get('/test').set('Origin', 'http://localhost:3000');
      expect(res1.status).toBe(200);
      expect(res1.headers['access-control-allow-origin']).toBe('http://localhost:3000');

      const res2 = await request(app).get('/test').set('Origin', 'https://cashtrace.ng');
      expect(res2.status).toBe(200);
      expect(res2.headers['access-control-allow-origin']).toBe('https://cashtrace.ng');

      const res3 = await request(app).get('/test').set('Origin', 'https://app.cashtrace.ng');
      expect(res3.status).toBe(200);
      expect(res3.headers['access-control-allow-origin']).toBe('https://app.cashtrace.ng');
    });

    it('rejects origins not in the list', async () => {
      const app = createTestApp({
        allowedOrigins: [...DEV_ORIGINS, ...PROD_ORIGINS],
      });

      const res = await request(app).get('/test').set('Origin', 'https://not-allowed.com');
      expect(res.status).toBe(403);
    });
  });

  describe('credentials', () => {
    it('sets credentials header when enabled (default)', async () => {
      const app = createTestApp();

      const res = await request(app).get('/test').set('Origin', ALLOWED_ORIGIN);

      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('omits credentials header when disabled', async () => {
      const app = createTestApp({ allowCredentials: false });

      const res = await request(app).get('/test').set('Origin', ALLOWED_ORIGIN);

      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });

  describe('Vary header', () => {
    it('sets Vary: Origin for valid cross-origin requests', async () => {
      const app = createTestApp();

      const res = await request(app).get('/test').set('Origin', ALLOWED_ORIGIN);

      expect(res.headers['vary']).toContain('Origin');
    });
  });

  describe('origin presets', () => {
    it('DEV_ORIGINS includes localhost ports', () => {
      expect(DEV_ORIGINS).toContain('http://localhost:3000');
      expect(DEV_ORIGINS).toContain('http://localhost:5173');
    });

    it('PROD_ORIGINS includes production domains', () => {
      expect(PROD_ORIGINS).toContain('https://cashtrace.ng');
      expect(PROD_ORIGINS).toContain('https://app.cashtrace.ng');
    });
  });
});
