/**
 * Unit tests for request timeout middleware.
 *
 * @module middleware/requestTimeout.test
 * @see Requirement 4.4 — configurable request timeout per endpoint
 * @see Property 7 — requests exceeding timeout return 504
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import type { RouteConfig } from '../gateway/types.js';
import { GATEWAY_ERROR_CODES } from '../gateway/types.js';

import { createTimeoutMiddleware, DEFAULT_TIMEOUT_MS } from './requestTimeout.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface MockResponse {
  headersSent: boolean;
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (data: unknown) => MockResponse;
  on: (event: string, cb: () => void) => MockResponse;
  _listeners: Map<string, Array<() => void>>;
  _emit: (event: string) => void;
}

function createMockRequest(
  overrides: {
    routeConfig?: Partial<RouteConfig>;
    context?: { correlationId: string };
  } = {},
): Request {
  const req = {
    context: overrides.context ?? { correlationId: 'test-correlation-id' },
    routeConfig: overrides.routeConfig as RouteConfig | undefined,
  } as unknown as Request;
  return req;
}

function createMockResponse(): MockResponse {
  const listeners = new Map<string, Array<() => void>>();

  const res: MockResponse = {
    headersSent: false,
    statusCode: 0,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
    on(event: string, cb: () => void) {
      const existing = listeners.get(event) ?? [];
      existing.push(cb);
      listeners.set(event, existing);
      return res;
    },
    _listeners: listeners,
    _emit(event: string) {
      const cbs = listeners.get(event) ?? [];
      for (const cb of cbs) {
        cb();
      }
    },
  };

  return res;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createTimeoutMiddleware', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should use default timeout of 30s when no routeConfig is present', () => {
    const middleware = createTimeoutMiddleware();
    const req = createMockRequest();
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();

    // Should not have timed out yet
    vi.advanceTimersByTime(DEFAULT_TIMEOUT_MS - 1);
    expect(res.body).toBeUndefined();

    // Now it should time out
    vi.advanceTimersByTime(1);
    expect(res.statusCode).toBe(504);
  });

  it('should use per-route timeout from routeConfig', () => {
    const middleware = createTimeoutMiddleware();
    const req = createMockRequest({ routeConfig: { timeout: 5_000 } as Partial<RouteConfig> });
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as unknown as Response, next as NextFunction);

    // Should not time out before 5s
    vi.advanceTimersByTime(4_999);
    expect(res.body).toBeUndefined();

    // Should time out at 5s
    vi.advanceTimersByTime(1);
    expect(res.statusCode).toBe(504);
  });

  it('should use custom default timeout from factory', () => {
    const middleware = createTimeoutMiddleware(10_000);
    const req = createMockRequest();
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as unknown as Response, next as NextFunction);

    vi.advanceTimersByTime(9_999);
    expect(res.body).toBeUndefined();

    vi.advanceTimersByTime(1);
    expect(res.statusCode).toBe(504);
  });

  it('should return 504 with GW_TIMEOUT error on timeout', () => {
    const middleware = createTimeoutMiddleware(100);
    const req = createMockRequest();
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as unknown as Response, next as NextFunction);
    vi.advanceTimersByTime(100);

    expect(res.statusCode).toBe(504);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: GATEWAY_ERROR_CODES.TIMEOUT,
        message: 'Request timed out',
        correlationId: 'test-correlation-id',
        timestamp: expect.any(String) as string,
      },
    });
  });

  it('should include correlation ID in error response', () => {
    const middleware = createTimeoutMiddleware(50);
    const req = createMockRequest({ context: { correlationId: 'abc-123' } });
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as unknown as Response, next as NextFunction);
    vi.advanceTimersByTime(50);

    const body = res.body as { error: { correlationId: string } };
    expect(body.error.correlationId).toBe('abc-123');
  });

  it('should use "unknown" correlation ID when context is absent', () => {
    const middleware = createTimeoutMiddleware(50);
    const req = { routeConfig: undefined, context: undefined } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as unknown as Response, next as NextFunction);
    vi.advanceTimersByTime(50);

    const body = res.body as { error: { correlationId: string } };
    expect(body.error.correlationId).toBe('unknown');
  });

  it('should clear timer when response finishes normally', () => {
    const middleware = createTimeoutMiddleware(100);
    const req = createMockRequest();
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as unknown as Response, next as NextFunction);

    // Simulate response finishing before timeout
    res._emit('finish');

    // Advance past the timeout — should NOT trigger 504
    vi.advanceTimersByTime(200);
    expect(res.body).toBeUndefined();
  });

  it('should clear timer on response close event', () => {
    const middleware = createTimeoutMiddleware(100);
    const req = createMockRequest();
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as unknown as Response, next as NextFunction);

    res._emit('close');

    vi.advanceTimersByTime(200);
    expect(res.body).toBeUndefined();
  });

  it('should not send response if headers already sent', () => {
    const middleware = createTimeoutMiddleware(50);
    const req = createMockRequest();
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as unknown as Response, next as NextFunction);

    // Simulate headers already sent (e.g. streaming response started)
    res.headersSent = true;

    vi.advanceTimersByTime(50);

    // Should not have set status or body
    expect(res.statusCode).toBe(0);
    expect(res.body).toBeUndefined();
  });

  it('should call next immediately', () => {
    const middleware = createTimeoutMiddleware();
    const req = createMockRequest();
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
  });

  it('should prefer routeConfig timeout over factory default', () => {
    const middleware = createTimeoutMiddleware(60_000);
    const req = createMockRequest({ routeConfig: { timeout: 2_000 } as Partial<RouteConfig> });
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as unknown as Response, next as NextFunction);

    // Should not time out at factory default minus route timeout
    vi.advanceTimersByTime(1_999);
    expect(res.body).toBeUndefined();

    // Should time out at route-specific timeout
    vi.advanceTimersByTime(1);
    expect(res.statusCode).toBe(504);
  });
});
