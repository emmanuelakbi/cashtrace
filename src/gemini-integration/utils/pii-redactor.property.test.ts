/**
 * Property-based tests for PII Redaction — Property 21: PII Redaction Completeness
 *
 * For any text containing Nigerian PII patterns (phone numbers 080x/081x/070x/090x/091x,
 * 10-digit account numbers, 11-digit BVN, email addresses), the redactor SHALL replace
 * all matches with redaction markers.
 *
 * **Validates: Requirements 12.3, 12.4**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { containsPii, redact, redactObject } from './pii-redactor.js';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Generate a Nigerian phone number with one of the standard prefixes.
 * Produces 11-digit strings like 08012345678, 09198765432, etc.
 */
const nigerianPhoneArb = fc
  .constantFrom('080', '081', '070', '090', '091')
  .chain((prefix) =>
    fc.integer({ min: 10000000, max: 99999999 }).map((suffix) => `${prefix}${suffix}`),
  );

/**
 * Generate a Nigerian phone number with +234 international prefix.
 * Produces strings like +2348012345678.
 */
const internationalPhoneArb = fc
  .constantFrom('80', '81', '70', '90', '91')
  .chain((prefix) =>
    fc.integer({ min: 10000000, max: 99999999 }).map((suffix) => `+234${prefix}${suffix}`),
  );

/** Any Nigerian phone number — local or international format. */
const anyPhoneArb = fc.oneof(nigerianPhoneArb, internationalPhoneArb);

/**
 * Generate a valid email address.
 * Uses alphanumeric local parts and simple domain names.
 */
const emailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{1,8}$/),
    fc.stringMatching(/^[a-z][a-z0-9]{1,6}$/),
    fc.constantFrom('com', 'ng', 'org', 'co.uk', 'com.ng'),
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/**
 * Generate an 11-digit BVN number that won't be consumed by the phone regex.
 *
 * The phone regex `(?:0?[789][01])\d` can match substrings within arbitrary
 * 11-digit numbers. To test BVN redaction specifically, we generate numbers
 * whose digits never form a phone-prefix subsequence. Digits 1-6 are safe
 * since the phone regex requires [789] in the second position.
 */
const bvnArb = fc
  .array(fc.integer({ min: 1, max: 6 }), { minLength: 11, maxLength: 11 })
  .map((digits) => digits.join(''));

/**
 * Generate a 10-digit account number that won't be consumed by the phone regex.
 * Same safe-digit strategy as BVN.
 */
const accountNumberArb = fc
  .array(fc.integer({ min: 1, max: 6 }), { minLength: 10, maxLength: 10 })
  .map((digits) => digits.join(''));

/** Safe filler text that does not accidentally contain PII patterns. */
const safeTextArb = fc.constantFrom(
  'Payment received for invoice',
  'Transfer completed successfully',
  'Business expense recorded',
  'Monthly subscription fee',
  'Vendor payment processed',
  'Salary disbursement',
  'Utility bill payment',
  'Office supplies purchase',
);

/**
 * Embed a PII value inside surrounding safe text so the regex has
 * word boundaries to work with.
 */
function embedInText(pii: string): fc.Arbitrary<{ text: string; pii: string }> {
  return safeTextArb.map((filler) => ({
    text: `${filler} ${pii} end`,
    pii,
  }));
}

// ---------------------------------------------------------------------------
// Tests — Property 21: PII Redaction Completeness
// ---------------------------------------------------------------------------

describe('PII Redaction Completeness (Property 21)', () => {
  /**
   * **Validates: Requirements 12.3**
   *
   * For any text containing a Nigerian phone number, after redaction
   * the raw phone number SHALL NOT appear in the output.
   */
  it('no raw phone numbers remain after redaction', () => {
    fc.assert(
      fc.property(anyPhoneArb.chain(embedInText), ({ text, pii }) => {
        const result = redact(text);
        expect(result).not.toContain(pii);
        expect(result).toContain('[PHONE]');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 12.3**
   *
   * For any text containing an email address, after redaction
   * the raw email SHALL NOT appear in the output.
   */
  it('no raw email addresses remain after redaction', () => {
    fc.assert(
      fc.property(emailArb.chain(embedInText), ({ text, pii }) => {
        const result = redact(text);
        expect(result).not.toContain(pii);
        expect(result).toContain('[EMAIL]');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 12.3**
   *
   * For any text containing a 10-digit account number, after redaction
   * the raw account number SHALL NOT appear in the output.
   */
  it('no raw account numbers remain after redaction', () => {
    fc.assert(
      fc.property(accountNumberArb.chain(embedInText), ({ text, pii }) => {
        const result = redact(text);
        expect(result).not.toContain(pii);
        expect(result).toContain('[ACCOUNT]');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 12.3**
   *
   * For any text containing an 11-digit BVN, after redaction
   * the raw BVN SHALL NOT appear in the output.
   */
  it('no raw BVN numbers remain after redaction', () => {
    fc.assert(
      fc.property(bvnArb.chain(embedInText), ({ text, pii }) => {
        const result = redact(text);
        expect(result).not.toContain(pii);
        expect(result).toContain('[BVN]');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 12.3, 12.4**
   *
   * For any text that had PII embedded, after redaction containsPii
   * SHALL return false — confirming all detectable PII was removed.
   */
  it('containsPii returns false after redaction', () => {
    const piiArb = fc.oneof(anyPhoneArb, emailArb, accountNumberArb, bvnArb);

    fc.assert(
      fc.property(piiArb.chain(embedInText), ({ text }) => {
        const redacted = redact(text);
        expect(containsPii(redacted)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 12.4**
   *
   * For any object whose string values contain PII, redactObject SHALL
   * deep-redact every string value so no raw PII remains.
   */
  it('redactObject deep-redacts all string values', () => {
    fc.assert(
      fc.property(anyPhoneArb, emailArb, accountNumberArb, bvnArb, (phone, email, account, bvn) => {
        const obj = {
          customer: {
            phone: `Call ${phone} now`,
            email: `Send to ${email} please`,
            nested: {
              account: `Acct ${account} ref`,
              bvn: `BVN ${bvn} verified`,
            },
          },
          tags: [`Phone ${phone}`, `Email ${email}`],
        };

        const result = redactObject(obj);

        // No raw PII in any nested string
        const allStrings = JSON.stringify(result);
        expect(allStrings).not.toContain(phone);
        expect(allStrings).not.toContain(email);
        expect(allStrings).not.toContain(account);
        expect(allStrings).not.toContain(bvn);

        // Redaction markers present
        expect(allStrings).toContain('[PHONE]');
        expect(allStrings).toContain('[EMAIL]');
        expect(allStrings).toContain('[ACCOUNT]');
        expect(allStrings).toContain('[BVN]');
      }),
      { numRuns: 100 },
    );
  });
});
