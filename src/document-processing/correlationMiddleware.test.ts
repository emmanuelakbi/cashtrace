/**
 * Unit tests for correlationMiddleware.
 *
 * Validates that the middleware reads, generates, attaches, and propagates
 * request correlation IDs correctly.
 *
 * Requirements: 12.4
 * @module document-processing/correlationMiddleware.test
 */

import type { Response, NextFunction } from 'express';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { CorrelatedRequest } from './correlationMiddleware.js';
import { correlationMiddleware } from './correlationMiddleware.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeRequest(headers: Record<string, string> = {}): CorrelatedRequest {
  return { headers } as unknown as CorrelatedRequest;
}

function makeResponse(): Response & { _headers: Record<string, string> } {
  const _headers: Record<string, string> = {};
  const res = {
    _headers,
    setHeader: vi.fn((name: string, value: string) => {
      _headers[name] = value;
      return res;
    }),
  };
  return res as unknown as Response & { _headers: Record<string, string> };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('correlationMiddleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    vi.restoreAllMocks();
    next = vi.fn();
  });

  it('should use the x-request-id header when present', () => {
    const req = makeRequest({ 'x-request-id': 'incoming-id-123' });
    const res = makeResponse();

    correlationMiddleware(req, res, next);

    expect(req.requestId).toBe('incoming-id-123');
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'incoming-id-123');
    expect(next).toHaveBeenCalledOnce();
  });

  it('should generate a UUID v4 when x-request-id header is missing', () => {
    const req = makeRequest();
    const res = makeResponse();

    correlationMiddleware(req, res, next);

    expect(req.requestId).toBeDefined();
    expect(req.requestId).toMatch(UUID_V4_RE);
    expect(next).toHaveBeenCalledOnce();
  });

  it('should set the x-request-id response header with the generated UUID', () => {
    const req = makeRequest();
    const res = makeResponse();

    correlationMiddleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', req.requestId);
  });

  it('should set the x-request-id response header with the incoming value', () => {
    const req = makeRequest({ 'x-request-id': 'custom-abc' });
    const res = makeResponse();

    correlationMiddleware(req, res, next);

    expect(res._headers['x-request-id']).toBe('custom-abc');
  });

  it('should always call next()', () => {
    const req = makeRequest();
    const res = makeResponse();

    correlationMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('should generate unique IDs for consecutive requests without headers', () => {
    const req1 = makeRequest();
    const res1 = makeResponse();
    const req2 = makeRequest();
    const res2 = makeResponse();

    correlationMiddleware(req1, res1, next);
    correlationMiddleware(req2, res2, next);

    expect(req1.requestId).not.toBe(req2.requestId);
  });
});
