/**
 * Property-based tests for API response consistency.
 *
 * **Property 19: API Response Consistency**
 * For any API response, it SHALL be valid JSON containing either a success
 * response with the expected data structure OR an error response with error
 * code, message, and request correlation ID.
 *
 * **Validates: Requirements 1.6, 9.1, 9.2, 9.4**
 *
 * Tag: Feature: core-auth, Property 19: API Response Consistency
 *
 * @module utils/responses.property.test
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  formatAuthResponse,
  formatGenericResponse,
  formatErrorResponse,
  formatValidationError,
  formatInternalError,
  getHttpStatusForError,
  generateRequestId,
} from './responses.js';
import { uuidArb, validEmailArb } from '../test/arbitraries.js';
import type { UserPublic, AuthResponse, GenericResponse, ErrorResponse } from '../types/index.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Arbitrary for UserPublic objects. */
const userPublicArb: fc.Arbitrary<UserPublic> = fc.record({
  id: uuidArb,
  email: validEmailArb,
  emailVerified: fc.boolean(),
});

/** Arbitrary for future Date values (used as token/session expiry). */
const futureDateArb: fc.Arbitrary<Date> = fc
  .integer({ min: Date.now(), max: Date.now() + 30 * 24 * 60 * 60 * 1000 })
  .map((ms) => new Date(ms));

/** Arbitrary for non-empty strings (used for error codes and messages). */
const nonEmptyStringArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 200 });

/** Arbitrary for known auth error codes from the design doc. */
const errorCodeArb: fc.Arbitrary<string> = fc.constantFrom(
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_EMAIL_EXISTS',
  'AUTH_INVALID_EMAIL',
  'AUTH_WEAK_PASSWORD',
  'AUTH_TOKEN_EXPIRED',
  'AUTH_TOKEN_INVALID',
  'AUTH_TOKEN_USED',
  'AUTH_RATE_LIMITED',
  'AUTH_CSRF_INVALID',
  'AUTH_CONSENT_REQUIRED',
  'AUTH_SESSION_INVALID',
  'AUTH_DEVICE_MISMATCH',
  'EMAIL_SERVICE_ERROR',
  'INTERNAL_ERROR',
);

/** Arbitrary for field validation errors. */
const fieldsArb: fc.Arbitrary<Record<string, string[]>> = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 30 }),
  fc.array(fc.string({ minLength: 1, maxLength: 100 }), { minLength: 1, maxLength: 3 }),
  { minKeys: 1, maxKeys: 5 },
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** UUID v4 pattern. */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidSuccessResponse(obj: unknown): obj is AuthResponse | GenericResponse {
  if (typeof obj !== 'object' || obj === null) return false;
  const r = obj as Record<string, unknown>;
  if (r.success !== true) return false;
  // AuthResponse shape
  if ('user' in r && 'expiresAt' in r) {
    const user = r.user as Record<string, unknown>;
    return (
      typeof user.id === 'string' &&
      typeof user.email === 'string' &&
      typeof user.emailVerified === 'boolean' &&
      r.expiresAt instanceof Date
    );
  }
  // GenericResponse shape
  if ('message' in r) {
    return typeof r.message === 'string';
  }
  return false;
}

