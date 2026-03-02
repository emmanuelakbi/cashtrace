import { describe, it, expect } from 'vitest';

import { GATEWAY_ERROR_CODES } from './types.js';

import {
  makeAPIError,
  makeAPIKeyPayload,
  makeCircuitBreakerConfig,
  makeJWTPayload,
  makeRateLimit,
  makeRateLimitResult,
  makeRequestContext,
  makeRequestLog,
  makeRouteConfig,
  makeValidationError,
  makeValidationResult,
} from './testHelpers.js';

// ─── Rate Limiting Factories ─────────────────────────────────────────────────

describe('makeRateLimit', () => {
  it('should return defaults', () => {
    const rl = makeRateLimit();
    expect(rl.requests).toBe(100);
    expect(rl.window).toBe(60);
    expect(rl.keyPrefix).toBe('rl:ip:');
  });

  it('should accept overrides', () => {
    const rl = makeRateLimit({ requests: 5, keyPrefix: 'rl:login:' });
    expect(rl.requests).toBe(5);
    expect(rl.keyPrefix).toBe('rl:login:');
    expect(rl.window).toBe(60);
  });
});

describe('makeRateLimitResult', () => {
  it('should return allowed by default', () => {
    const r = makeRateLimitResult();
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(99);
    expect(r.resetAt).toBeInstanceOf(Date);
  });

  it('should accept overrides for denied result', () => {
    const r = makeRateLimitResult({ allowed: false, remaining: 0, retryAfter: 30 });
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.retryAfter).toBe(30);
  });
});

// ─── Authentication Factories ────────────────────────────────────────────────

describe('makeJWTPayload', () => {
  it('should return valid defaults', () => {
    const jwt = makeJWTPayload();
    expect(jwt.userId).toBeTruthy();
    expect(jwt.email).toBe('user@example.com');
    expect(jwt.businessId).toBeTruthy();
    expect(jwt.permissions).toEqual(['read', 'write']);
    expect(jwt.exp).toBeGreaterThan(jwt.iat);
  });

  it('should accept overrides', () => {
    const jwt = makeJWTPayload({ email: 'admin@cashtrace.ng', permissions: ['admin'] });
    expect(jwt.email).toBe('admin@cashtrace.ng');
    expect(jwt.permissions).toEqual(['admin']);
  });
});

describe('makeAPIKeyPayload', () => {
  it('should return valid defaults', () => {
    const key = makeAPIKeyPayload();
    expect(key.serviceId).toBeTruthy();
    expect(key.serviceName).toBe('transaction-engine');
    expect(key.permissions).toEqual(['internal:read', 'internal:write']);
  });

  it('should accept overrides', () => {
    const key = makeAPIKeyPayload({ serviceName: 'gemini-service' });
    expect(key.serviceName).toBe('gemini-service');
  });
});

// ─── Request Context Factories ───────────────────────────────────────────────

describe('makeRequestContext', () => {
  it('should return valid defaults', () => {
    const ctx = makeRequestContext();
    expect(ctx.correlationId).toBeTruthy();
    expect(ctx.clientIP).toBe('192.168.1.1');
    expect(ctx.userAgent).toBeTruthy();
    expect(ctx.timestamp).toBeInstanceOf(Date);
    expect(ctx.permissions).toEqual([]);
    expect(ctx.userId).toBeUndefined();
    expect(ctx.businessId).toBeUndefined();
  });

  it('should accept overrides for authenticated context', () => {
    const ctx = makeRequestContext({
      userId: 'user-123',
      businessId: 'biz-456',
      permissions: ['read'],
    });
    expect(ctx.userId).toBe('user-123');
    expect(ctx.businessId).toBe('biz-456');
    expect(ctx.permissions).toEqual(['read']);
  });
});

// ─── Routing Factories ───────────────────────────────────────────────────────

