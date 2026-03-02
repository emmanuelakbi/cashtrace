/**
 * Unit tests for transaction-engine error handling middleware.
 *
 * Requirements: 12.2, 12.3, 12.4
 * @module transaction-engine/errorMiddleware.test
 */

import type { Request, Response, NextFunction } from 'express';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getHttpStatusForError, transactionErrorMiddleware } from './errorMiddleware.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMockReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function makeMockRes(): Response & { statusCode: number; body: unknown } {
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('getHttpStatusForError', () => {
  it('maps known error codes to correct HTTP status', () => {
    expect(getHttpStatusForError('AUTH_REQUIRED')).toBe(401);
    expect(getHttpStatusForError('FORBIDDEN')).toBe(403);
    expect(getHttpStatusForError('TRANSACTION_NOT_FOUND')).toBe(404);
    expect(getHttpStatusForError('VALIDATION_ERROR')).toBe(400);
    expect(getHttpStatusForError('TXN_FORBIDDEN')).toBe(403);
    expect(getHttpStatusForError('TXN_NOT_FOUND')).toBe(404);
    expect(getHttpStatusForError('TXN_INVALID_CATEGORY')).toBe(400);
    expect(getHttpStatusForError('TXN_BULK_VALIDATION')).toBe(400);
    expect(getHttpStatusForError('DUPLICATE_PAIR_NOT_FOUND')).toBe(404);
  });

  it('returns 500 for unknown error codes', () => {
    expect(getHttpStatusForError('UNKNOWN_CODE')).toBe(500);
    expect(getHttpStatusForError('')).toBe(500);
  });
});

describe('transactionErrorMiddleware', () => {
  const next: NextFunction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats errors with code property into consistent error response', () => {
    const error = Object.assign(new Error('Transaction not found'), {
      code: 'TRANSACTION_NOT_FOUND',
    });
    const req = makeMockReq({ 'x-request-id': 'req-123' });
    const res = makeMockRes();

    transactionErrorMiddleware(error, req, res, next);

    expect(res.statusCode).toBe(404);
    const body = res.body as Record<string, unknown>;
    expect(body['success']).toBe(false);
    expect(body['requestId']).toBe('req-123');
    const errObj = body['error'] as Record<string, unknown>;
    expect(errObj['code']).toBe('TRANSACTION_NOT_FOUND');
    expect(errObj['message']).toBe('Transaction not found');
  });

  it('formats forbidden errors correctly', () => {
    const error = Object.assign(new Error('Forbidden'), { code: 'TXN_FORBIDDEN' });
    const req = makeMockReq({ 'x-request-id': 'req-456' });
    const res = makeMockRes();

    transactionErrorMiddleware(error, req, res, next);

    expect(res.statusCode).toBe(403);
    const body = res.body as Record<string, unknown>;
    expect(body['success']).toBe(false);
    expect(body['requestId']).toBe('req-456');
  });

  it('generates requestId when x-request-id header is missing', () => {
    const error = Object.assign(new Error('Not found'), { code: 'TXN_NOT_FOUND' });
    const req = makeMockReq();
    const res = makeMockRes();

    transactionErrorMiddleware(error, req, res, next);

    expect(res.statusCode).toBe(404);
    const body = res.body as Record<string, unknown>;
    expect(typeof body['requestId']).toBe('string');
    expect((body['requestId'] as string).length).toBeGreaterThan(0);
  });

  it('returns 500 for errors without code property', () => {
    const error = new Error('Something went wrong');
    const req = makeMockReq({ 'x-request-id': 'req-789' });
    const res = makeMockRes();

    transactionErrorMiddleware(error, req, res, next);

    expect(res.statusCode).toBe(500);
    const body = res.body as Record<string, unknown>;
    expect(body['success']).toBe(false);
    expect(body['requestId']).toBe('req-789');
    const errObj = body['error'] as Record<string, unknown>;
    expect(errObj['code']).toBe('INTERNAL_ERROR');
    expect(errObj['message']).toBe('Internal server error');
  });

  it('returns 500 for non-Error objects', () => {
    const error = 'string error';
    const req = makeMockReq({ 'x-request-id': 'req-abc' });
    const res = makeMockRes();

    transactionErrorMiddleware(error, req, res, next);

    expect(res.statusCode).toBe(500);
    const body = res.body as Record<string, unknown>;
    expect(body['success']).toBe(false);
    const errObj = body['error'] as Record<string, unknown>;
    expect(errObj['code']).toBe('INTERNAL_ERROR');
  });

  it('returns 500 for unknown error codes', () => {
    const error = Object.assign(new Error('Weird error'), { code: 'UNKNOWN_CODE' });
    const req = makeMockReq();
    const res = makeMockRes();

    transactionErrorMiddleware(error, req, res, next);

    expect(res.statusCode).toBe(500);
    const body = res.body as Record<string, unknown>;
    const errObj = body['error'] as Record<string, unknown>;
    expect(errObj['code']).toBe('UNKNOWN_CODE');
    expect(errObj['message']).toBe('Weird error');
  });
});
