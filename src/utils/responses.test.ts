/**
 * Unit tests for API response formatters.
 *
 * Validates consistent JSON response structure for success and error cases,
 * error codes with field-specific details, HTTP status mapping, and
 * request correlation IDs.
 *
 * @see Requirements 9.1, 9.2, 9.3, 9.4
 */

import { describe, it, expect } from 'vitest';
import {
  generateRequestId,
  formatAuthResponse,
  formatGenericResponse,
  formatErrorResponse,
  getHttpStatusForError,
  formatValidationError,
  formatInternalError,
} from './responses.js';
import type { UserPublic } from '../types/index.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const sampleUser: UserPublic = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'user@example.com',
  emailVerified: true,
};

// ─── generateRequestId ──────────────────────────────────────────────────────

describe('generateRequestId', () => {
  it('should return a valid UUID v4 string', () => {
    const id = generateRequestId();
    expect(id).toMatch(UUID_REGEX);
  });

  it('should return unique IDs on successive calls', () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    expect(id1).not.toBe(id2);
  });
});

// ─── formatAuthResponse ─────────────────────────────────────────────────────

describe('formatAuthResponse', () => {
  it('should return success: true', () => {
    const result = formatAuthResponse(sampleUser, new Date());
    expect(result.success).toBe(true);
  });

  it('should include the user object', () => {
    const result = formatAuthResponse(sampleUser, new Date());
    expect(result.user).toEqual(sampleUser);
  });

  it('should include the expiresAt date', () => {
    const expires = new Date('2025-01-01T00:00:00Z');
    const result = formatAuthResponse(sampleUser, expires);
    expect(result.expiresAt).toBe(expires);
  });

  it('should not include error or requestId fields', () => {
    const result = formatAuthResponse(sampleUser, new Date());
    expect(result).not.toHaveProperty('error');
    expect(result).not.toHaveProperty('requestId');
  });
});

// ─── formatGenericResponse ──────────────────────────────────────────────────

describe('formatGenericResponse', () => {
  it('should return success: true', () => {
    const result = formatGenericResponse('Operation completed');
    expect(result.success).toBe(true);
  });

  it('should include the message', () => {
    const result = formatGenericResponse('Magic link sent');
    expect(result.message).toBe('Magic link sent');
  });

  it('should not include error or requestId fields', () => {
    const result = formatGenericResponse('ok');
    expect(result).not.toHaveProperty('error');
    expect(result).not.toHaveProperty('requestId');
  });
});

// ─── formatErrorResponse ────────────────────────────────────────────────────

describe('formatErrorResponse', () => {
  it('should return success: false', () => {
    const result = formatErrorResponse('AUTH_INVALID_CREDENTIALS', 'Invalid credentials');
    expect(result.success).toBe(false);
  });

  it('should include the error code', () => {
    const result = formatErrorResponse('AUTH_INVALID_EMAIL', 'Invalid email format');
    expect(result.error.code).toBe('AUTH_INVALID_EMAIL');
  });

  it('should include the error message', () => {
    const result = formatErrorResponse('AUTH_WEAK_PASSWORD', 'Password too weak');
    expect(result.error.message).toBe('Password too weak');
  });

  it('should auto-generate a requestId when not provided', () => {
    const result = formatErrorResponse('INTERNAL_ERROR', 'Something went wrong');
    expect(result.requestId).toMatch(UUID_REGEX);
  });

  it('should use the provided requestId when given', () => {
    const reqId = 'custom-request-id-123';
    const result = formatErrorResponse('AUTH_RATE_LIMITED', 'Too many attempts', reqId);
    expect(result.requestId).toBe(reqId);
  });

  it('should not include fields when not provided', () => {
    const result = formatErrorResponse('AUTH_TOKEN_EXPIRED', 'Token expired');
    expect(result.error.fields).toBeUndefined();
  });

  it('should include fields when provided', () => {
    const fields = { email: ['Invalid format'], password: ['Too short'] };
    const result = formatErrorResponse(
      'AUTH_INVALID_EMAIL',
      'Validation failed',
      undefined,
      fields,
    );
    expect(result.error.fields).toEqual(fields);
  });

  it('should omit fields when provided as empty object', () => {
    const result = formatErrorResponse('AUTH_INVALID_EMAIL', 'Validation failed', undefined, {});
    expect(result.error.fields).toBeUndefined();
  });
});

// ─── getHttpStatusForError ──────────────────────────────────────────────────

