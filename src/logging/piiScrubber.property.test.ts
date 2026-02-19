/**
 * Property-based tests for PII Scrubber
 *
 * **Property 1: PII Redaction Completeness**
 * For any log entry, all PII patterns (email, phone, BVN, account numbers)
 * SHALL be redacted before storage.
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createPIIScrubber } from './piiScrubber.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a realistic email address. */
const emailArb = fc
  .tuple(
    fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9._%+-]{0,15}$/),
    fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9-]{0,10}$/),
    fc.constantFrom('com', 'org', 'net', 'co.ng', 'ng', 'io', 'co.uk'),
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/** Generate a Nigerian local phone number (0[7-9][0-1]XXXXXXXX). */
const nigerianLocalPhoneArb = fc
  .tuple(fc.constantFrom('070', '080', '081', '090', '091'), fc.stringMatching(/^\d{8}$/))
  .map(([prefix, rest]) => `${prefix}${rest}`);

/** Generate a Nigerian international phone number (+234XXXXXXXXXX). */
const nigerianIntlPhoneArb = fc.stringMatching(/^\d{10}$/).map((digits) => `+234${digits}`);

/** Generate a generic international phone number (+X with 7-15 digits). */
const intlPhoneArb = fc
  .integer({ min: 7, max: 15 })
  .chain((len) =>
    fc.tuple(
      fc.constantFrom('+1', '+44', '+49', '+61', '+81'),
      fc.stringMatching(new RegExp(`^\\d{${len - 1}}$`)),
    ),
  )
  .map(([prefix, rest]) => `${prefix}${rest}`)
  .filter((phone) => {
    // Ensure total digit count is 7-15 and doesn't start with +234
    const digits = phone.slice(1);
    return digits.length >= 7 && digits.length <= 15 && !phone.startsWith('+234');
  });

/** Generate any phone number variant. */
const phoneArb = fc.oneof(nigerianLocalPhoneArb, nigerianIntlPhoneArb, intlPhoneArb);

/** Generate a 10-digit Nigerian bank account number (not starting with 0[7-9][0-1]). */
const bankAccountArb = fc.stringMatching(/^\d{10}$/).filter((n) => !/^0[789][01]/.test(n));

/** Generate an 11-digit BVN number (not matching phone patterns). */
const bvnArb = fc.stringMatching(/^\d{11}$/).filter((n) => !/^0[789][01]/.test(n));

/** Generate surrounding text that does NOT contain PII. */
const safeTextArb = fc.constantFrom(
  'User logged in from',
  'Transaction completed for',
  'Payment processed:',
  'Error in request:',
  'Account info:',
  'Contact details -',
  'Notification sent to',
  'Record updated:',
  '',
);

// ─── Regex matchers for detecting raw PII in output ──────────────────────────

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const NIGERIAN_INTL_PHONE_RE = /\+234\d{10}/;
const NIGERIAN_LOCAL_PHONE_RE = /\b0[7-9][01]\d{8}\b/;
const INTL_PHONE_RE = /\+\d{7,15}/;
const BVN_RE = /\b\d{11}\b/;
const BANK_ACCOUNT_RE = /\b\d{10}\b/;

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('PII Redaction Completeness (Property 1)', () => {
  const scrubber = createPIIScrubber();

  /**
   * **Validates: Requirements 2.1**
   * For any string containing an email address, scrub() SHALL redact it.
   */
  it('redacts all generated email addresses', () => {
    fc.assert(
      fc.property(fc.tuple(safeTextArb, emailArb, safeTextArb), ([prefix, email, suffix]) => {
        const input = `${prefix} ${email} ${suffix}`;
        const result = scrubber.scrub(input);
        expect(result).not.toMatch(EMAIL_RE);
        expect(result).toContain('[EMAIL_REDACTED]');
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 2.2**
   * For any string containing a phone number, scrub() SHALL redact it.
   */
  it('redacts all generated phone numbers', () => {
    fc.assert(
      fc.property(fc.tuple(safeTextArb, phoneArb, safeTextArb), ([prefix, phone, suffix]) => {
        const input = `${prefix} ${phone} ${suffix}`;
        const result = scrubber.scrub(input);
        expect(result).not.toMatch(NIGERIAN_INTL_PHONE_RE);
        expect(result).not.toMatch(NIGERIAN_LOCAL_PHONE_RE);
        expect(result).not.toMatch(INTL_PHONE_RE);
        expect(result).toContain('[PHONE_REDACTED]');
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 2.3**
   * For any string containing a 10-digit bank account number, scrub() SHALL redact it.
   */
  it('redacts all generated bank account numbers', () => {
    fc.assert(
      fc.property(
        fc.tuple(safeTextArb, bankAccountArb, safeTextArb),
        ([prefix, account, suffix]) => {
          const input = `${prefix} ${account} ${suffix}`;
          const result = scrubber.scrub(input);
          expect(result).not.toMatch(BANK_ACCOUNT_RE);
          expect(result).toContain('[ACCOUNT_REDACTED]');
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 2.4**
   * For any string containing an 11-digit BVN, scrub() SHALL redact it.
   */
  it('redacts all generated BVN numbers', () => {
    fc.assert(
      fc.property(fc.tuple(safeTextArb, bvnArb, safeTextArb), ([prefix, bvn, suffix]) => {
        const input = `${prefix} ${bvn} ${suffix}`;
        const result = scrubber.scrub(input);
        expect(result).not.toMatch(BVN_RE);
        expect(result).toContain('[BVN_REDACTED]');
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
   * For any string containing a mix of all PII types, scrub() SHALL redact all of them.
   */
  it('redacts all PII types when mixed in a single log entry', () => {
    fc.assert(
      fc.property(
        fc.tuple(emailArb, phoneArb, bankAccountArb, bvnArb),
        ([email, phone, account, bvn]) => {
          const input = `User ${email} called ${phone}, acct ${account}, bvn ${bvn}`;
          const result = scrubber.scrub(input);

          // No raw PII should survive
          expect(result).not.toMatch(EMAIL_RE);
          expect(result).not.toMatch(NIGERIAN_INTL_PHONE_RE);
          expect(result).not.toMatch(NIGERIAN_LOCAL_PHONE_RE);
          expect(result).not.toMatch(INTL_PHONE_RE);
          expect(result).not.toMatch(BVN_RE);
          expect(result).not.toMatch(BANK_ACCOUNT_RE);

          // All redaction tokens should be present
          expect(result).toContain('[EMAIL_REDACTED]');
          expect(result).toContain('[PHONE_REDACTED]');
          expect(result).toContain('[ACCOUNT_REDACTED]');
          expect(result).toContain('[BVN_REDACTED]');
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
   * Scrubbing is idempotent — applying scrub twice yields the same result.
   */
  it('scrubbing is idempotent', () => {
    fc.assert(
      fc.property(
        fc.tuple(emailArb, phoneArb, bankAccountArb, bvnArb),
        ([email, phone, account, bvn]) => {
          const input = `${email} ${phone} ${account} ${bvn}`;
          const once = scrubber.scrub(input);
          const twice = scrubber.scrub(once);
          expect(twice).toBe(once);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
   * Text without PII passes through unchanged.
   */
  it('does not alter text that contains no PII', () => {
    const safeSentenceArb = fc.stringMatching(/^[A-Za-z ]{1,60}$/);
    fc.assert(
      fc.property(safeSentenceArb, (text) => {
        expect(scrubber.scrub(text)).toBe(text);
      }),
      { numRuns: 200 },
    );
  });
});
