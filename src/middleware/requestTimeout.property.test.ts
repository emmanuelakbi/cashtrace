/**
 * Property-based tests for request timeout middleware.
 *
 * **Property 7: Request Timeout**
 * For any request exceeding configured timeout, it SHALL be terminated
 * and return 504 status.
 *
 * **Validates: Requirements 4.4**
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import fc from 'fast-check';

import type { RouteConfig } from '../gateway/types.js';
import { GATEWAY_ERROR_CODES } from '../gateway/types.js';

import { createTimeoutMiddleware } from './requestTimeout.js';

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
  return {
    context: overrides.context ?? { correlationId: 'test-correlation-id' },
    routeConfig: overrides.routeConfig as RouteConfig | undefined,
  } as unknown as Request;
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

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Timeout value in a realistic range (10ms – 60 000ms). */
const timeoutArb = fc.integer({ min: 10, max: 60_000 });

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Request Timeout Properties (Property 7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * **Property: Any timeout value triggers 504 after exactly that duration.**
   *
   * For any timeout in [10, 60 000], the middleware SHALL respond with
   * HTTP 504 and error code GW_TIMEOUT once the timeout elapses.
   *
   * **Validates: Requirement 4.4**
   */
  it('responds 504 with GW_TIMEOUT after the configured timeout elapses', () => {
    fc.assert(
      fc.property(timeoutArb, (timeout) => {
        const middleware = createTimeoutMiddleware(timeout);
        const req = createMockRequest();
        const res = createMockResponse();
        const next = vi.fn();

        middleware(req, res as unknown as Response, next as NextFunction);

        // Advance time to exactly the timeout
        vi.advanceTimersByTime(timeout);

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
      }),
      { numRuns: 150 },
    );
  });

  /**
   * **Property: No timeout before the deadline.**
   *
   * For any timeout in [10, 60 000], advancing time to (timeout − 1) ms
   * SHALL NOT trigger a response — the status and body remain untouched.
   *
   * **Validates: Requirement 4.4**
   */
  it('does not trigger a response before the timeout elapses', () => {
    fc.assert(
      fc.property(timeoutArb, (timeout) => {
        const middleware = createTimeoutMiddleware(timeout);
        const req = createMockRequest();
        const res = createMockResponse();
        const next = vi.fn();

        middleware(req, res as unknown as Response, next as NextFunction);

        // Advance to 1ms before the deadline
        vi.advanceTimersByTime(timeout - 1);

        expect(res.statusCode).toBe(0);
        expect(res.body).toBeUndefined();
      }),
      { numRuns: 150 },
    );
  });

  /**
   * **Property: Per-route timeout overrides default.**
   *
   * For any two distinct timeout values (default and route-specific),
   * the middleware SHALL use the route-specific timeout, not the default.
   *
   * **Validates: Requirement 4.4**
   */
  it('uses per-route timeout instead of the factory default', () => {
    fc.assert(
      fc.property(
        timeoutArb,
        timeoutArb.filter((t) => t >= 11),
        (defaultTimeout, routeTimeout) => {
          // Ensure the two values are different so the test is meaningful
          fc.pre(defaultTimeout !== routeTimeout);

          const middleware = createTimeoutMiddleware(defaultTimeout);
          const req = createMockRequest({
            routeConfig: { timeout: routeTimeout } as Partial<RouteConfig>,
          });
          const res = createMockResponse();
          const next = vi.fn();

          middleware(req, res as unknown as Response, next as NextFunction);

          // 1ms before route timeout — should NOT have fired
          vi.advanceTimersByTime(routeTimeout - 1);
          expect(res.statusCode).toBe(0);
          expect(res.body).toBeUndefined();

          // Exactly at route timeout — should fire
          vi.advanceTimersByTime(1);
          expect(res.statusCode).toBe(504);
        },
      ),
      { numRuns: 150 },
    );
  });

  /**
   * **Property: Completed responses are never overwritten.**
   *
   * For any timeout, if the response finishes (via 'finish' event) before
   * the deadline, no 504 SHALL be sent even after the timeout elapses.
   *
   * **Validates: Requirement 4.4**
   */
  it('does not overwrite a response that completed before the timeout', () => {
    fc.assert(
      fc.property(timeoutArb, fc.integer({ min: 0, max: 1 }), (timeout, eventIndex) => {
        const middleware = createTimeoutMiddleware(timeout);
        const req = createMockRequest();
        const res = createMockResponse();
        const next = vi.fn();

        middleware(req, res as unknown as Response, next as NextFunction);

        // Simulate the response completing before the timeout
        const event = eventIndex === 0 ? 'finish' : 'close';
        res._emit(event);

        // Advance well past the timeout
        vi.advanceTimersByTime(timeout * 2);

        // Response should remain untouched
        expect(res.statusCode).toBe(0);
        expect(res.body).toBeUndefined();
      }),
      { numRuns: 150 },
    );
  });
});