describe('getHttpStatusForError', () => {
  it('should return 401 for AUTH_INVALID_CREDENTIALS', () => {
    expect(getHttpStatusForError('AUTH_INVALID_CREDENTIALS')).toBe(401);
  });

  it('should return 400 for AUTH_EMAIL_EXISTS', () => {
    expect(getHttpStatusForError('AUTH_EMAIL_EXISTS')).toBe(400);
  });

  it('should return 400 for AUTH_INVALID_EMAIL', () => {
    expect(getHttpStatusForError('AUTH_INVALID_EMAIL')).toBe(400);
  });

  it('should return 400 for AUTH_WEAK_PASSWORD', () => {
    expect(getHttpStatusForError('AUTH_WEAK_PASSWORD')).toBe(400);
  });

  it('should return 401 for AUTH_TOKEN_EXPIRED', () => {
    expect(getHttpStatusForError('AUTH_TOKEN_EXPIRED')).toBe(401);
  });

  it('should return 401 for AUTH_TOKEN_INVALID', () => {
    expect(getHttpStatusForError('AUTH_TOKEN_INVALID')).toBe(401);
  });

  it('should return 401 for AUTH_TOKEN_USED', () => {
    expect(getHttpStatusForError('AUTH_TOKEN_USED')).toBe(401);
  });

  it('should return 429 for AUTH_RATE_LIMITED', () => {
    expect(getHttpStatusForError('AUTH_RATE_LIMITED')).toBe(429);
  });

  it('should return 403 for AUTH_CSRF_INVALID', () => {
    expect(getHttpStatusForError('AUTH_CSRF_INVALID')).toBe(403);
  });

  it('should return 400 for AUTH_CONSENT_REQUIRED', () => {
    expect(getHttpStatusForError('AUTH_CONSENT_REQUIRED')).toBe(400);
  });

  it('should return 401 for AUTH_SESSION_INVALID', () => {
    expect(getHttpStatusForError('AUTH_SESSION_INVALID')).toBe(401);
  });

  it('should return 401 for AUTH_DEVICE_MISMATCH', () => {
    expect(getHttpStatusForError('AUTH_DEVICE_MISMATCH')).toBe(401);
  });

  it('should return 503 for EMAIL_SERVICE_ERROR', () => {
    expect(getHttpStatusForError('EMAIL_SERVICE_ERROR')).toBe(503);
  });

  it('should return 500 for INTERNAL_ERROR', () => {
    expect(getHttpStatusForError('INTERNAL_ERROR')).toBe(500);
  });

  it('should return 500 for unknown error codes', () => {
    expect(getHttpStatusForError('UNKNOWN_CODE')).toBe(500);
  });
});

// ─── formatValidationError ──────────────────────────────────────────────────

describe('formatValidationError', () => {
  it('should return success: false', () => {
    const result = formatValidationError('AUTH_INVALID_EMAIL', 'Validation failed', {
      email: ['Invalid'],
    });
    expect(result.success).toBe(false);
  });

  it('should include field-specific errors', () => {
    const fields = { email: ['Invalid format'], password: ['Too short', 'Must contain a number'] };
    const result = formatValidationError('AUTH_WEAK_PASSWORD', 'Validation failed', fields);
    expect(result.error.fields).toEqual(fields);
  });

  it('should include a requestId', () => {
    const result = formatValidationError('AUTH_INVALID_EMAIL', 'Bad input', { email: ['Invalid'] });
    expect(result.requestId).toMatch(UUID_REGEX);
  });

  it('should use provided requestId', () => {
    const result = formatValidationError(
      'AUTH_INVALID_EMAIL',
      'Bad input',
      { email: ['Invalid'] },
      'req-456',
    );
    expect(result.requestId).toBe('req-456');
  });
});

// ─── formatInternalError ────────────────────────────────────────────────────

describe('formatInternalError', () => {
  it('should return success: false', () => {
    const result = formatInternalError();
    expect(result.success).toBe(false);
  });

  it('should use INTERNAL_ERROR code', () => {
    const result = formatInternalError();
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('should use a generic message that does not leak details', () => {
    const result = formatInternalError();
    expect(result.error.message).toContain('unexpected error');
  });

  it('should auto-generate a requestId', () => {
    const result = formatInternalError();
    expect(result.requestId).toMatch(UUID_REGEX);
  });

  it('should use provided requestId', () => {
    const result = formatInternalError('req-789');
    expect(result.requestId).toBe('req-789');
  });

  it('should not include field errors', () => {
    const result = formatInternalError();
    expect(result.error.fields).toBeUndefined();
  });
});
