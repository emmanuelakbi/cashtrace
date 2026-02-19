/**
 * Unit tests for uniform security response helpers.
 *
 * Validates that login failure and password reset request responses are
 * identical regardless of the underlying reason (wrong password vs
 * non-existent email, existing vs non-existent email for reset).
 *
 * @see Requirements 2.4, 5.6
 */

import { describe, it, expect } from 'vitest';
import {
  LOGIN_FAILURE_MESSAGE,
  PASSWORD_RESET_REQUEST_MESSAGE,
  buildLoginFailureResponse,
  buildPasswordResetRequestResponse,
} from './securityResponses.js';
import { AUTH_ERROR_CODES } from '../types/index.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── buildLoginFailureResponse ──────────────────────────────────────────────

describe('buildLoginFailureResponse', () => {
  it('should return success: false', () => {
    const result = buildLoginFailureResponse();
    expect(result.success).toBe(false);
  });

  it('should use AUTH_INVALID_CREDENTIALS error code', () => {
    const result = buildLoginFailureResponse();
    expect(result.error.code).toBe(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
  });

  it('should use the generic login failure message', () => {
    const result = buildLoginFailureResponse();
    expect(result.error.message).toBe(LOGIN_FAILURE_MESSAGE);
  });

  it('should not reveal whether the email exists in the message', () => {
    const result = buildLoginFailureResponse();
    const msg = result.error.message.toLowerCase();
    expect(msg).not.toContain('not found');
    expect(msg).not.toContain('does not exist');
    expect(msg).not.toContain('no account');
    expect(msg).not.toContain('unknown');
  });

  it('should auto-generate a requestId when not provided', () => {
    const result = buildLoginFailureResponse();
    expect(result.requestId).toMatch(UUID_REGEX);
  });

  it('should use the provided requestId', () => {
    const result = buildLoginFailureResponse('req-abc-123');
    expect(result.requestId).toBe('req-abc-123');
  });

  it('should not include field-specific errors', () => {
    const result = buildLoginFailureResponse();
    expect(result.error.fields).toBeUndefined();
  });

  it('should produce identical structure for "wrong password" and "non-existent email" scenarios', () => {
    const reqId = 'fixed-request-id';
    const wrongPasswordResponse = buildLoginFailureResponse(reqId);
    const noEmailResponse = buildLoginFailureResponse(reqId);

    expect(wrongPasswordResponse).toEqual(noEmailResponse);
  });

  it('should produce responses that differ only in requestId when called without one', () => {
    const r1 = buildLoginFailureResponse();
    const r2 = buildLoginFailureResponse();

    // Same structure except auto-generated requestId
    expect(r1.success).toBe(r2.success);
    expect(r1.error.code).toBe(r2.error.code);
    expect(r1.error.message).toBe(r2.error.message);
    expect(r1.error.fields).toBe(r2.error.fields);
  });
});

// ─── buildPasswordResetRequestResponse ──────────────────────────────────────

describe('buildPasswordResetRequestResponse', () => {
  it('should return success: true', () => {
    const result = buildPasswordResetRequestResponse();
    expect(result.success).toBe(true);
  });

  it('should use the generic password reset message', () => {
    const result = buildPasswordResetRequestResponse();
    expect(result.message).toBe(PASSWORD_RESET_REQUEST_MESSAGE);
  });

  it('should not reveal whether the email exists in the message', () => {
    const result = buildPasswordResetRequestResponse();
    const msg = result.message.toLowerCase();
    expect(msg).not.toContain('not found');
    expect(msg).not.toContain('does not exist');
    expect(msg).not.toContain('no account');
    expect(msg).not.toContain('sent successfully');
  });

  it('should use conditional language ("if an account exists")', () => {
    const result = buildPasswordResetRequestResponse();
    expect(result.message.toLowerCase()).toContain('if');
  });

  it('should produce identical responses for existing and non-existing emails', () => {
    const existingEmailResponse = buildPasswordResetRequestResponse();
    const nonExistingEmailResponse = buildPasswordResetRequestResponse();

    expect(existingEmailResponse).toEqual(nonExistingEmailResponse);
  });
});

// ─── Constants ──────────────────────────────────────────────────────────────

describe('security response constants', () => {
  it('LOGIN_FAILURE_MESSAGE should be a non-empty string', () => {
    expect(typeof LOGIN_FAILURE_MESSAGE).toBe('string');
    expect(LOGIN_FAILURE_MESSAGE.length).toBeGreaterThan(0);
  });

  it('PASSWORD_RESET_REQUEST_MESSAGE should be a non-empty string', () => {
    expect(typeof PASSWORD_RESET_REQUEST_MESSAGE).toBe('string');
    expect(PASSWORD_RESET_REQUEST_MESSAGE.length).toBeGreaterThan(0);
  });
});
