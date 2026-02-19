import { describe, it, expect } from 'vitest';
import { createPIIScrubber } from './piiScrubber.js';

describe('PIIScrubber', () => {
  // ─── Email Redaction (Requirement 2.1) ──────────────────────────────────

  describe('email redaction', () => {
    it('redacts a simple email address', () => {
      const scrubber = createPIIScrubber();
      expect(scrubber.scrub('Contact user@example.com for info')).toBe(
        'Contact [EMAIL_REDACTED] for info',
      );
    });

    it('redacts multiple email addresses', () => {
      const scrubber = createPIIScrubber();
      const input = 'From alice@test.com to bob@test.org';
      expect(scrubber.scrub(input)).toBe('From [EMAIL_REDACTED] to [EMAIL_REDACTED]');
    });

    it('redacts emails with subdomains', () => {
      const scrubber = createPIIScrubber();
      expect(scrubber.scrub('user@mail.example.co.uk')).toBe('[EMAIL_REDACTED]');
    });

    it('redacts emails with special local-part characters', () => {
      const scrubber = createPIIScrubber();
      expect(scrubber.scrub('first.last+tag@example.com')).toBe('[EMAIL_REDACTED]');
    });

    it('does not redact non-email text', () => {
      const scrubber = createPIIScrubber();
      expect(scrubber.scrub('No PII here')).toBe('No PII here');
    });
  });

  // ─── Phone Redaction (Requirement 2.2) ──────────────────────────────────

  describe('phone redaction', () => {
    it('redacts Nigerian local phone numbers (080...)', () => {
      const scrubber = createPIIScrubber();
      expect(scrubber.scrub('Call 08012345678 now')).toBe('Call [PHONE_REDACTED] now');
    });

    it('redacts Nigerian local phone numbers (070...)', () => {
      const scrubber = createPIIScrubber();
      expect(scrubber.scrub('Phone: 07012345678')).toBe('Phone: [PHONE_REDACTED]');
    });

    it('redacts Nigerian local phone numbers (090...)', () => {
      const scrubber = createPIIScrubber();
      expect(scrubber.scrub('Reach 09012345678')).toBe('Reach [PHONE_REDACTED]');
    });

    it('redacts Nigerian international format (+234...)', () => {
      const scrubber = createPIIScrubber();
      expect(scrubber.scrub('Call +2348012345678')).toBe('Call [PHONE_REDACTED]');
    });

    it('redacts generic international phone numbers', () => {
      const scrubber = createPIIScrubber();
      expect(scrubber.scrub('US: +12025551234')).toBe('US: [PHONE_REDACTED]');
    });

    it('redacts multiple phone numbers', () => {
      const scrubber = createPIIScrubber();
      const input = 'Primary: 08012345678, Alt: +2349012345678';
      expect(scrubber.scrub(input)).toBe('Primary: [PHONE_REDACTED], Alt: [PHONE_REDACTED]');
    });
  });

  // ─── Mixed PII ─────────────────────────────────────────────────────────

  describe('bank account redaction (Requirement 2.3)', () => {
    it('redacts a 10-digit bank account number', () => {
      const scrubber = createPIIScrubber();
      expect(scrubber.scrub('Account: 1234567890')).toBe('Account: [ACCOUNT_REDACTED]');
    });

    it('redacts multiple bank account numbers', () => {
      const scrubber = createPIIScrubber();
      const input = 'From 1234567890 to 0987654321';
      expect(scrubber.scrub(input)).toBe('From [ACCOUNT_REDACTED] to [ACCOUNT_REDACTED]');
    });

    it('does not redact numbers shorter than 10 digits', () => {
      const scrubber = createPIIScrubber();
      expect(scrubber.scrub('Code: 123456789')).toBe('Code: 123456789');
    });

    it('does not match 10 digits embedded in a longer number', () => {
      const scrubber = createPIIScrubber();
      // 12 digits — not a standalone 10-digit account
      expect(scrubber.scrub('Ref: 123456789012')).not.toContain('[ACCOUNT_REDACTED]');
    });
  });

  describe('BVN redaction (Requirement 2.4)', () => {
    it('redacts an 11-digit BVN number', () => {
      const scrubber = createPIIScrubber();
      expect(scrubber.scrub('BVN: 12345678901')).toBe('BVN: [BVN_REDACTED]');
    });

    it('redacts multiple BVN numbers', () => {
      const scrubber = createPIIScrubber();
      const input = 'BVN1: 12345678901, BVN2: 98765432109';
      expect(scrubber.scrub(input)).toBe('BVN1: [BVN_REDACTED], BVN2: [BVN_REDACTED]');
    });

    it('does not redact numbers shorter than 11 digits', () => {
      const scrubber = createPIIScrubber();
      expect(scrubber.scrub('Ref: 1234567890')).not.toContain('[BVN_REDACTED]');
    });

    it('does not match 11 digits embedded in a longer number', () => {
      const scrubber = createPIIScrubber();
      // 13 digits — not a standalone 11-digit BVN
      expect(scrubber.scrub('Ref: 1234567890123')).not.toContain('[BVN_REDACTED]');
    });
  });

  describe('phone vs account/BVN disambiguation', () => {
    it('redacts Nigerian local phone as phone, not BVN', () => {
      const scrubber = createPIIScrubber();
      // 08012345678 is 11 digits but matches phone pattern
      expect(scrubber.scrub('Phone: 08012345678')).toBe('Phone: [PHONE_REDACTED]');
    });

    it('redacts Nigerian intl phone as phone, not account', () => {
      const scrubber = createPIIScrubber();
      expect(scrubber.scrub('Phone: +2348012345678')).toBe('Phone: [PHONE_REDACTED]');
    });

    it('handles phone, BVN, and account in the same string', () => {
      const scrubber = createPIIScrubber();
      const input = 'Phone: 08012345678, BVN: 22345678901, Account: 1234567890';
      expect(scrubber.scrub(input)).toBe(
        'Phone: [PHONE_REDACTED], BVN: [BVN_REDACTED], Account: [ACCOUNT_REDACTED]',
      );
    });
  });

  describe('mixed PII', () => {
    it('redacts both email and phone in the same string', () => {
      const scrubber = createPIIScrubber();
      const input = 'Email: user@example.com, Phone: 08012345678';
      expect(scrubber.scrub(input)).toBe('Email: [EMAIL_REDACTED], Phone: [PHONE_REDACTED]');
    });

    it('redacts email, phone, BVN, and account in the same string', () => {
      const scrubber = createPIIScrubber();
      const input =
        'Email: user@example.com, Phone: 08012345678, BVN: 22345678901, Account: 1234567890';
      expect(scrubber.scrub(input)).toBe(
        'Email: [EMAIL_REDACTED], Phone: [PHONE_REDACTED], BVN: [BVN_REDACTED], Account: [ACCOUNT_REDACTED]',
      );
    });
  });

  // ─── scrubObject ───────────────────────────────────────────────────────

  describe('scrubObject', () => {
    it('scrubs string values in a flat object', () => {
      const scrubber = createPIIScrubber();
      const obj = { email: 'user@example.com', name: 'Alice' };
      expect(scrubber.scrubObject(obj)).toEqual({
        email: '[EMAIL_REDACTED]',
        name: 'Alice',
      });
    });

    it('scrubs nested objects recursively', () => {
      const scrubber = createPIIScrubber();
      const obj = {
        user: { contact: 'user@example.com', phone: '08012345678' },
        count: 42,
      };
      expect(scrubber.scrubObject(obj)).toEqual({
        user: { contact: '[EMAIL_REDACTED]', phone: '[PHONE_REDACTED]' },
        count: 42,
      });
    });

    it('scrubs arrays of strings', () => {
      const scrubber = createPIIScrubber();
      const obj = { emails: ['a@b.com', 'c@d.org'] };
      expect(scrubber.scrubObject(obj)).toEqual({
        emails: ['[EMAIL_REDACTED]', '[EMAIL_REDACTED]'],
      });
    });

    it('preserves non-string, non-object values', () => {
      const scrubber = createPIIScrubber();
      const obj = { flag: true, count: 5, empty: null };
      expect(scrubber.scrubObject(obj)).toEqual({ flag: true, count: 5, empty: null });
    });
  });

  // ─── addPattern ────────────────────────────────────────────────────────

  describe('addPattern', () => {
    it('applies a custom pattern after built-in patterns', () => {
      const scrubber = createPIIScrubber();
      scrubber.addPattern('ssn', /\d{3}-\d{2}-\d{4}/g, '[SSN_REDACTED]');
      expect(scrubber.scrub('SSN: 123-45-6789')).toBe('SSN: [SSN_REDACTED]');
    });

    it('custom patterns work alongside built-in patterns', () => {
      const scrubber = createPIIScrubber();
      scrubber.addPattern('ssn', /\d{3}-\d{2}-\d{4}/g, '[SSN_REDACTED]');
      const input = 'Email: a@b.com, SSN: 123-45-6789';
      expect(scrubber.scrub(input)).toBe('Email: [EMAIL_REDACTED], SSN: [SSN_REDACTED]');
    });
  });
});
