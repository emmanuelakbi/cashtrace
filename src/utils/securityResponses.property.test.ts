/**
 * Property-based tests for error message uniformity.
 *
 * **Property 20: Error Message Uniformity for Security**
 * For any failed authentication attempt (whether due to wrong password or
 * non-existent email), the error response SHALL be identical to prevent
 * email enumeration attacks.
 *
 * **Validates: Requirements 2.4, 5.6**
 *
 * Tag: Feature: core-auth, Property 20: Error Message Uniformity for Security
 *
 * @module utils/securityResponses.property.test
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  buildLoginFailureResponse,
  buildPasswordResetRequestResponse,
  LOGIN_FAILURE_MESSAGE,
  PASSWORD_RESET_REQUEST_MESSAGE,
} from './securityResponses.js';
import { uuidArb } from '../test/arbitraries.js';

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 20: Error Message Uniformity for Security', () => {
  /**
   * **Validates: Requirements 2.4**
   *
   * For any two failed login attempts (regardless of the underlying reason),
   * buildLoginFailureResponse SHALL produce structurally identical responses
   * (same error code, same message, same shape) so an attacker cannot
   * distinguish wrong-password from non-existent-email.
   */
  it('login failure responses are identical regardless of request ID', () => {
    fc.assert(
      fc.property(
        fc.option(uuidArb, { nil: undefined }),
        fc.option(uuidArb, { nil: undefined }),
        (requestIdA, requestIdB) => {
          const responseA = buildLoginFailureResponse(requestIdA);
          const responseB = buildLoginFailureResponse(requestIdB);

          // Both must share the exact same error code
          expect(responseA.error.code).toBe(responseB.error.code);

          // Both must share the exact same error message
          expect(responseA.error.message).toBe(responseB.error.message);

          // Both must have success=false
          expect(responseA.success).toBe(false);
          expect(responseB.success).toBe(false);

          // Neither should include field-specific errors that could leak info
          expect(responseA.error.fields).toBeUndefined();
          expect(responseB.error.fields).toBeUndefined();
        },
      ),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 2.4**
   *
   * For any failed login attempt, the error message SHALL always be the
   * constant LOGIN_FAILURE_MESSAGE and the error code SHALL always be
   * AUTH_INVALID_CREDENTIALS, ensuring uniformity.
   */
  it('login failure response always uses the constant message and code', () => {
    fc.assert(
      fc.property(fc.option(uuidArb, { nil: undefined }), (requestId) => {
        const response = buildLoginFailureResponse(requestId);

        expect(response.success).toBe(false);
        expect(response.error.code).toBe('AUTH_INVALID_CREDENTIALS');
        expect(response.error.message).toBe(LOGIN_FAILURE_MESSAGE);
        expect(typeof response.requestId).toBe('string');
        expect(response.requestId.length).toBeGreaterThan(0);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 5.6**
   *
   * For any password reset request (whether the email exists or not),
   * buildPasswordResetRequestResponse SHALL produce an identical response,
   * preventing email enumeration via the reset flow.
   */
  it('password reset responses are always identical', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), (_iteration) => {
        const responseA = buildPasswordResetRequestResponse();
        const responseB = buildPasswordResetRequestResponse();

        // Responses must be structurally identical
        expect(responseA).toEqual(responseB);

        // Must be a success response with the constant message
        expect(responseA.success).toBe(true);
        expect(responseA.message).toBe(PASSWORD_RESET_REQUEST_MESSAGE);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 2.4, 5.6**
   *
   * The login failure response SHALL never contain information that could
   * distinguish between a wrong-password scenario and a non-existent-email
   * scenario. Specifically, the error message must not reference "email",
   * "not found", "does not exist", or "password" individually.
   */
  it('login failure message does not leak whether email exists or password is wrong', () => {
    fc.assert(
      fc.property(fc.option(uuidArb, { nil: undefined }), (requestId) => {
        const response = buildLoginFailureResponse(requestId);
        const message = response.error.message.toLowerCase();

        // Must not specifically say the email doesn't exist
        expect(message).not.toContain('not found');
        expect(message).not.toContain('does not exist');
        expect(message).not.toContain('no account');
        expect(message).not.toContain('unknown email');

        // Must not specifically say the password is wrong
        expect(message).not.toContain('wrong password');
        expect(message).not.toContain('invalid password');
        expect(message).not.toContain('incorrect password');
      }),
      { numRuns: 100, verbose: true },
    );
  });
});
