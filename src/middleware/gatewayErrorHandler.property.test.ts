/**
 * Property-based tests for error response consistency.
 *
 * **Property 8: Error Response Consistency**
 * For any error response, it SHALL include code, message, correlationId,
 * and timestamp in consistent JSON format.
 *
 * **Validates: Requirements 10.1, 10.3**
 *
 * @module middleware/gatewayErrorHandler.property.test
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Request, Response, NextFunction } from 'express';

import { GatewayError, createErrorHandlerMiddleware } from './gatewayErrorHandler.js';
import { CircuitOpenError } from '../utils/circuitBreaker.js';
import { GATEWAY_ERROR_CODES } from '../gateway/types.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Arbitrary for valid HTTP error status codes (400–599). */
const httpErrorStatusArb = fc.integer({ min: 400, max: 599 });

/** Arbitrary for non-empty error code strings. */
const errorCodeArb = fc.stringOf(
  fc.constantFrom(
    'A',
    'B',
    'C',
    'D',
    'E',
    'F',
    'G',
    'H',
    'I',
    'J',
    'K',
    'L',
    'M',
    'N',
    'O',
    'P',
    'Q',
    'R',
    'S',
    'T',
    'U',
    'V',
    'W',
    'X',
    'Y',
    'Z',
    '_',
  ),
  { minLength: 3, maxLength: 30 },
);

/** Arbitrary for non-empty error messages. */
const errorMessageArb = fc.string({ minLength: 1, maxLength: 200 });

/** Arbitrary for correlation ID strings. */
const correlationIdArb = fc.uuid();

/** Arbitrary for known gateway error codes. */
const gatewayErrorCodeArb = fc.constantFrom(...Object.values(GATEWAY_ERROR_CODES));

/** Arbitrary for service names (used in CircuitOpenError). */
const serviceNameArb = fc.stringOf(
  fc.constantFrom(
    'a',
    'b',
    'c',
    'd',
    'e',
    'f',
    'g',
    'h',
    'i',
    'j',
    'k',
    'l',
    'm',
    'n',
    'o',
    'p',
    'q',
    'r',
    's',
    't',
    'u',
    'v',
    'w',
    'x',
    'y',
    'z',
    '-',
  ),
  { minLength: 1, maxLength: 30 },
);

// ─── Mock Helpers ────────────────────────────────────────────────────────────

interface CapturedResponse {
  statusCode: number;
  body: unknown;
}
/** Create a minimal mock Request with the given correlation ID. */
function mockRequest(correlationId?: string): Request {
  return {
    context: correlationId !== undefined ? { correlationId } : undefined,
  } as unknown as Request;
}

/** Create a mock Response that captures status and JSON body. */
function mockResponse(): { res: Response; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 0, body: null };
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, captured };
}