describe('makeCircuitBreakerConfig', () => {
  it('should return valid defaults', () => {
    const cb = makeCircuitBreakerConfig();
    expect(cb.failureThreshold).toBe(5);
    expect(cb.resetTimeout).toBe(30_000);
    expect(cb.halfOpenRequests).toBe(3);
  });

  it('should accept overrides', () => {
    const cb = makeCircuitBreakerConfig({ failureThreshold: 10 });
    expect(cb.failureThreshold).toBe(10);
    expect(cb.resetTimeout).toBe(30_000);
  });
});

describe('makeRouteConfig', () => {
  it('should return valid defaults', () => {
    const route = makeRouteConfig();
    expect(route.method).toBe('GET');
    expect(route.path).toBe('/api/v1/health');
    expect(route.service).toBe('auth-service');
    expect(route.timeout).toBe(30_000);
    expect(route.retries).toBe(2);
    expect(route.auth).toBe('jwt');
    expect(route.circuitBreaker.failureThreshold).toBe(5);
  });

  it('should accept overrides', () => {
    const route = makeRouteConfig({
      method: 'POST',
      path: '/api/v1/login',
      auth: 'none',
      rateLimit: makeRateLimit({ requests: 5 }),
    });
    expect(route.method).toBe('POST');
    expect(route.path).toBe('/api/v1/login');
    expect(route.auth).toBe('none');
    expect(route.rateLimit?.requests).toBe(5);
  });
});

// ─── Validation Factories ────────────────────────────────────────────────────

describe('makeValidationError', () => {
  it('should return valid defaults', () => {
    const err = makeValidationError();
    expect(err.path).toBe('body.email');
    expect(err.message).toBeTruthy();
    expect(err.keyword).toBe('format');
  });

  it('should accept overrides', () => {
    const err = makeValidationError({ path: 'body.amount', keyword: 'minimum' });
    expect(err.path).toBe('body.amount');
    expect(err.keyword).toBe('minimum');
  });
});

describe('makeValidationResult', () => {
  it('should return valid by default', () => {
    const r = makeValidationResult();
    expect(r.valid).toBe(true);
    expect(r.errors).toBeUndefined();
  });

  it('should accept overrides for invalid result', () => {
    const r = makeValidationResult({
      valid: false,
      errors: [makeValidationError()],
    });
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveLength(1);
  });
});

// ─── Error Factories ─────────────────────────────────────────────────────────

describe('makeAPIError', () => {
  it('should return valid defaults', () => {
    const err = makeAPIError();
    expect(err.code).toBe(GATEWAY_ERROR_CODES.VALIDATION_FAILED);
    expect(err.message).toBeTruthy();
    expect(err.correlationId).toBeTruthy();
    expect(err.timestamp).toBeTruthy();
  });

  it('should accept overrides', () => {
    const err = makeAPIError({
      code: GATEWAY_ERROR_CODES.RATE_LIMITED,
      message: 'Too many requests',
    });
    expect(err.code).toBe('GW_RATE_LIMITED');
    expect(err.message).toBe('Too many requests');
  });
});

// ─── Request Log Factories ───────────────────────────────────────────────────

describe('makeRequestLog', () => {
  it('should return valid defaults', () => {
    const log = makeRequestLog();
    expect(log.id).toBeTruthy();
    expect(log.correlationId).toBeTruthy();
    expect(log.method).toBe('GET');
    expect(log.path).toBe('/api/v1/health');
    expect(log.statusCode).toBe(200);
    expect(log.duration).toBe(42);
    expect(log.clientIP).toBe('192.168.1.1');
    expect(log.requestSize).toBe(256);
    expect(log.responseSize).toBe(1024);
    expect(log.timestamp).toBeInstanceOf(Date);
  });

  it('should accept overrides', () => {
    const log = makeRequestLog({
      method: 'POST',
      statusCode: 429,
      userId: 'user-123',
    });
    expect(log.method).toBe('POST');
    expect(log.statusCode).toBe(429);
    expect(log.userId).toBe('user-123');
  });
});
