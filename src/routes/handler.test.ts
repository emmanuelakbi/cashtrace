import { describe, it, expect, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import type { RouteConfig, HTTPMethod } from '../gateway/types.js';
import { GATEWAY_ERROR_CODES } from '../gateway/types.js';

import {
  RouteRegistry,
  createRouteHandler,
  type ServiceHandler,
  type RouteHandlerDeps,
} from './handler.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRouteConfig(overrides: Partial<RouteConfig> = {}): RouteConfig {
  return {
    method: 'GET',
    path: '/api/v1/health',
    service: 'health-service',
    timeout: 30_000,
    retries: 1,
    circuitBreaker: { failureThreshold: 5, resetTimeout: 30_000, halfOpenRequests: 2 },
    auth: 'none',
    ...overrides,
  };
}

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    path: '/api/v1/health',
    params: {},
    headers: {},
    context: { correlationId: 'test-corr-id' },
    ...overrides,
  } as unknown as Request;
}

function makeResponse(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

// ─── RouteRegistry ───────────────────────────────────────────────────────────

describe('RouteRegistry', () => {
  let registry: RouteRegistry;

  beforeEach(() => {
    registry = new RouteRegistry();
  });

  it('should register and match a simple route', () => {
    const route = makeRouteConfig();
    registry.register(route);

    const result = registry.match('GET', '/api/v1/health');
    expect(result).not.toBeNull();
    expect(result?.route).toBe(route);
    expect(result?.params).toEqual({});
  });

  it('should return null for unmatched path', () => {
    registry.register(makeRouteConfig());
    expect(registry.match('GET', '/api/v1/unknown')).toBeNull();
  });

  it('should return null for unmatched method', () => {
    registry.register(makeRouteConfig({ method: 'GET' }));
    expect(registry.match('POST', '/api/v1/health')).toBeNull();
  });

  it('should match routes with path parameters', () => {
    registry.register(makeRouteConfig({ path: '/api/v1/users/:id' }));

    const result = registry.match('GET', '/api/v1/users/abc-123');
    expect(result).not.toBeNull();
    expect(result?.params).toEqual({ id: 'abc-123' });
  });

  it('should match routes with multiple path parameters', () => {
    registry.register(makeRouteConfig({ path: '/api/v1/businesses/:bizId/transactions/:txId' }));

    const result = registry.match('GET', '/api/v1/businesses/biz-1/transactions/tx-2');
    expect(result).not.toBeNull();
    expect(result?.params).toEqual({ bizId: 'biz-1', txId: 'tx-2' });
  });

  it('should support versioned paths — v1', () => {
    registry.register(makeRouteConfig({ path: '/api/v1/users' }));
    registry.register(makeRouteConfig({ path: '/api/v2/users', service: 'users-v2' }));

    const result = registry.match('GET', '/api/v1/users');
    expect(result?.route.service).toBe('health-service');
  });

  it('should support versioned paths — v2', () => {
    registry.register(makeRouteConfig({ path: '/api/v1/users' }));
    registry.register(makeRouteConfig({ path: '/api/v2/users', service: 'users-v2' }));

    const result = registry.match('GET', '/api/v2/users');
    expect(result?.route.service).toBe('users-v2');
  });

  it('should not cross-match between versions', () => {
    registry.register(makeRouteConfig({ path: '/api/v1/users' }));

    expect(registry.match('GET', '/api/v2/users')).toBeNull();
  });

  it('should support multiple routes with same path but different methods', () => {
    const getRoute = makeRouteConfig({ method: 'GET', path: '/api/v1/users' });
    const postRoute = makeRouteConfig({
      method: 'POST',
      path: '/api/v1/users',
      service: 'users-create',
    });

    registry.register(getRoute);
    registry.register(postRoute);

    expect(registry.match('GET', '/api/v1/users')?.route).toBe(getRoute);
    expect(registry.match('POST', '/api/v1/users')?.route).toBe(postRoute);
  });

  it('should register multiple routes at once via registerAll', () => {
    const routes = [makeRouteConfig({ path: '/api/v1/a' }), makeRouteConfig({ path: '/api/v1/b' })];
    registry.registerAll(routes);

    expect(registry.match('GET', '/api/v1/a')).not.toBeNull();
    expect(registry.match('GET', '/api/v1/b')).not.toBeNull();
  });

  it('should return a copy of routes from getRoutes', () => {
    const route = makeRouteConfig();
    registry.register(route);

    const routes = registry.getRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0]).toBe(route);
  });

  it('should handle paths with trailing slashes consistently', () => {
    registry.register(makeRouteConfig({ path: '/api/v1/users/' }));

    // Both with and without trailing slash should match
    expect(registry.match('GET', '/api/v1/users')).not.toBeNull();
    expect(registry.match('GET', '/api/v1/users/')).not.toBeNull();
  });

  it('should return first matching route when multiple match', () => {
    const first = makeRouteConfig({ path: '/api/v1/items', service: 'first' });
    const second = makeRouteConfig({ path: '/api/v1/items', service: 'second' });
    registry.register(first);
    registry.register(second);

    expect(registry.match('GET', '/api/v1/items')?.route.service).toBe('first');
  });
});

