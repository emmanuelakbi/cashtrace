/**
 * Tests for the OpenAPI documentation generator and docs router.
 *
 * @module docs/openapi.test
 * @see Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
 */

import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import type { RouteConfig } from '../gateway/types.js';

import { createDocsRouter, generateOpenAPISpec } from './openapi.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRoute(overrides: Partial<RouteConfig> = {}): RouteConfig {
  return {
    method: 'GET',
    path: '/api/v1/test',
    service: 'test-service',
    timeout: 30_000,
    retries: 2,
    circuitBreaker: { failureThreshold: 5, resetTimeout: 30_000, halfOpenRequests: 1 },
    auth: 'jwt',
    ...overrides,
  };
}

// ─── generateOpenAPISpec ─────────────────────────────────────────────────────

describe('generateOpenAPISpec', () => {
  it('produces a valid OpenAPI 3.0 structure', () => {
    const spec = generateOpenAPISpec([]);

    expect(spec).toHaveProperty('openapi', '3.0.3');
    expect(spec).toHaveProperty('info');
    expect(spec).toHaveProperty('paths');
    expect(spec).toHaveProperty('components');

    const info = spec.info as Record<string, unknown>;
    expect(info.title).toBe('CashTrace API Gateway');
    expect(info.version).toBe('1.0.0');
  });

  it('includes security schemes in components', () => {
    const spec = generateOpenAPISpec([]);
    const components = spec.components as Record<string, unknown>;
    const schemes = components.securitySchemes as Record<string, unknown>;

    expect(schemes).toHaveProperty('bearerAuth');
    expect(schemes).toHaveProperty('apiKeyAuth');
  });

  it('includes paths from route configs (Req 12.2)', () => {
    const routes = [
      makeRoute({ method: 'GET', path: '/api/v1/users' }),
      makeRoute({ method: 'POST', path: '/api/v1/users' }),
      makeRoute({ method: 'GET', path: '/api/v1/users/:id' }),
    ];

    const spec = generateOpenAPISpec(routes);
    const paths = spec.paths as Record<string, Record<string, unknown>>;

    expect(paths).toHaveProperty('/api/v1/users');
    expect(paths['/api/v1/users']).toHaveProperty('get');
    expect(paths['/api/v1/users']).toHaveProperty('post');

    // Path params converted to OpenAPI style
    expect(paths).toHaveProperty('/api/v1/users/{id}');
    expect(paths['/api/v1/users/{id}']).toHaveProperty('get');
  });

  it('documents auth requirements per endpoint (Req 12.4)', () => {
    const routes = [
      makeRoute({ auth: 'jwt', path: '/api/v1/protected' }),
      makeRoute({ auth: 'none', path: '/api/v1/public' }),
      makeRoute({ auth: 'api_key', path: '/api/v1/internal' }),
      makeRoute({ auth: 'jwt_or_api_key', path: '/api/v1/flexible' }),
    ];

    const spec = generateOpenAPISpec(routes);
    const paths = spec.paths as Record<string, Record<string, unknown>>;

    // JWT route has bearerAuth security
    const jwtOp = paths['/api/v1/protected']?.['get'] as Record<string, unknown>;
    expect(jwtOp.security).toEqual([{ bearerAuth: [] }]);
    expect(jwtOp.description).toContain('JWT token');

    // Public route has empty security
    const publicOp = paths['/api/v1/public']?.['get'] as Record<string, unknown>;
    expect(publicOp.security).toEqual([]);
    expect(publicOp.description).toContain('No authentication required');

    // API key route
    const apiKeyOp = paths['/api/v1/internal']?.['get'] as Record<string, unknown>;
    expect(apiKeyOp.security).toEqual([{ apiKeyAuth: [] }]);

    // JWT or API key route
    const flexOp = paths['/api/v1/flexible']?.['get'] as Record<string, unknown>;
    expect(flexOp.security).toEqual([{ bearerAuth: [] }, { apiKeyAuth: [] }]);
  });

  it('includes 401 response for authenticated endpoints (Req 12.4)', () => {
    const spec = generateOpenAPISpec([makeRoute({ auth: 'jwt' })]);
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    const op = paths['/api/v1/test']?.['get'] as Record<string, unknown>;
    const responses = op.responses as Record<string, unknown>;

    expect(responses).toHaveProperty('401');
  });

  it('omits 401 response for public endpoints', () => {
    const spec = generateOpenAPISpec([makeRoute({ auth: 'none' })]);
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    const op = paths['/api/v1/test']?.['get'] as Record<string, unknown>;
    const responses = op.responses as Record<string, unknown>;

    expect(responses).not.toHaveProperty('401');
  });

  it('documents rate limits per endpoint (Req 12.5)', () => {
    const rateLimit = { requests: 5, window: 60, keyPrefix: 'login' };
    const routes = [makeRoute({ rateLimit })];

    const spec = generateOpenAPISpec(routes);
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    const op = paths['/api/v1/test']?.['get'] as Record<string, unknown>;

    // Description includes rate limit info
    expect(op.description).toContain('5 requests per 60s');
    expect(op.description).toContain('login');

    // 429 response included
    const responses = op.responses as Record<string, unknown>;
    expect(responses).toHaveProperty('429');
  });

  it('omits 429 response when no rate limit is configured', () => {
    const spec = generateOpenAPISpec([makeRoute({ rateLimit: undefined })]);
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    const op = paths['/api/v1/test']?.['get'] as Record<string, unknown>;
    const responses = op.responses as Record<string, unknown>;

    expect(responses).not.toHaveProperty('429');
  });

  it('includes request/response examples (Req 12.3)', () => {
    const spec = generateOpenAPISpec([makeRoute()]);
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    const op = paths['/api/v1/test']?.['get'] as Record<string, unknown>;
    const responses = op.responses as Record<string, Record<string, unknown>>;

    // 200 response has example
    const ok = responses['200'] as Record<string, unknown>;
    const content = ok.content as Record<string, Record<string, unknown>>;
    const json = content['application/json'] as Record<string, unknown>;
    expect(json.example).toEqual({ success: true });
  });

  it('generates path parameters for parameterized routes', () => {
    const routes = [makeRoute({ path: '/api/v1/users/:userId/transactions/:txId' })];
    const spec = generateOpenAPISpec(routes);
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    const op = paths['/api/v1/users/{userId}/transactions/{txId}']?.['get'] as Record<
      string,
      unknown
    >;
    const params = op.parameters as Array<Record<string, unknown>>;

    expect(params).toHaveLength(2);
    expect(params[0]).toMatchObject({ name: 'userId', in: 'path', required: true });
    expect(params[1]).toMatchObject({ name: 'txId', in: 'path', required: true });
  });

  it('generates unique operationIds', () => {
    const routes = [
      makeRoute({ method: 'GET', path: '/api/v1/users' }),
      makeRoute({ method: 'POST', path: '/api/v1/users' }),
    ];

    const spec = generateOpenAPISpec(routes);
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    const getOp = paths['/api/v1/users']?.['get'] as Record<string, unknown>;
    const postOp = paths['/api/v1/users']?.['post'] as Record<string, unknown>;

    expect(getOp.operationId).not.toBe(postOp.operationId);
  });

  it('tags operations by service name', () => {
    const routes = [makeRoute({ service: 'auth-service' })];
    const spec = generateOpenAPISpec(routes);
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    const op = paths['/api/v1/test']?.['get'] as Record<string, unknown>;

    expect(op.tags).toEqual(['Auth Service']);
  });
});

