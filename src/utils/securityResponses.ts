/**
 * Uniform security response helpers.
 *
 * These functions return identical responses regardless of the underlying
 * failure reason (wrong password vs non-existent email, existing vs
 * non-existent email for password reset). This prevents email enumeration
 * attacks by ensuring an attacker cannot distinguish between the two cases.
 *
 * @module utils/securityResponses
 * @see Requirements 2.4, 5.6
 */

import { AUTH_ERROR_CODES } from '../types/index.js';
import type { ErrorResponse, GenericResponse } from '../types/index.js';
import { formatErrorResponse, formatGenericResponse } from './responses.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * The single error message returned for any failed login attempt.
 * Intentionally vague to avoid revealing whether the email exists.
 */
export const LOGIN_FAILURE_MESSAGE = 'The email or password you entered is incorrect.';

/**
 * The single success message returned for any password reset request.
 * Returned for both existing and non-existent emails.
 */
export const PASSWORD_RESET_REQUEST_MESSAGE =
  'If an account with that email exists, a password reset link has been sent.';

// ─── Response Builders ───────────────────────────────────────────────────────

/**
 * Build the uniform error response for a failed login attempt.
 *
 * Returns the exact same ErrorResponse structure whether the failure was
 * caused by a wrong password or a non-existent email address.
 *
 * @param requestId - Optional correlation ID; auto-generated when omitted
 * @returns An ErrorResponse with AUTH_INVALID_CREDENTIALS code
 *
 * @see Requirement 2.4
 */
export function buildLoginFailureResponse(requestId?: string): ErrorResponse {
  return formatErrorResponse(
    AUTH_ERROR_CODES.INVALID_CREDENTIALS,
    LOGIN_FAILURE_MESSAGE,
    requestId,
  );
}

/**
 * Build the uniform success response for a password reset request.
 *
 * Returns the exact same GenericResponse whether the email belongs to an
 * existing account or not, preventing email enumeration.
 *
 * @returns A GenericResponse with a generic confirmation message
 *
 * @see Requirement 5.6
 */
export function buildPasswordResetRequestResponse(): GenericResponse {
  return formatGenericResponse(PASSWORD_RESET_REQUEST_MESSAGE);
}