// ─── createRouteHandler ──────────────────────────────────────────────────────

describe('createRouteHandler', () => {
  let registry: RouteRegistry;
  let handlers: Map<string, ServiceHandler>;
  let middleware: ReturnType<typeof createRouteHandler>;

  beforeEach(() => {
    registry = new RouteRegistry();
    handlers = new Map();
  });

  function setup(): void {
    const deps: RouteHandlerDeps = { registry, handlers };
    middleware = createRouteHandler(deps);
  }

  it('should call the service handler for a matched route', () => {
    const route = makeRouteConfig({ service: 'test-svc' });
    registry.register(route);

    let called = false;
    handlers.set('test-svc', (_req, _res, _next) => {
      called = true;
    });

    setup();

    const req = makeRequest();
    const res = makeResponse();
    const next: NextFunction = () => undefined;

    middleware(req, res as unknown as Response, next);
    expect(called).toBe(true);
  });

  it('should attach routeConfig to the request', () => {
    const route = makeRouteConfig({ service: 'test-svc' });
    registry.register(route);

    let capturedConfig: RouteConfig | undefined;
    handlers.set('test-svc', (req, _res, _next) => {
      capturedConfig = req.routeConfig;
    });

    setup();

    const req = makeRequest();
    middleware(req, makeResponse() as unknown as Response, () => undefined);

    expect(capturedConfig).toBe(route);
  });

  it('should merge path params into req.params', () => {
    registry.register(makeRouteConfig({ path: '/api/v1/users/:id', service: 'users' }));

    let capturedParams: Record<string, string> = {};
    handlers.set('users', (req, _res, _next) => {
      capturedParams = req.params;
    });

    setup();

    const req = makeRequest({ path: '/api/v1/users/u-42', params: {} } as Partial<Request>);
    middleware(req, makeResponse() as unknown as Response, () => undefined);

    expect(capturedParams['id']).toBe('u-42');
  });

  it('should return 404 for unmatched routes', () => {
    setup();

    const req = makeRequest({ path: '/api/v1/nope' } as Partial<Request>);
    const res = makeResponse();

    middleware(req, res as unknown as Response, () => undefined);

    expect(res.statusCode).toBe(404);
    const body = res.body as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(GATEWAY_ERROR_CODES.NOT_FOUND);
  });

  it('should include correlation ID in 404 error response', () => {
    setup();

    const req = makeRequest({
      path: '/api/v1/nope',
      context: { correlationId: 'corr-abc' },
    } as Partial<Request>);
    const res = makeResponse();

    middleware(req, res as unknown as Response, () => undefined);

    const body = res.body as { error: { correlationId: string } };
    expect(body.error.correlationId).toBe('corr-abc');
  });

  it('should return 503 when service handler is not registered', () => {
    registry.register(makeRouteConfig({ service: 'missing-svc' }));
    setup();

    const req = makeRequest();
    const res = makeResponse();

    middleware(req, res as unknown as Response, () => undefined);

    expect(res.statusCode).toBe(503);
    const body = res.body as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(GATEWAY_ERROR_CODES.SERVICE_UNAVAILABLE);
  });

  it('should route versioned paths to correct handlers', () => {
    registry.register(makeRouteConfig({ path: '/api/v1/data', service: 'data-v1' }));
    registry.register(makeRouteConfig({ path: '/api/v2/data', service: 'data-v2' }));

    const calls: string[] = [];
    handlers.set('data-v1', () => calls.push('v1'));
    handlers.set('data-v2', () => calls.push('v2'));

    setup();

    const req1 = makeRequest({ path: '/api/v1/data' } as Partial<Request>);
    const req2 = makeRequest({ path: '/api/v2/data' } as Partial<Request>);

    middleware(req1, makeResponse() as unknown as Response, () => undefined);
    middleware(req2, makeResponse() as unknown as Response, () => undefined);

    expect(calls).toEqual(['v1', 'v2']);
  });

  it('should use "unknown" correlation ID when context is absent', () => {
    setup();

    const req = makeRequest({ path: '/nope', context: undefined } as Partial<Request>);
    const res = makeResponse();

    middleware(req, res as unknown as Response, () => undefined);

    const body = res.body as { error: { correlationId: string } };
    expect(body.error.correlationId).toBe('unknown');
  });
});
