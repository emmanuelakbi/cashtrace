/**
 * Unit tests for the EmailService adapter.
 *
 * Tests cover:
 * - Magic link email formatting and delivery (Requirement 3.3)
 * - Password reset email formatting and delivery (Requirement 5.3)
 * - Graceful degradation when transport fails (Requirement 3.7)
 * - Configurable base URL for links
 * - Token URL-encoding in links
 *
 * @module services/emailService.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EmailServiceAdapter,
  EmailServiceError,
  type EmailTransport,
  type EmailServiceConfig,
} from './emailService.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockTransport() {
  return {
    sendMail: vi
      .fn<[{ to: string; subject: string; html: string }], Promise<void>>()
      .mockResolvedValue(undefined),
  } satisfies EmailTransport;
}

const DEFAULT_CONFIG: EmailServiceConfig = {
  baseUrl: 'https://app.cashtrace.ng',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('EmailServiceAdapter', () => {
  let transport: ReturnType<typeof createMockTransport>;
  let service: EmailServiceAdapter;

  beforeEach(() => {
    transport = createMockTransport();
    service = new EmailServiceAdapter(transport, DEFAULT_CONFIG);
  });

  // ── sendMagicLink ────────────────────────────────────────────────────────

  describe('sendMagicLink', () => {
    it('sends an email to the correct recipient', async () => {
      await service.sendMagicLink('user@example.com', 'abc123');

      expect(transport.sendMail).toHaveBeenCalledOnce();
      expect(transport.sendMail.mock.calls[0]![0].to).toBe('user@example.com');
    });

    it('includes the token in the magic link URL', async () => {
      await service.sendMagicLink('user@example.com', 'my-token-123');

      const html = transport.sendMail.mock.calls[0]![0].html;
      expect(html).toContain('https://app.cashtrace.ng/auth/magic-link/verify?token=my-token-123');
    });

    it('URL-encodes special characters in the token', async () => {
      const tokenWithSpecialChars = 'token with spaces&special=chars';
      await service.sendMagicLink('user@example.com', tokenWithSpecialChars);

      const html = transport.sendMail.mock.calls[0]![0].html;
      expect(html).toContain(encodeURIComponent(tokenWithSpecialChars));
      expect(html).not.toContain('token with spaces&special=chars');
    });

    it('uses the configured base URL', async () => {
      const customService = new EmailServiceAdapter(transport, {
        baseUrl: 'https://custom.example.com',
      });

      await customService.sendMagicLink('user@example.com', 'tok');

      const html = transport.sendMail.mock.calls[0]![0].html;
      expect(html).toContain('https://custom.example.com/auth/magic-link/verify?token=tok');
    });

    it('sets the subject for magic link emails', async () => {
      await service.sendMagicLink('user@example.com', 'tok');

      expect(transport.sendMail.mock.calls[0]![0].subject).toBe('Your CashTrace Login Link');
    });

    it('includes expiration notice in the email body', async () => {
      await service.sendMagicLink('user@example.com', 'tok');

      const html = transport.sendMail.mock.calls[0]![0].html;
      expect(html).toContain('15 minutes');
    });

    it('throws EmailServiceError when transport fails', async () => {
      const transportError = new Error('SMTP connection refused');
      transport.sendMail.mockRejectedValueOnce(transportError);

      await expect(service.sendMagicLink('user@example.com', 'tok')).rejects.toThrow(
        EmailServiceError,
      );
    });

    it('preserves the original error as cause', async () => {
      const transportError = new Error('SMTP timeout');
      transport.sendMail.mockRejectedValueOnce(transportError);

      try {
        await service.sendMagicLink('user@example.com', 'tok');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(EmailServiceError);
        expect((err as EmailServiceError).cause).toBe(transportError);
      }
    });

    it('sets the correct error code on EmailServiceError', async () => {
      transport.sendMail.mockRejectedValueOnce(new Error('fail'));

      try {
        await service.sendMagicLink('user@example.com', 'tok');
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as EmailServiceError).code).toBe('EMAIL_SERVICE_ERROR');
      }
    });
  });

  // ── sendPasswordReset ────────────────────────────────────────────────────

  describe('sendPasswordReset', () => {
    it('sends an email to the correct recipient', async () => {
      await service.sendPasswordReset('user@example.com', 'reset-tok');

      expect(transport.sendMail).toHaveBeenCalledOnce();
      expect(transport.sendMail.mock.calls[0]![0].to).toBe('user@example.com');
    });

    it('includes the token in the password reset URL', async () => {
      await service.sendPasswordReset('user@example.com', 'reset-token-456');

      const html = transport.sendMail.mock.calls[0]![0].html;
      expect(html).toContain('https://app.cashtrace.ng/auth/password/reset?token=reset-token-456');
    });

    it('URL-encodes special characters in the token', async () => {
      const tokenWithSpecialChars = 'reset&token=special chars';
      await service.sendPasswordReset('user@example.com', tokenWithSpecialChars);

      const html = transport.sendMail.mock.calls[0]![0].html;
      expect(html).toContain(encodeURIComponent(tokenWithSpecialChars));
    });

    it('uses the configured base URL', async () => {
      const customService = new EmailServiceAdapter(transport, {
        baseUrl: 'https://staging.cashtrace.ng',
      });

      await customService.sendPasswordReset('user@example.com', 'tok');

      const html = transport.sendMail.mock.calls[0]![0].html;
      expect(html).toContain('https://staging.cashtrace.ng/auth/password/reset?token=tok');
    });

    it('sets the subject for password reset emails', async () => {
      await service.sendPasswordReset('user@example.com', 'tok');

      expect(transport.sendMail.mock.calls[0]![0].subject).toBe('Reset Your CashTrace Password');
    });

    it('includes expiration notice in the email body', async () => {
      await service.sendPasswordReset('user@example.com', 'tok');

      const html = transport.sendMail.mock.calls[0]![0].html;
      expect(html).toContain('1 hour');
    });

    it('throws EmailServiceError when transport fails', async () => {
      transport.sendMail.mockRejectedValueOnce(new Error('Network error'));

      await expect(service.sendPasswordReset('user@example.com', 'tok')).rejects.toThrow(
        EmailServiceError,
      );
    });

    it('preserves the original error as cause', async () => {
      const transportError = new Error('DNS resolution failed');
      transport.sendMail.mockRejectedValueOnce(transportError);

      try {
        await service.sendPasswordReset('user@example.com', 'tok');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(EmailServiceError);
        expect((err as EmailServiceError).cause).toBe(transportError);
      }
    });
  });

  // ── EmailServiceError ────────────────────────────────────────────────────

  describe('EmailServiceError', () => {
    it('has the correct name', () => {
      const err = new EmailServiceError('test');
      expect(err.name).toBe('EmailServiceError');
    });

    it('has the correct code', () => {
      const err = new EmailServiceError('test');
      expect(err.code).toBe('EMAIL_SERVICE_ERROR');
    });

    it('is an instance of Error', () => {
      const err = new EmailServiceError('test');
      expect(err).toBeInstanceOf(Error);
    });

    it('stores the cause when provided', () => {
      const cause = new Error('root cause');
      const err = new EmailServiceError('wrapper', cause);
      expect(err.cause).toBe(cause);
    });

    it('has undefined cause when not provided', () => {
      const err = new EmailServiceError('no cause');
      expect(err.cause).toBeUndefined();
    });
  });
});
