/**
 * Unit tests for documentErrorMiddleware.
 *
 * Validates consistent error response formatting, HTTP status mapping,
 * requestId propagation, and handling of both DocumentError and unknown errors.
 *
 * @module document-processing/errorMiddleware.test
 */

import type { Request, Response, NextFunction } from 'express';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DocumentError } from './documentService.js';
import { documentErrorMiddleware } from './errorMiddleware.js';
import { DOC_ERROR_CODES } from './types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function makeResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

const noopNext: NextFunction = vi.fn();

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('documentErrorMiddleware', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should format a DocumentError with the correct HTTP status and code', () => {
    const err = new DocumentError(DOC_ERROR_CODES.NOT_FOUND, 'Document not found');
    const req = makeRequest({ 'x-request-id': 'req-123' });
    const res = makeResponse();

    documentErrorMiddleware(err, req, res, noopNext);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'DOC_NOT_FOUND', message: 'Document not found' },
      requestId: 'req-123',
    });
  });

  it('should map DOC_FORBIDDEN to 403', () => {
    const err = new DocumentError(DOC_ERROR_CODES.FORBIDDEN, 'Forbidden');
    const req = makeRequest({ 'x-request-id': 'req-456' });
    const res = makeResponse();

    documentErrorMiddleware(err, req, res, noopNext);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: { code: 'DOC_FORBIDDEN', message: 'Forbidden' },
      }),
    );
  });

  it('should map DOC_FILE_TOO_LARGE to 413', () => {
    const err = new DocumentError(DOC_ERROR_CODES.FILE_TOO_LARGE, 'File too large');
    const req = makeRequest({ 'x-request-id': 'req-789' });
    const res = makeResponse();

    documentErrorMiddleware(err, req, res, noopNext);

    expect(res.status).toHaveBeenCalledWith(413);
  });

  it('should map VALIDATION_ERROR to 400', () => {
    const err = new DocumentError(DOC_ERROR_CODES.VALIDATION_ERROR, 'Bad input');
    const req = makeRequest({ 'x-request-id': 'req-val' });
    const res = makeResponse();

    documentErrorMiddleware(err, req, res, noopNext);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return INTERNAL_ERROR with 500 for unknown errors', () => {
    const err = new Error('something broke');
    const req = makeRequest({ 'x-request-id': 'req-unknown' });
    const res = makeResponse();

    documentErrorMiddleware(err, req, res, noopNext);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      requestId: 'req-unknown',
    });
  });

  it('should return INTERNAL_ERROR with 500 for non-Error values', () => {
    const req = makeRequest({ 'x-request-id': 'req-str' });
    const res = makeResponse();

    documentErrorMiddleware('string error', req, res, noopNext);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      requestId: 'req-str',
    });
  });

  it('should generate a UUID requestId when x-request-id header is missing', () => {
    const err = new DocumentError(DOC_ERROR_CODES.NOT_FOUND, 'Not found');
    const req = makeRequest();
    const res = makeResponse();

    documentErrorMiddleware(err, req, res, noopNext);

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      requestId: string;
    };
    // UUID v4 format: 8-4-4-4-12 hex chars
    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('should use the x-request-id header when present', () => {
    const err = new DocumentError(DOC_ERROR_CODES.UPLOAD_FAILED, 'Upload failed');
    const req = makeRequest({ 'x-request-id': 'custom-id-42' });
    const res = makeResponse();

    documentErrorMiddleware(err, req, res, noopNext);

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      requestId: string;
    };
    expect(body.requestId).toBe('custom-id-42');
  });

  it('should always include success: false in the response', () => {
    const err = new DocumentError(DOC_ERROR_CODES.INVALID_FILE_TYPE, 'Bad type');
    const req = makeRequest({ 'x-request-id': 'req-success' });
    const res = makeResponse();

    documentErrorMiddleware(err, req, res, noopNext);

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      success: boolean;
    };
    expect(body.success).toBe(false);
  });
});