// ─── createDocsRouter ────────────────────────────────────────────────────────

describe('createDocsRouter', () => {
  function createApp(routes: RouteConfig[] = []): express.Express {
    const app = express();
    app.use(createDocsRouter({ routes }));
    return app;
  }

  it('GET /api/docs returns JSON OpenAPI spec (Req 12.1)', async () => {
    const app = createApp([makeRoute()]);
    const res = await request(app).get('/api/docs').expect(200);

    expect(res.body).toHaveProperty('openapi', '3.0.3');
    expect(res.body).toHaveProperty('info');
    expect(res.body).toHaveProperty('paths');
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('GET /api/docs/ui returns HTML with Swagger UI (Req 12.1)', async () => {
    const app = createApp();
    const res = await request(app).get('/api/docs/ui').expect(200);

    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('swagger-ui');
    expect(res.text).toContain('/api/docs');
  });

  it('spec includes routes passed to the router', async () => {
    const routes = [
      makeRoute({ method: 'GET', path: '/api/v1/health' }),
      makeRoute({ method: 'POST', path: '/api/v1/login', auth: 'none' }),
    ];
    const app = createApp(routes);
    const res = await request(app).get('/api/docs').expect(200);

    const paths = res.body.paths as Record<string, unknown>;
    expect(paths).toHaveProperty('/api/v1/health');
    expect(paths).toHaveProperty('/api/v1/login');
  });

  it('works with no routes', async () => {
    const app = createApp([]);
    const res = await request(app).get('/api/docs').expect(200);

    expect(res.body.paths).toEqual({});
  });
});
