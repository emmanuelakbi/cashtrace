/**
 * Unit tests for gateway error handler middleware.
 *
 * @module middleware/gatewayErrorHandler.test
 * @see Requirement 10.1 — consistent JSON error format
 * @see Requirement 10.3 — correlation ID in all error responses
 * @see Requirement 10.4 — hide internal details in production
 */

import { describe, it, expect } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import { GATEWAY_ERROR_CODES } from '../gateway/types.js';
import { CircuitOpenError } from '../utils/circuitBreaker.js';

import { GatewayError, createErrorHandlerMiddleware } from './gatewayErrorHandler.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface MockResponse {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (data: unknown) => MockResponse;
}

function createMockRequest(correlationId?: string): Request {
  return {
    context: correlationId !== undefined ? { correlationId } : undefined,
  } as unknown as Request;
}

function createMockResponse(): MockResponse {
  const res: MockResponse = {
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
  };
  return res;
}

const noopNext: NextFunction = (() => undefined) as NextFunction;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createErrorHandlerMiddleware', () => {
  const handler = createErrorHandlerMiddleware();

  it('should return correct status and body for GatewayError', () => {
    const err = new GatewayError(GATEWAY_ERROR_CODES.RATE_LIMITED, 'Too many requests', 429);
    const req = createMockRequest('corr-1');
    const res = createMockResponse();

    handler(err, req, res as unknown as Response, noopNext);

    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: GATEWAY_ERROR_CODES.RATE_LIMITED,
        message: 'Too many requests',
        correlationId: 'corr-1',
        timestamp: expect.any(String) as string,
      },
    });
  });

  it('should include details and fields from GatewayError', () => {
    const err = new GatewayError(GATEWAY_ERROR_CODES.VALIDATION_FAILED, 'Invalid input', 400, {
      details: { reason: 'bad format' },
      fields: { email: ['required'] },
    });
    const req = createMockRequest('corr-2');
    const res = createMockResponse();

    handler(err, req, res as unknown as Response, noopNext);

    expect(res.statusCode).toBe(400);
    const body = res.body as { error: { details: unknown; fields: unknown } };
    expect(body.error.details).toEqual({ reason: 'bad format' });
    expect(body.error.fields).toEqual({ email: ['required'] });
  });

  it('should handle CircuitOpenError with 503 status', () => {
    const err = new CircuitOpenError('payment-service');
    const req = createMockRequest('corr-3');
    const res = createMockResponse();

    handler(err, req, res as unknown as Response, noopNext);

    expect(res.statusCode).toBe(503);
    const body = res.body as { success: boolean; error: { code: string; details: unknown } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(GATEWAY_ERROR_CODES.CIRCUIT_OPEN);
    expect(body.error.details).toEqual({ service: 'payment-service' });
  });

  it('should map errors with known gateway error code', () => {
    const err = { code: GATEWAY_ERROR_CODES.FORBIDDEN, message: 'Access denied' };
    const req = createMockRequest('corr-4');
    const res = createMockResponse();

    handler(err, req, res as unknown as Response, noopNext);

    expect(res.statusCode).toBe(403);
    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe(GATEWAY_ERROR_CODES.FORBIDDEN);
    expect(body.error.message).toBe('Access denied');
  });

  it('should return 500 with generic message for unknown errors', () => {
    const err = new Error('something broke');
    const req = createMockRequest('corr-5');
    const res = createMockResponse();

    handler(err, req, res as unknown as Response, noopNext);

    expect(res.statusCode).toBe(500);
    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Internal server error');
  });

  it('should include correlation ID in every response', () => {
    const err = new Error('fail');
    const req = createMockRequest('my-corr-id');
    const res = createMockResponse();

    handler(err, req, res as unknown as Response, noopNext);

    const body = res.body as { error: { correlationId: string } };
    expect(body.error.correlationId).toBe('my-corr-id');
  });

  it('should use "unknown" when context is absent', () => {
    const err = new Error('fail');
    const req = { context: undefined } as unknown as Request;
    const res = createMockResponse();

    handler(err, req, res as unknown as Response, noopNext);

    const body = res.body as { error: { correlationId: string } };
    expect(body.error.correlationId).toBe('unknown');
  });

  it('should include timestamp in every response', () => {
    const err = new Error('fail');
    const req = createMockRequest('corr-ts');
    const res = createMockResponse();

    handler(err, req, res as unknown as Response, noopNext);

    const body = res.body as { error: { timestamp: string } };
    expect(body.error.timestamp).toBeDefined();
    // Verify it's a valid ISO 8601 string
    expect(new Date(body.error.timestamp).toISOString()).toBe(body.error.timestamp);
  });

  describe('production mode (exposeErrors=false)', () => {
    const prodHandler = createErrorHandlerMiddleware({ exposeErrors: false });

    it('should hide internal error details', () => {
      const err = new Error('secret db connection string');
      const req = createMockRequest('corr-prod');
      const res = createMockResponse();

      prodHandler(err, req, res as unknown as Response, noopNext);

      const body = res.body as { error: { message: string; details?: unknown } };
      expect(body.error.message).toBe('Internal server error');
      expect(body.error.details).toBeUndefined();
    });
  });

  describe('development mode (exposeErrors=true)', () => {
    const devHandler = createErrorHandlerMiddleware({ exposeErrors: true });

    it('should expose error message for unknown errors', () => {
      const err = new Error('detailed failure info');
      const req = createMockRequest('corr-dev');
      const res = createMockResponse();

      devHandler(err, req, res as unknown as Response, noopNext);

      const body = res.body as { error: { message: string; details?: { stack: string } } };
      expect(body.error.message).toBe('detailed failure info');
      expect(body.error.details?.stack).toBeDefined();
    });
  });
});
