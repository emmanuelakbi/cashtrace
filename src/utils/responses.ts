/**
 * API response formatters for consistent JSON response structure.
 *
 * All API responses follow a predictable format:
 * - Success responses include `success: true` and the relevant data
 * - Error responses include `success: false`, an error object with code/message/fields,
 *   and a request correlation ID for debugging
 *
 * @module utils/responses
 * @see Requirements 9.1, 9.2, 9.3, 9.4
 */

import { v4 as uuidv4 } from 'uuid';
import type { AuthResponse, GenericResponse, ErrorResponse, UserPublic } from '../types/index.js';

// ─── Error Code to HTTP Status Mapping ───────────────────────────────────────

/**
 * Maps auth error codes to their corresponding HTTP status codes.
 * Derived from the design document error codes table.
 */
const ERROR_STATUS_MAP: Record<string, number> = {
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_EMAIL_EXISTS: 400,
  AUTH_INVALID_EMAIL: 400,
  AUTH_WEAK_PASSWORD: 400,
  AUTH_TOKEN_EXPIRED: 401,
  AUTH_TOKEN_INVALID: 401,
  AUTH_TOKEN_USED: 401,
  AUTH_RATE_LIMITED: 429,
  AUTH_CSRF_INVALID: 403,
  AUTH_CONSENT_REQUIRED: 400,
  AUTH_SESSION_INVALID: 401,
  AUTH_DEVICE_MISMATCH: 401,
  EMAIL_SERVICE_ERROR: 503,
  INTERNAL_ERROR: 500,
};

/** Default HTTP status for unknown error codes. */
const DEFAULT_ERROR_STATUS = 500;

// ─── Correlation ID ──────────────────────────────────────────────────────────

/**
 * Generate a unique request correlation ID (UUID v4).
 * Used to trace requests across logs and error responses.
 */
export function generateRequestId(): string {
  return uuidv4();
}

// ─── Success Formatters ──────────────────────────────────────────────────────

/**
 * Format a successful authentication response.
 *
 * @param user - The public user data to include
 * @param expiresAt - When the session/token expires
 * @returns A structured AuthResponse
 */
export function formatAuthResponse(user: UserPublic, expiresAt: Date): AuthResponse {
  return {
    success: true,
    user,
    expiresAt,
  };
}

/**
 * Format a generic success response with a message.
 *
 * @param message - A human-readable success message
 * @returns A structured GenericResponse
 */
export function formatGenericResponse(message: string): GenericResponse {
  return {
    success: true,
    message,
  };
}

// ─── Error Formatters ────────────────────────────────────────────────────────

/**
 * Format an error response with error code, message, optional field errors,
 * and a correlation ID for debugging.
 *
 * @param code - Machine-readable error code (e.g. AUTH_INVALID_CREDENTIALS)
 * @param message - Human-readable error description
 * @param requestId - Correlation ID; auto-generated if not provided
 * @param fields - Optional field-specific validation errors
 * @returns A structured ErrorResponse
 */
export function formatErrorResponse(
  code: string,
  message: string,
  requestId?: string,
  fields?: Record<string, string[]>,
): ErrorResponse {
  const response: ErrorResponse = {
    success: false,
    error: {
      code,
      message,
    },
    requestId: requestId ?? generateRequestId(),
  };

  if (fields && Object.keys(fields).length > 0) {
    response.error.fields = fields;
  }

  return response;
}

/**
 * Get the HTTP status code for a given auth error code.
 *
 * @param code - The error code to look up
 * @returns The corresponding HTTP status code, or 500 for unknown codes
 */
export function getHttpStatusForError(code: string): number {
  return ERROR_STATUS_MAP[code] ?? DEFAULT_ERROR_STATUS;
}

/**
 * Format a validation error response with field-specific details.
 * Convenience wrapper around formatErrorResponse for validation failures.
 *
 * @param code - The validation error code
 * @param message - Human-readable error description
 * @param fields - Field-specific validation errors
 * @param requestId - Correlation ID; auto-generated if not provided
 * @returns A structured ErrorResponse with field details
 */
export function formatValidationError(
  code: string,
  message: string,
  fields: Record<string, string[]>,
  requestId?: string,
): ErrorResponse {
  return formatErrorResponse(code, message, requestId, fields);
}

/**
 * Format an internal server error response.
 * Uses a generic message to avoid leaking implementation details.
 *
 * @param requestId - Correlation ID; auto-generated if not provided
 * @returns A structured ErrorResponse for internal errors
 */
export function formatInternalError(requestId?: string): ErrorResponse {
  return formatErrorResponse(
    'INTERNAL_ERROR',
    'An unexpected error occurred. Please try again later.',
    requestId,
  );
}