function isValidErrorResponse(obj: unknown): obj is ErrorResponse {
  if (typeof obj !== 'object' || obj === null) return false;
  const r = obj as Record<string, unknown>;
  if (r.success !== false) return false;
  if (typeof r.requestId !== 'string') return false;
  const error = r.error as Record<string, unknown> | undefined;
  if (typeof error !== 'object' || error === null) return false;
  return typeof error.code === 'string' && typeof error.message === 'string';
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 19: API Response Consistency', () => {
  /**
   * **Validates: Requirements 9.1**
   *
   * For any valid user and expiry date, formatAuthResponse SHALL produce
   * a success response with success=true, user data, and expiresAt.
   */
  it('formatAuthResponse always produces a valid success response with user data', () => {
    fc.assert(
      fc.property(userPublicArb, futureDateArb, (user, expiresAt) => {
        const response = formatAuthResponse(user, expiresAt);

        // Must be valid JSON (serializable)
        const json = JSON.stringify(response);
        expect(json).toBeTruthy();
        const parsed = JSON.parse(json);
        expect(parsed).toBeDefined();

        // Must be a valid success response
        expect(response.success).toBe(true);
        expect(response.user).toEqual(user);
        expect(response.expiresAt).toEqual(expiresAt);
        expect(isValidSuccessResponse(response)).toBe(true);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 9.1**
   *
   * For any message string, formatGenericResponse SHALL produce a success
   * response with success=true and the message.
   */
  it('formatGenericResponse always produces a valid success response with message', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (message) => {
        const response = formatGenericResponse(message);

        const json = JSON.stringify(response);
        expect(json).toBeTruthy();
        const parsed = JSON.parse(json);
        expect(parsed).toBeDefined();

        expect(response.success).toBe(true);
        expect(response.message).toBe(message);
        expect(isValidSuccessResponse(response)).toBe(true);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 1.6, 9.1, 9.2, 9.4**
   *
   * For any error code and message, formatErrorResponse SHALL produce an
   * error response with success=false, error.code, error.message, and a
   * request correlation ID (UUID v4).
   */
  it('formatErrorResponse always produces a valid error response with correlation ID', () => {
    fc.assert(
      fc.property(errorCodeArb, nonEmptyStringArb, (code, message) => {
        const response = formatErrorResponse(code, message);

        const json = JSON.stringify(response);
        expect(json).toBeTruthy();
        const parsed = JSON.parse(json);
        expect(parsed).toBeDefined();

        expect(response.success).toBe(false);
        expect(response.error.code).toBe(code);
        expect(response.error.message).toBe(message);
        expect(typeof response.requestId).toBe('string');
        expect(response.requestId).toMatch(UUID_V4_REGEX);
        expect(isValidErrorResponse(response)).toBe(true);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 9.4**
   *
   * When a requestId is provided, formatErrorResponse SHALL use it as the
   * correlation ID instead of generating a new one.
   */
  it('formatErrorResponse preserves a provided request correlation ID', () => {
    fc.assert(
      fc.property(errorCodeArb, nonEmptyStringArb, uuidArb, (code, message, requestId) => {
        const response = formatErrorResponse(code, message, requestId);

        expect(response.requestId).toBe(requestId);
        expect(isValidErrorResponse(response)).toBe(true);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 1.6, 9.2**
   *
   * For any validation error with field details, formatValidationError SHALL
   * produce an error response that includes field-specific error arrays.
   */
  it('formatValidationError includes field-specific errors in the response', () => {
    fc.assert(
      fc.property(errorCodeArb, nonEmptyStringArb, fieldsArb, (code, message, fields) => {
        const response = formatValidationError(code, message, fields);

        const json = JSON.stringify(response);
        expect(json).toBeTruthy();

        expect(response.success).toBe(false);
        expect(response.error.code).toBe(code);
        expect(response.error.message).toBe(message);
        expect(response.error.fields).toBeDefined();
        expect(response.error.fields).toEqual(fields);
        expect(typeof response.requestId).toBe('string');
        expect(isValidErrorResponse(response)).toBe(true);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 9.1, 9.2, 9.4**
   *
   * formatInternalError SHALL always produce a valid error response with
   * code INTERNAL_ERROR, a generic message, and a correlation ID.
   */
  it('formatInternalError produces a consistent internal error response', () => {
    fc.assert(
      fc.property(fc.option(uuidArb, { nil: undefined }), (requestId) => {
        const response = formatInternalError(requestId);

        const json = JSON.stringify(response);
        expect(json).toBeTruthy();

        expect(response.success).toBe(false);
        expect(response.error.code).toBe('INTERNAL_ERROR');
        expect(typeof response.error.message).toBe('string');
        expect(response.error.message.length).toBeGreaterThan(0);
        expect(typeof response.requestId).toBe('string');

        if (requestId !== undefined) {
          // When provided, the correlation ID is preserved as-is
          expect(response.requestId).toBe(requestId);
        } else {
          // When auto-generated, it must be a valid UUID v4
          expect(response.requestId).toMatch(UUID_V4_REGEX);
        }

        expect(isValidErrorResponse(response)).toBe(true);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 9.3**
   *
   * For any known error code, getHttpStatusForError SHALL return a valid
   * HTTP status code (a number in the standard range).
   */
  it('getHttpStatusForError returns valid HTTP status codes for known error codes', () => {
    fc.assert(
      fc.property(errorCodeArb, (code) => {
        const status = getHttpStatusForError(code);

        expect(typeof status).toBe('number');
        expect(status).toBeGreaterThanOrEqual(400);
        expect(status).toBeLessThanOrEqual(599);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 9.4**
   *
   * generateRequestId SHALL always produce a valid UUID v4 string.
   */
  it('generateRequestId always produces a valid UUID v4', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const id = generateRequestId();

        expect(typeof id).toBe('string');
        expect(id).toMatch(UUID_V4_REGEX);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 9.1**
   *
   * Every API response (success or error) SHALL be serializable to valid JSON
   * and deserializable back without data loss on key structural fields.
   */
  it('all response types are JSON-serializable and maintain structural integrity', () => {
    const responseArb = fc.oneof(
      // AuthResponse
      fc.tuple(userPublicArb, futureDateArb).map(([user, exp]) => formatAuthResponse(user, exp)),
      // GenericResponse
      fc.string({ maxLength: 200 }).map((msg) => formatGenericResponse(msg)),
      // ErrorResponse
      fc
        .tuple(errorCodeArb, nonEmptyStringArb)
        .map(([code, msg]) => formatErrorResponse(code, msg)),
      // ErrorResponse with fields
      fc
        .tuple(errorCodeArb, nonEmptyStringArb, fieldsArb)
        .map(([code, msg, fields]) => formatValidationError(code, msg, fields)),
      // InternalError
      fc.constant(null).map(() => formatInternalError()),
    );

    fc.assert(
      fc.property(responseArb, (response) => {
        const json = JSON.stringify(response);
        expect(typeof json).toBe('string');
        expect(json.length).toBeGreaterThan(0);

        const parsed = JSON.parse(json);
        expect(typeof parsed.success).toBe('boolean');

        if (parsed.success === true) {
          // Success: must have either user+expiresAt or message
          const hasUserData = 'user' in parsed && 'expiresAt' in parsed;
          const hasMessage = 'message' in parsed;
          expect(hasUserData || hasMessage).toBe(true);
        } else {
          // Error: must have error.code, error.message, and requestId
          expect(typeof parsed.error).toBe('object');
          expect(typeof parsed.error.code).toBe('string');
          expect(typeof parsed.error.message).toBe('string');
          expect(typeof parsed.requestId).toBe('string');
        }
      }),
      { numRuns: 100, verbose: true },
    );
  });
});
