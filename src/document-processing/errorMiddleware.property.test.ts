/**
 * Property-based tests for API response consistency.
 *
 * **Property 19: API Response Consistency**
 * For any API response, it SHALL be valid JSON containing either a success
 * response with the expected data structure (including requestId) OR an error
 * response with error code, message, and requestId. HTTP status codes SHALL
 * match the response type.
 *
 * **Validates: Requirements 1.6, 2.5, 3.4, 12.1, 12.2, 12.3, 12.4**
 *
 * Tag: Feature: document-processing, Property 19: API Response Consistency
 *
 * @module document-processing/errorMiddleware.property.test
 */

import type { NextFunction, Request, Response } from 'express';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { getHttpStatusForDocError } from './documentController.js';
import { DocumentError } from './documentService.js';
import { documentErrorMiddleware } from './errorMiddleware.js';
import { DOC_ERROR_CODES } from './types.js';

// ─── UUID v4 regex ───────────────────────────────────────────────────────────

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

interface MockResponse extends Response {
  _status: number;
  _body: unknown;
}

function makeResponse(): MockResponse {
  const res = {
    _status: 0,
    _body: undefined,
    status: vi.fn().mockImplementation(function (this: MockResponse, code: number) {
      this._status = code;
      return this;
    }),
    json: vi.fn().mockImplementation(function (this: MockResponse, body: unknown) {
      this._body = body;
      return this;
    }),
  };
  return res as unknown as MockResponse;
}

const noopNext: NextFunction = vi.fn();

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** All valid DOC_ERROR_CODES values. */
const allErrorCodes = Object.values(DOC_ERROR_CODES);

/** Arbitrary for any valid document error code. */
const docErrorCodeArb = fc.constantFrom(...allErrorCodes);

/** Arbitrary for a non-empty error message. */
const errorMessageArb = fc.string({ minLength: 1, maxLength: 200 });

/** Arbitrary for an optional x-request-id header (UUID or absent). */
const optionalRequestIdArb = fc.option(fc.uuid(), { nil: undefined });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Property 19: API Response Consistency', () => {
  /**
   * **Validates: Requirements 12.1, 12.2, 12.3, 12.4**
   *
   * For any DocumentError with a valid DOC_ERROR_CODE and any message,
   * the middleware SHALL produce a response with:
   * - `success: false`
   * - `error.code` matching the input code
   * - `error.message` matching the input message
   * - a `requestId` string (from header or generated UUID)
   * - HTTP status matching `getHttpStatusForDocError(code)`
   */
  it('should produce consistent error response shape for any DocumentError', () => {
    fc.assert(
      fc.property(
        docErrorCodeArb,
        errorMessageArb,
        optionalRequestIdArb,
        (code, message, requestId) => {
          const err = new DocumentError(code, message);
          const headers: Record<string, string> = {};
          if (requestId !== undefined) {
            headers['x-request-id'] = requestId;
          }
          const req = makeRequest(headers);
          const res = makeResponse();

          documentErrorMiddleware(err, req, res, noopNext);

          // Verify HTTP status matches the error code mapping
          const expectedStatus = getHttpStatusForDocError(code);
          expect(res.status).toHaveBeenCalledWith(expectedStatus);
          expect(res._status).toBe(expectedStatus);

          // Verify JSON body structure
          const body = res._body as {
            success: boolean;
            error: { code: string; message: string };
            requestId: string;
          };

          expect(body.success).toBe(false);
          expect(body.error.code).toBe(code);
          expect(body.error.message).toBe(message);

          // requestId: either the provided header or a generated UUID
          expect(typeof body.requestId).toBe('string');
          expect(body.requestId.length).toBeGreaterThan(0);
          if (requestId !== undefined) {
            expect(body.requestId).toBe(requestId);
          } else {
            expect(body.requestId).toMatch(UUID_V4_REGEX);
          }
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 12.1, 12.2, 12.3**
   *
   * For any non-DocumentError thrown value (plain Error, string, number, null),
   * the middleware SHALL produce a 500 INTERNAL_ERROR response with the
   * consistent error shape.
   */
  it('should produce 500 INTERNAL_ERROR for any non-DocumentError', () => {
    /** Arbitrary for non-DocumentError thrown values. */
    const nonDocumentErrorArb = fc.oneof(
      fc.string().map((s) => new Error(s) as unknown),
      fc.string().map((s) => s as unknown),
      fc.integer().map((n) => n as unknown),
      fc.constant(null as unknown),
      fc.constant(undefined as unknown),
    );

    fc.assert(
      fc.property(nonDocumentErrorArb, optionalRequestIdArb, (err, requestId) => {
        const headers: Record<string, string> = {};
        if (requestId !== undefined) {
          headers['x-request-id'] = requestId;
        }
        const req = makeRequest(headers);
        const res = makeResponse();

        documentErrorMiddleware(err, req, res, noopNext);

        // Always 500 for non-DocumentError
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res._status).toBe(500);

        const body = res._body as {
          success: boolean;
          error: { code: string; message: string };
          requestId: string;
        };

        expect(body.success).toBe(false);
        expect(body.error.code).toBe(DOC_ERROR_CODES.INTERNAL_ERROR);
        expect(body.error.message).toBe('Internal server error');

        // requestId is always present
        expect(typeof body.requestId).toBe('string');
        expect(body.requestId.length).toBeGreaterThan(0);
        if (requestId !== undefined) {
          expect(body.requestId).toBe(requestId);
        } else {
          expect(body.requestId).toMatch(UUID_V4_REGEX);
        }
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 12.3**
   *
   * For every known DOC_ERROR_CODE, the HTTP status SHALL be one of the
   * valid HTTP status codes defined in the spec (200, 201, 400, 403, 404, 413, 500).
   */
  it('should map every DOC_ERROR_CODE to a valid HTTP status', () => {
    const validStatuses = new Set([200, 201, 400, 403, 404, 413, 500]);

    fc.assert(
      fc.property(docErrorCodeArb, (code) => {
        const status = getHttpStatusForDocError(code);
        expect(validStatuses.has(status)).toBe(true);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 12.4**
   *
   * For any error, the requestId SHALL always be present in the response.
   * When x-request-id header is provided, it SHALL be echoed back.
   * When absent, a valid UUID v4 SHALL be generated.
   */
  it('should always include a requestId in the response', () => {
    fc.assert(
      fc.property(
        docErrorCodeArb,
        errorMessageArb,
        optionalRequestIdArb,
        (code, message, requestId) => {
          const err = new DocumentError(code, message);
          const headers: Record<string, string> = {};
          if (requestId !== undefined) {
            headers['x-request-id'] = requestId;
          }
          const req = makeRequest(headers);
          const res = makeResponse();

          documentErrorMiddleware(err, req, res, noopNext);

          const body = res._body as { requestId: string };

          // requestId is always a non-empty string
          expect(typeof body.requestId).toBe('string');
          expect(body.requestId.length).toBeGreaterThan(0);

          if (requestId !== undefined) {
            // Echoed from header
            expect(body.requestId).toBe(requestId);
          } else {
            // Generated UUID v4
            expect(body.requestId).toMatch(UUID_V4_REGEX);
          }
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });
});
