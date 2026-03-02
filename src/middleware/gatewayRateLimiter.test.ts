/**
 * Unit tests for the API Gateway rate limiter middleware.
 *
 * Tests cover:
 * - Sliding window rate limit checks (Req 1.1, 1.2, 1.5)
 * - Per-IP vs per-user key generation
 * - HTTP 429 with Retry-After header (Req 1.4)
 * - Rate limit headers on all responses
 * - Fail-open on Redis errors
 *
 * @module middleware/gatewayRateLimiter.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type Redis from 'ioredis';

import {
  checkRateLimit,
  getRemaining,
  resetRateLimit,
  buildIPKey,
  buildUserKey,
  buildEndpointKey,
  createRateLimiterMiddleware,
  DEFAULT_IP_LIMIT,
  DEFAULT_USER_LIMIT,
  LOGIN_LIMIT,
  SIGNUP_LIMIT,
  DEFAULT_ENDPOINT_LIMITS,
} from './gatewayRateLimiter.js';
import type { RateLimit } from '../gateway/types.js';
import { GATEWAY_ERROR_CODES } from '../gateway/types.js';

// ─── Mock Redis ──────────────────────────────────────────────────────────────

function createMockRedis(): {
  redis: Redis;
  mockEval: ReturnType<typeof vi.fn>;
  mockZremrangebyscore: ReturnType<typeof vi.fn>;
  mockZcard: ReturnType<typeof vi.fn>;
  mockDel: ReturnType<typeof vi.fn>;
} {
  const mockEval = vi.fn();
  const mockZremrangebyscore = vi.fn();
  const mockZcard = vi.fn();
  const mockDel = vi.fn();

  const redis = {
    eval: mockEval,
    zremrangebyscore: mockZremrangebyscore,
    zcard: mockZcard,
    del: mockDel,
  } as unknown as Redis;

  return { redis, mockEval, mockZremrangebyscore, mockZcard, mockDel };
}

// ─── Mock Express ────────────────────────────────────────────────────────────

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    ip: '192.168.1.1',
    path: '/api/some/endpoint',
    context: {
      correlationId: 'test-correlation-id',
      clientIP: '192.168.1.1',
      userAgent: 'test-agent',
      timestamp: new Date(),
      permissions: [],
    },
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function createMockRes(): {
  res: Response;
  statusCode: number | undefined;
  headers: Record<string, string | number>;
  body: unknown;
} {
  const state = {
    statusCode: undefined as number | undefined,
    headers: {} as Record<string, string | number>,
    body: undefined as unknown,
  };

  const res = {
    setHeader: vi.fn((name: string, value: string | number) => {
      state.headers[name] = value;
      return res;
    }),
    status: vi.fn((code: number) => {
      state.statusCode = code;
      return res;
    }),
    json: vi.fn((data: unknown) => {
      state.body = data;
      return res;
    }),
  } as unknown as Response;

  return { res, ...state };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('gatewayRateLimiter', () => {
  let redis: Redis;
  let mockEval: ReturnType<typeof vi.fn>;
  let mockZremrangebyscore: ReturnType<typeof vi.fn>;
  let mockZcard: ReturnType<typeof vi.fn>;
  let mockDel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const mocks = createMockRedis();
    redis = mocks.redis;
    mockEval = mocks.mockEval;
    mockZremrangebyscore = mocks.mockZremrangebyscore;
    mockZcard = mocks.mockZcard;
    mockDel = mocks.mockDel;
  });

  // ── Key Builders ─────────────────────────────────────────────────────────

  describe('key builders', () => {
    it('buildIPKey should combine prefix and IP', () => {
      expect(buildIPKey('gw:rl:ip:', '10.0.0.1')).toBe('gw:rl:ip:10.0.0.1');
    });

    it('buildUserKey should combine prefix and userId', () => {
      expect(buildUserKey('gw:rl:user:', 'user-123')).toBe('gw:rl:user:user-123');
    });

    it('IP and user keys should be different for same identifier', () => {
      expect(buildIPKey('gw:rl:ip:', '123')).not.toBe(buildUserKey('gw:rl:user:', '123'));
    });

    it('buildEndpointKey should combine prefix, path, and IP', () => {
      expect(buildEndpointKey('gw:rl:endpoint:', '/api/auth/login', '10.0.0.1')).toBe(
        'gw:rl:endpoint:/api/auth/login:10.0.0.1',
      );
    });
  });

  // ── checkRateLimit ───────────────────────────────────────────────────────

  describe('checkRateLimit', () => {
    const limit: RateLimit = { requests: 100, window: 60, keyPrefix: 'gw:rl:ip:' };

    it('should allow the first request', async () => {
      mockEval.mockResolvedValueOnce(0);

      const result = await checkRateLimit(redis, 'gw:rl:ip:1.2.3.4', limit);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99);
      expect(result.retryAfter).toBeUndefined();
      expect(result.resetAt).toBeInstanceOf(Date);
    });

    it('should allow requests under the limit', async () => {
      mockEval.mockResolvedValueOnce(50);

      const result = await checkRateLimit(redis, 'gw:rl:ip:1.2.3.4', limit);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(49);
    });

    it('should deny requests at the limit', async () => {
      mockEval.mockResolvedValueOnce(100);

      const result = await checkRateLimit(redis, 'gw:rl:ip:1.2.3.4', limit);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBe(60);
    });

    it('should deny requests over the limit', async () => {
      mockEval.mockResolvedValueOnce(150);

      const result = await checkRateLimit(redis, 'gw:rl:ip:1.2.3.4', limit);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should return resetAt in the future', async () => {
      mockEval.mockResolvedValueOnce(0);
      const before = Date.now();

      const result = await checkRateLimit(redis, 'gw:rl:ip:1.2.3.4', limit);

      expect(result.resetAt.getTime()).toBeGreaterThanOrEqual(before + 60_000);
    });

    it('should pass correct arguments to Redis eval', async () => {
      mockEval.mockResolvedValueOnce(0);

      await checkRateLimit(redis, 'gw:rl:ip:1.2.3.4', limit);

      expect(mockEval).toHaveBeenCalledOnce();
      const args = mockEval.mock.calls[0]!;
      expect(args[1]).toBe(1); // numkeys
      expect(args[2]).toBe('gw:rl:ip:1.2.3.4'); // key
      expect(args[4]).toBe('100'); // limit
      expect(args[7]).toBe('60'); // window seconds
    });
  });

  // ── getRemaining ─────────────────────────────────────────────────────────

  describe('getRemaining', () => {
    const limit: RateLimit = { requests: 100, window: 60, keyPrefix: 'gw:rl:ip:' };

    it('should return full limit when no requests made', async () => {
      mockZremrangebyscore.mockResolvedValueOnce(0);
      mockZcard.mockResolvedValueOnce(0);

      const remaining = await getRemaining(redis, 'gw:rl:ip:1.2.3.4', limit);

      expect(remaining).toBe(100);
    });

    it('should return correct remaining after some requests', async () => {
      mockZremrangebyscore.mockResolvedValueOnce(0);
      mockZcard.mockResolvedValueOnce(30);

      const remaining = await getRemaining(redis, 'gw:rl:ip:1.2.3.4', limit);

      expect(remaining).toBe(70);
    });

    it('should return 0 when limit exhausted', async () => {
      mockZremrangebyscore.mockResolvedValueOnce(0);
      mockZcard.mockResolvedValueOnce(100);

      const remaining = await getRemaining(redis, 'gw:rl:ip:1.2.3.4', limit);

      expect(remaining).toBe(0);
    });

    it('should never return negative', async () => {
      mockZremrangebyscore.mockResolvedValueOnce(0);
      mockZcard.mockResolvedValueOnce(200);

      const remaining = await getRemaining(redis, 'gw:rl:ip:1.2.3.4', limit);

      expect(remaining).toBe(0);
    });
  });

  // ── resetRateLimit ───────────────────────────────────────────────────────

  describe('resetRateLimit', () => {
    it('should delete the key from Redis', async () => {
      mockDel.mockResolvedValueOnce(1);

      await resetRateLimit(redis, 'gw:rl:ip:1.2.3.4');

      expect(mockDel).toHaveBeenCalledWith('gw:rl:ip:1.2.3.4');
    });

    it('should not throw when key does not exist', async () => {
      mockDel.mockResolvedValueOnce(0);

      await expect(resetRateLimit(redis, 'gw:rl:nonexistent')).resolves.toBeUndefined();
    });
  });

  // ── Defaults ─────────────────────────────────────────────────────────────

  describe('defaults', () => {
    it('DEFAULT_IP_LIMIT should be 100 requests per 60 seconds (Req 1.1)', () => {
      expect(DEFAULT_IP_LIMIT.requests).toBe(100);
      expect(DEFAULT_IP_LIMIT.window).toBe(60);
      expect(DEFAULT_IP_LIMIT.keyPrefix).toBe('gw:rl:ip:');
    });

    it('DEFAULT_USER_LIMIT should be 300 requests per 60 seconds (Req 1.2)', () => {
      expect(DEFAULT_USER_LIMIT.requests).toBe(300);
      expect(DEFAULT_USER_LIMIT.window).toBe(60);
      expect(DEFAULT_USER_LIMIT.keyPrefix).toBe('gw:rl:user:');
    });

    it('LOGIN_LIMIT should be 5 requests per 60 seconds (Req 1.3)', () => {
      expect(LOGIN_LIMIT.requests).toBe(5);
      expect(LOGIN_LIMIT.window).toBe(60);
      expect(LOGIN_LIMIT.keyPrefix).toBe('gw:rl:endpoint:');
    });

    it('SIGNUP_LIMIT should be 3 requests per 60 seconds (Req 1.3)', () => {
      expect(SIGNUP_LIMIT.requests).toBe(3);
      expect(SIGNUP_LIMIT.window).toBe(60);
      expect(SIGNUP_LIMIT.keyPrefix).toBe('gw:rl:endpoint:');
    });

    it('DEFAULT_ENDPOINT_LIMITS should map login and signup paths', () => {
      expect(DEFAULT_ENDPOINT_LIMITS.get('/api/auth/login')).toBe(LOGIN_LIMIT);
      expect(DEFAULT_ENDPOINT_LIMITS.get('/api/auth/signup')).toBe(SIGNUP_LIMIT);
    });
  });

  // ── Middleware ────────────────────────────────────────────────────────────

  describe('createRateLimiterMiddleware', () => {
    it('should pass through when request is within limit', async () => {
      mockEval.mockResolvedValueOnce(5);
      const middleware = createRateLimiterMiddleware(redis);
      const req = createMockReq();
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 100);
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', expect.any(Number));
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(Number));
    });

    it('should return 429 when rate limited', async () => {
      mockEval.mockResolvedValueOnce(100);
      const middleware = createRateLimiterMiddleware(redis);
      const req = createMockReq();
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: GATEWAY_ERROR_CODES.RATE_LIMITED,
          }),
        }),
      );
    });

    it('should set Retry-After header when rate limited', async () => {
      mockEval.mockResolvedValueOnce(100);
      const middleware = createRateLimiterMiddleware(redis);
      const req = createMockReq();
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 60);
    });

    it('should use per-IP limit for unauthenticated requests', async () => {
      mockEval.mockResolvedValueOnce(5);
      const middleware = createRateLimiterMiddleware(redis);
      const req = createMockReq(); // no userId in context
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      const evalArgs = mockEval.mock.calls[0]!;
      const key = evalArgs[2] as string;
      expect(key).toContain('gw:rl:ip:');
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 100);
    });

    it('should use per-user limit for authenticated requests', async () => {
      mockEval.mockResolvedValueOnce(10);
      const middleware = createRateLimiterMiddleware(redis);
      const req = createMockReq({
        context: {
          correlationId: 'test-id',
          clientIP: '192.168.1.1',
          userAgent: 'test',
          timestamp: new Date(),
          permissions: [],
          userId: 'user-abc',
        },
      } as Partial<Request>);
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      const evalArgs = mockEval.mock.calls[0]!;
      const key = evalArgs[2] as string;
      expect(key).toContain('gw:rl:user:');
      expect(key).toContain('user-abc');
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 300);
    });

    it('should include correlationId in error response', async () => {
      mockEval.mockResolvedValueOnce(100);
      const middleware = createRateLimiterMiddleware(redis);
      const req = createMockReq();
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            correlationId: 'test-correlation-id',
          }),
        }),
      );
    });

    it('should fail-open on Redis errors', async () => {
      mockEval.mockRejectedValueOnce(new Error('Redis connection lost'));
      const middleware = createRateLimiterMiddleware(redis);
      const req = createMockReq();
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it('should accept custom config overrides', async () => {
      mockEval.mockResolvedValueOnce(5);
      const customConfig = {
        ipLimit: { requests: 50, window: 30, keyPrefix: 'custom:ip:' },
      };
      const middleware = createRateLimiterMiddleware(redis, customConfig);
      const req = createMockReq();
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 50);
    });

    it('should set rate limit headers even on allowed requests', async () => {
      mockEval.mockResolvedValueOnce(0);
      const middleware = createRateLimiterMiddleware(redis);
      const req = createMockReq();
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 100);
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 99);
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(Number));
    });

    // ── Endpoint-specific limits (Req 1.3) ───────────────────────────────

    it('should use login endpoint limit (5/min) for /api/auth/login', async () => {
      mockEval.mockResolvedValueOnce(2);
      const middleware = createRateLimiterMiddleware(redis);
      const req = createMockReq({ path: '/api/auth/login' } as Partial<Request>);
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 5);
      const evalArgs = mockEval.mock.calls[0]!;
      const key = evalArgs[2] as string;
      expect(key).toBe('gw:rl:endpoint:/api/auth/login:192.168.1.1');
    });

    it('should use signup endpoint limit (3/min) for /api/auth/signup', async () => {
      mockEval.mockResolvedValueOnce(1);
      const middleware = createRateLimiterMiddleware(redis);
      const req = createMockReq({ path: '/api/auth/signup' } as Partial<Request>);
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 3);
      const evalArgs = mockEval.mock.calls[0]!;
      const key = evalArgs[2] as string;
      expect(key).toBe('gw:rl:endpoint:/api/auth/signup:192.168.1.1');
    });

    it('should return 429 when login endpoint limit is exceeded', async () => {
      mockEval.mockResolvedValueOnce(5);
      const middleware = createRateLimiterMiddleware(redis);
      const req = createMockReq({ path: '/api/auth/login' } as Partial<Request>);
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('should use default IP limit for non-matching endpoints', async () => {
      mockEval.mockResolvedValueOnce(5);
      const middleware = createRateLimiterMiddleware(redis);
      const req = createMockReq({ path: '/api/businesses' } as Partial<Request>);
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 100);
      const evalArgs = mockEval.mock.calls[0]!;
      const key = evalArgs[2] as string;
      expect(key).toContain('gw:rl:ip:');
    });

    it('should allow overriding endpoint limits via config', async () => {
      mockEval.mockResolvedValueOnce(0);
      const customEndpoints = new Map([
        ['/api/auth/login', { requests: 10, window: 60, keyPrefix: 'gw:rl:endpoint:' }],
      ]);
      const middleware = createRateLimiterMiddleware(redis, { endpointLimits: customEndpoints });
      const req = createMockReq({ path: '/api/auth/login' } as Partial<Request>);
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
    });

    // ── API key bypass (Req 1.6) ─────────────────────────────────────────

    it('should bypass rate limiting when X-API-Key header is present', async () => {
      const middleware = createRateLimiterMiddleware(redis);
      const req = createMockReq({
        headers: { 'x-api-key': 'service-key-123' },
      } as Partial<Request>);
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(mockEval).not.toHaveBeenCalled();
    });

    it('should rate limit normally when X-API-Key header is absent', async () => {
      mockEval.mockResolvedValueOnce(100);
      const middleware = createRateLimiterMiddleware(redis);
      const req = createMockReq();
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(mockEval).toHaveBeenCalledOnce();
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('should not bypass when apiKeyBypass is disabled', async () => {
      mockEval.mockResolvedValueOnce(100);
      const middleware = createRateLimiterMiddleware(redis, { apiKeyBypass: false });
      const req = createMockReq({
        headers: { 'x-api-key': 'service-key-123' },
      } as Partial<Request>);
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(mockEval).toHaveBeenCalledOnce();
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('should support custom bypass header name', async () => {
      const middleware = createRateLimiterMiddleware(redis, {
        bypassHeader: 'x-service-token',
      });
      const req = createMockReq({
        headers: { 'x-service-token': 'internal-token-456' },
      } as Partial<Request>);
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(mockEval).not.toHaveBeenCalled();
    });

    // ── Violation logging (Req 1.7) ──────────────────────────────────────

    it('should call onViolation when IP rate limit is exceeded (Req 1.7)', async () => {
      mockEval.mockResolvedValueOnce(100);
      const onViolation = vi.fn();
      const middleware = createRateLimiterMiddleware(redis, { onViolation });
      const req = createMockReq();
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(onViolation).toHaveBeenCalledOnce();
      expect(onViolation).toHaveBeenCalledWith(
        expect.objectContaining({
          clientIP: '192.168.1.1',
          path: '/api/some/endpoint',
          correlationId: 'test-correlation-id',
          limitType: 'ip',
        }),
      );
      expect(onViolation.mock.calls[0][0].timestamp).toBeInstanceOf(Date);
    });

    it('should call onViolation with limitType "user" for authenticated requests (Req 1.7)', async () => {
      mockEval.mockResolvedValueOnce(300);
      const onViolation = vi.fn();
      const middleware = createRateLimiterMiddleware(redis, { onViolation });
      const req = createMockReq({
        context: {
          correlationId: 'auth-corr',
          clientIP: '10.0.0.1',
          userAgent: 'test',
          timestamp: new Date(),
          permissions: [],
          userId: 'user-xyz',
        },
      } as Partial<Request>);
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(onViolation).toHaveBeenCalledOnce();
      expect(onViolation).toHaveBeenCalledWith(
        expect.objectContaining({
          limitType: 'user',
          userId: 'user-xyz',
        }),
      );
    });

    it('should call onViolation with limitType "endpoint" for endpoint limits (Req 1.7)', async () => {
      mockEval.mockResolvedValueOnce(5);
      const onViolation = vi.fn();
      const middleware = createRateLimiterMiddleware(redis, { onViolation });
      const req = createMockReq({ path: '/api/auth/login' } as Partial<Request>);
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(onViolation).toHaveBeenCalledOnce();
      expect(onViolation).toHaveBeenCalledWith(
        expect.objectContaining({
          limitType: 'endpoint',
          path: '/api/auth/login',
        }),
      );
    });

    it('should not call onViolation when request is allowed', async () => {
      mockEval.mockResolvedValueOnce(5);
      const onViolation = vi.fn();
      const middleware = createRateLimiterMiddleware(redis, { onViolation });
      const req = createMockReq();
      const { res } = createMockRes();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(onViolation).not.toHaveBeenCalled();
    });
  });
});
