/**
 * Integration tests for the full gateway request flow.
 *
 * Exercises the complete middleware pipeline created by `createGatewayApp`:
 * CORS → compression → JSON parser → cookie parser → context builder →
 * logger → size limit → sanitizer → rate limiter → auth → timeout →
 * route handler → error handler.
 *
 * Uses supertest against the Express app with a mock Redis instance
 * so no external services are required.
 *
 * @module gateway/app.integration.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Redis } from 'ioredis';

import { createGatewayApp } from './app.js';
import type { GatewayAppDependencies } from './app.js';
import type { APIKeyPayload, JWTPayload, RouteConfig } from './types.js';
import type { ServiceHandler } from '../routes/handler.js';
import type { HealthCheckDeps } from '../routes/health.js';
import type { LoggerFn } from '../middleware/gatewayLogger.js';
import type { RequestLog } from './types.js';
import { clearTokenCache } from './tokenCache.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const JWT_SECRET = 'test-secret-key-for-integration-tests';
const ISSUER = 'cashtrace-test';
const ALLOWED_ORIGIN = 'http://localhost:3000';

// ─── Mock Redis ──────────────────────────────────────────────────────────────

function createMockRedis(): Redis {
  return {
    eval: vi.fn().mockResolvedValue(0),
    zremrangebyscore: vi.fn().mockResolvedValue(0),
    zcard: vi.fn().mockResolvedValue(0),
    del: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ping: vi.fn().mockResolvedValue('PONG'),
    status: 'ready',
  } as unknown as Redis;
}

// ─── JWT Helper ──────────────────────────────────────────────────────────────

function signTestToken(payload: Partial<JWTPayload> = {}): string {
  return jwt.sign(
    {
      userId: 'user-123',
      email: 'test@example.com',
      businessId: 'biz-456',
      permissions: ['read', 'write'],
      ...payload,
    },
    JWT_SECRET,
    { issuer: ISSUER, expiresIn: '1h' },
  );
}

// ─── Test App Factory ────────────────────────────────────────────────────────

function createTestApp(overrides: Partial<GatewayAppDependencies> = {}) {
  const routes: RouteConfig[] = [
    {
      method: 'GET',
      path: '/api/v1/test',
      service: 'test-service',
      timeout: 30000,
      retries: 1,
      circuitBreaker: { failureThreshold: 5, resetTimeout: 30000, halfOpenRequests: 2 },
      auth: 'jwt',
    },
    {
      method: 'POST',
      path: '/api/v1/public',
      service: 'test-service',
      timeout: 30000,
      retries: 1,
      circuitBreaker: { failureThreshold: 5, resetTimeout: 30000, halfOpenRequests: 2 },
      auth: 'none',
    },
    {
      method: 'GET',
      path: '/api/v1/items/:id',
      service: 'test-service',
      timeout: 30000,
      retries: 1,
      circuitBreaker: { failureThreshold: 5, resetTimeout: 30000, halfOpenRequests: 2 },
      auth: 'jwt',
    },
  ];

  const handlers = new Map<string, ServiceHandler>();
  handlers.set('test-service', (req, res) => {
    res.json({ success: true, data: { message: 'ok', params: req.params } });
  });

  return createGatewayApp({
    redis: createMockRedis(),
    jwtSecret: JWT_SECRET,
    issuer: ISSUER,
    routes,
    handlers,
    healthChecks: {
      checkDatabase: async () => true,
      checkRedis: async () => true,
    },
    corsOrigins: [ALLOWED_ORIGIN],
    env: 'development',
    ...overrides,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Gateway App — Integration Tests', () => {
  beforeEach(() => {
    clearTokenCache();
  });

  // ── 1. Health Checks ─────────────────────────────────────────────────────

  describe('Health Checks', () => {
    it('GET /health returns 200 with status healthy', async () => {
      const app = createTestApp();

      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.timestamp).toBeDefined();
      expect(res.body.uptime).toBeTypeOf('number');
    });

    it('GET /health/ready returns 200 when all deps are healthy', async () => {
      const app = createTestApp();

      const res = await request(app).get('/health/ready');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.dependencies).toHaveLength(2);
      expect(res.body.dependencies[0].healthy).toBe(true);
      expect(res.body.dependencies[1].healthy).toBe(true);
    });

    it('GET /health/ready returns 503 when a dep is unhealthy', async () => {
      const app = createTestApp({
        healthChecks: {
          checkDatabase: async () => false,
          checkRedis: async () => true,
        },
      });

      const res = await request(app).get('/health/ready');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('unhealthy');
    });
  });

  // ── 2. CORS ──────────────────────────────────────────────────────────────

  describe('CORS', () => {
    it('requests from allowed origin get CORS headers', async () => {
      const app = createTestApp();

      const res = await request(app).get('/health').set('Origin', ALLOWED_ORIGIN);

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('requests from disallowed origin get 403', async () => {
      const app = createTestApp();

      const res = await request(app).get('/health').set('Origin', 'https://evil.com');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('GW_FORBIDDEN');
    });

    it('requests without Origin header pass through (same-origin)', async () => {
      const app = createTestApp();

      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  // ── 3. Context & Correlation ID ──────────────────────────────────────────

  describe('Context & Correlation ID', () => {
    it('response includes x-correlation-id header', async () => {
      const app = createTestApp();

      const res = await request(app).get('/health');

      expect(res.headers['x-correlation-id']).toBeDefined();
      expect(res.headers['x-correlation-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('provided x-correlation-id is propagated', async () => {
      const app = createTestApp();
      const correlationId = '550e8400-e29b-41d4-a716-446655440000';

      const res = await request(app).get('/health').set('x-correlation-id', correlationId);

      expect(res.headers['x-correlation-id']).toBe(correlationId);
    });

    it('error responses include correlationId in body', async () => {
      const app = createTestApp();
      const token = signTestToken();

      const res = await request(app)
        .get('/api/v1/nonexistent')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error?.correlationId).toBeDefined();
    });
  });

  // ── 4. Authentication Flow ─────────────────────────────────────────────

  describe('Authentication Flow', () => {
    it('protected route without token returns 401', async () => {
      const app = createTestApp();

      const res = await request(app).get('/api/v1/test');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('GW_AUTH_REQUIRED');
    });

    it('protected route with valid JWT returns 200', async () => {
      const app = createTestApp();
      const token = signTestToken();

      const res = await request(app).get('/api/v1/test').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('protected route with expired token returns 401', async () => {
      const app = createTestApp();
      const token = jwt.sign(
        {
          userId: 'user-123',
          email: 'test@example.com',
          businessId: 'biz-456',
          permissions: ['read'],
        },
        JWT_SECRET,
        { issuer: ISSUER, expiresIn: '-1s' },
      );

      const res = await request(app).get('/api/v1/test').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('public endpoints (health, docs) work without token', async () => {
      // Health and docs routers are mounted before auth middleware,
      // making them truly public without any authentication.
      const app = createTestApp();

      const healthRes = await request(app).get('/health');
      expect(healthRes.status).toBe(200);
      expect(healthRes.body.status).toBe('healthy');

      const docsRes = await request(app).get('/api/docs');
      expect(docsRes.status).toBe(200);
      expect(docsRes.body.openapi).toBe('3.0.3');
    });

    it('API key in header bypasses rate limiter and JWT auth succeeds', async () => {
      const apiKeys = new Map<string, APIKeyPayload>();
      apiKeys.set('test-api-key-123', {
        serviceId: 'svc-1',
        serviceName: 'transaction-engine',
        permissions: ['internal:read'],
      });

      const app = createTestApp({ apiKeys });
      const token = signTestToken();

      // X-API-Key bypasses rate limiter; JWT satisfies auth middleware
      const res = await request(app)
        .get('/api/v1/test')
        .set('Authorization', `Bearer ${token}`)
        .set('X-API-Key', 'test-api-key-123');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── 5. Route Matching ────────────────────────────────────────────────────

  describe('Route Matching', () => {
    it('registered route returns 200', async () => {
      const app = createTestApp();
      const token = signTestToken();

      const res = await request(app).get('/api/v1/test').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('unregistered route returns 404 with GW_NOT_FOUND', async () => {
      const app = createTestApp();
      const token = signTestToken();

      const res = await request(app)
        .get('/api/v1/nonexistent')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('GW_NOT_FOUND');
    });

    it('path parameters are extracted correctly', async () => {
      const app = createTestApp();
      const token = signTestToken();

      const res = await request(app)
        .get('/api/v1/items/item-789')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.params.id).toBe('item-789');
    });
  });

  // ── 6. Error Handling ──────────────────────────────────────────────────

  describe('Error Handling', () => {
    it('errors include consistent JSON format', async () => {
      const app = createTestApp();

      // Unauthenticated request triggers a 401 with standard error shape
      const res = await request(app).get('/api/v1/test');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBeTypeOf('string');
      expect(res.body.error.message).toBeTypeOf('string');
      expect(res.body.error.correlationId).toBeTypeOf('string');
      expect(res.body.error.timestamp).toBeTypeOf('string');
    });

    it('production mode hides internal error details', async () => {
      const handlers = new Map<string, ServiceHandler>();
      handlers.set('test-service', () => {
        throw new Error('secret database connection string');
      });

      const app = createTestApp({ handlers, env: 'production' });
      const token = signTestToken();

      const res = await request(app).get('/api/v1/test').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(500);
      expect(res.body.error.message).toBe('Internal server error');
      expect(res.body.error.details).toBeUndefined();
    });

    it('development mode exposes error details', async () => {
      const handlers = new Map<string, ServiceHandler>();
      handlers.set('test-service', () => {
        throw new Error('detailed error info');
      });

      const app = createTestApp({ handlers, env: 'development' });
      const token = signTestToken();

      const res = await request(app).get('/api/v1/test').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(500);
      expect(res.body.error.message).toBe('detailed error info');
      expect(res.body.error.details).toBeDefined();
      expect(res.body.error.details.stack).toBeTypeOf('string');
    });
  });

  // ── 7. API Documentation ─────────────────────────────────────────────────

  describe('API Documentation', () => {
    it('GET /api/docs returns OpenAPI spec JSON', async () => {
      const app = createTestApp();

      const res = await request(app).get('/api/docs');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/json/);
      expect(res.body.openapi).toBe('3.0.3');
      expect(res.body.info).toBeDefined();
      expect(res.body.info.title).toBe('CashTrace API Gateway');
      expect(res.body.paths).toBeDefined();
    });

    it('GET /api/docs/ui returns HTML', async () => {
      const app = createTestApp();

      const res = await request(app).get('/api/docs/ui');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);
      expect(res.text).toContain('swagger-ui');
    });
  });

  // ── 8. Request Logging ───────────────────────────────────────────────────

  describe('Request Logging', () => {
    it('logger function is called with request details', async () => {
      const logEntries: RequestLog[] = [];
      const logger: LoggerFn = (entry) => {
        logEntries.push(entry);
      };

      const app = createTestApp({ logger });

      await request(app).get('/health');

      expect(logEntries.length).toBeGreaterThanOrEqual(1);
      const entry = logEntries[0]!;
      expect(entry.method).toBe('GET');
      expect(entry.path).toBe('/health');
      expect(entry.statusCode).toBe(200);
      expect(entry.duration).toBeTypeOf('number');
    });

    it('logger includes correlation ID and method/path', async () => {
      const logEntries: RequestLog[] = [];
      const logger: LoggerFn = (entry) => {
        logEntries.push(entry);
      };

      const app = createTestApp({ logger });
      const correlationId = '550e8400-e29b-41d4-a716-446655440000';

      await request(app).get('/health').set('x-correlation-id', correlationId);

      expect(logEntries.length).toBeGreaterThanOrEqual(1);
      const entry = logEntries[0]!;
      expect(entry.correlationId).toBe(correlationId);
      expect(entry.method).toBe('GET');
      expect(entry.path).toBe('/health');
    });
  });
});