const noopNext: NextFunction = () => undefined;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Property 8: Error Response Consistency', () => {
  /**
   * **Validates: Requirements 10.1, 10.3**
   *
   * For any error type (GatewayError, CircuitOpenError, plain Error,
   * or object with code), the response SHALL always include code,
   * message, correlationId, and timestamp fields.
   */
  it('all error responses include code, message, correlationId, and timestamp', () => {
    const handler = createErrorHandlerMiddleware();

    const errorArb = fc.oneof(
      // GatewayError
      fc
        .tuple(gatewayErrorCodeArb, errorMessageArb, httpErrorStatusArb)
        .map(([code, msg, status]) => new GatewayError(code, msg, status)),
      // CircuitOpenError
      serviceNameArb.map((svc) => new CircuitOpenError(svc)),
      // Plain Error
      errorMessageArb.map((msg) => new Error(msg)),
      // Object with known gateway code
      fc.tuple(gatewayErrorCodeArb, errorMessageArb).map(([code, msg]) => ({ code, message: msg })),
      // Object with unknown code
      fc.tuple(errorCodeArb, errorMessageArb).map(([code, msg]) => ({ code, message: msg })),
    );

    fc.assert(
      fc.property(errorArb, correlationIdArb, (err, corrId) => {
        const req = mockRequest(corrId);
        const { res, captured } = mockResponse();

        handler(err, req, res, noopNext);

        const body = captured.body as { success: boolean; error: Record<string, unknown> };

        expect(body).toBeDefined();
        expect(body.success).toBe(false);
        expect(body.error).toBeDefined();
        expect(typeof body.error.code).toBe('string');
        expect((body.error.code as string).length).toBeGreaterThan(0);
        expect(typeof body.error.message).toBe('string');
        expect(typeof body.error.correlationId).toBe('string');
        expect(typeof body.error.timestamp).toBe('string');
        // Timestamp must be a valid ISO 8601 string
        expect(Number.isNaN(Date.parse(body.error.timestamp as string))).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 10.1**
   *
   * For any valid HTTP error status code (400–599), a GatewayError
   * constructed with that status SHALL produce a response with that
   * exact status code.
   */
  it('GatewayError status codes are preserved in the response', () => {
    const handler = createErrorHandlerMiddleware();

    fc.assert(
      fc.property(gatewayErrorCodeArb, errorMessageArb, httpErrorStatusArb, (code, msg, status) => {
        const err = new GatewayError(code, msg, status);
        const req = mockRequest('test-corr-id');
        const { res, captured } = mockResponse();

        handler(err, req, res, noopNext);

        expect(captured.statusCode).toBe(status);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 10.3**
   *
   * For any correlation ID string present on the request context,
   * it SHALL appear verbatim in the error response body.
   */
  it('correlation ID from request context is always propagated', () => {
    const handler = createErrorHandlerMiddleware();

    const errorArb = fc.oneof(
      fc
        .tuple(gatewayErrorCodeArb, errorMessageArb, httpErrorStatusArb)
        .map(([code, msg, status]) => new GatewayError(code, msg, status)),
      serviceNameArb.map((svc) => new CircuitOpenError(svc)),
      errorMessageArb.map((msg) => new Error(msg)),
    );

    fc.assert(
      fc.property(errorArb, correlationIdArb, (err, corrId) => {
        const req = mockRequest(corrId);
        const { res, captured } = mockResponse();

        handler(err, req, res, noopNext);

        const body = captured.body as { error: { correlationId: string } };
        expect(body.error.correlationId).toBe(corrId);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 10.1, 10.3**
   *
   * When no request context is present, the correlation ID SHALL
   * default to 'unknown' rather than being absent.
   */
  it('defaults correlationId to "unknown" when request context is missing', () => {
    const handler = createErrorHandlerMiddleware();

    fc.assert(
      fc.property(errorMessageArb, (msg) => {
        const req = mockRequest(); // no correlationId
        const { res, captured } = mockResponse();

        handler(new Error(msg), req, res, noopNext);

        const body = captured.body as { error: { correlationId: string } };
        expect(body.error.correlationId).toBe('unknown');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 10.1, 10.4**
   *
   * In production mode (exposeErrors=false), for any random error
   * message on an unknown error, the response SHALL always return
   * "Internal server error" — never exposing the original message.
   */
  it('production mode never exposes internal error messages for unknown errors', () => {
    const handler = createErrorHandlerMiddleware({ exposeErrors: false });

    fc.assert(
      fc.property(errorMessageArb, correlationIdArb, (msg, corrId) => {
        const err = new Error(msg);
        const req = mockRequest(corrId);
        const { res, captured } = mockResponse();

        handler(err, req, res, noopNext);

        const body = captured.body as { error: { message: string; code: string } };
        expect(body.error.message).toBe('Internal server error');
        expect(body.error.code).toBe('INTERNAL_ERROR');
        expect(captured.statusCode).toBe(500);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 10.1, 10.4**
   *
   * In development mode (exposeErrors=true), unknown errors SHALL
   * expose the original error message and include stack details.
   */
  it('development mode exposes original error message for unknown errors', () => {
    const handler = createErrorHandlerMiddleware({ exposeErrors: true });

    fc.assert(
      fc.property(errorMessageArb, correlationIdArb, (msg, corrId) => {
        const err = new Error(msg);
        const req = mockRequest(corrId);
        const { res, captured } = mockResponse();

        handler(err, req, res, noopNext);

        const body = captured.body as {
          error: { message: string; details?: { stack: string } };
        };
        expect(body.error.message).toBe(msg);
        expect(body.error.details).toBeDefined();
        expect(typeof body.error.details?.stack).toBe('string');
      }),
      { numRuns: 200 },
    );
  });
});
