/**
 * Property-based tests for Nigerian format parsing utilities.
 *
 * **Property 22: Nigerian Date Format Parsing**
 * For any valid day/month/year combination in DD/MM/YYYY format,
 * parseNigerianDate SHALL return a valid ISO 8601 date string (YYYY-MM-DD)
 * with the correct day, month, and year values.
 *
 * **Property 23: Nigerian Currency Format Parsing**
 * For any non-negative number formatted with ₦, NGN, or N prefix and optional
 * comma separators, parseNigerianCurrency SHALL return the correct numeric Naira value.
 *
 * **Property 24: Nigerian Phone Number Extraction**
 * For any text containing valid Nigerian phone numbers (070x, 080x, 081x, 090x, 091x prefixes),
 * extractNigerianPhone SHALL find and normalize all phone numbers to 11-digit local format.
 *
 * **Validates: Requirements 11.1, 11.2, 11.3, 11.6**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  parseNigerianDate,
  parseNigerianCurrency,
  extractNigerianPhone,
} from './nigerian-formats.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Days-in-month lookup (non-leap). Feb handled separately for leap years. */
function daysInMonth(month: number, year: number): number {
  const table = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) return 29;
  return table[month] ?? 30;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const MONTH_ABBREVS: Record<number, string> = {
  1: 'Jan',
  2: 'Feb',
  3: 'Mar',
  4: 'Apr',
  5: 'May',
  6: 'Jun',
  7: 'Jul',
  8: 'Aug',
  9: 'Sep',
  10: 'Oct',
  11: 'Nov',
  12: 'Dec',
};

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * Generate a valid (day, month, year) triple that represents a real calendar date.
 */
const validDatePartsArb = fc.integer({ min: 1, max: 12 }).chain((month) =>
  fc.integer({ min: 2000, max: 2099 }).chain((year) =>
    fc.integer({ min: 1, max: daysInMonth(month, year) }).map((day) => ({
      day,
      month,
      year,
    })),
  ),
);

/** Separator for date formats: / or - */
const dateSepArb = fc.constantFrom('/', '-');

/** Nigerian phone prefix (first 3 digits of local number). */
const phonePrefixArb = fc.constantFrom('070', '080', '081', '090', '091');

/** Currency prefix variants. */
const currencyPrefixArb = fc.constantFrom('₦', 'NGN', 'N', 'NGN ', 'N ');

// ─── Property 22: Nigerian Date Format Parsing ──────────────────────────────

describe('Property 22: Nigerian Date Format Parsing', () => {
  /**
   * **Validates: Requirements 11.1**
   *
   * For any valid calendar date formatted as DD/MM/YYYY or DD-MM-YYYY,
   * parseNigerianDate SHALL return the ISO 8601 string YYYY-MM-DD with
   * correct day, month, and year values.
   */
  it('correctly parses DD/MM/YYYY and DD-MM-YYYY to ISO 8601', () => {
    fc.assert(
      fc.property(validDatePartsArb, dateSepArb, ({ day, month, year }, sep) => {
        const dd = day.toString().padStart(2, '0');
        const mm = month.toString().padStart(2, '0');
        const input = `${dd}${sep}${mm}${sep}${year}`;

        const result = parseNigerianDate(input);

        expect(result).not.toBeNull();

        const expectedYear = year.toString().padStart(4, '0');
        const expectedMonth = month.toString().padStart(2, '0');
        const expectedDay = day.toString().padStart(2, '0');
        expect(result).toBe(`${expectedYear}-${expectedMonth}-${expectedDay}`);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 11.1**
   *
   * For any valid calendar date formatted as DD/MMM/YYYY or DD-MMM-YYYY
   * (abbreviated month name), parseNigerianDate SHALL return the correct
   * ISO 8601 date string.
   */
  it('correctly parses DD/MMM/YYYY and DD-MMM-YYYY to ISO 8601', () => {
    fc.assert(
      fc.property(validDatePartsArb, dateSepArb, ({ day, month, year }, sep) => {
        const dd = day.toString().padStart(2, '0');
        const mmm = MONTH_ABBREVS[month];
        const input = `${dd}${sep}${mmm}${sep}${year}`;

        const result = parseNigerianDate(input);

        expect(result).not.toBeNull();

        const expectedYear = year.toString().padStart(4, '0');
        const expectedMonth = month.toString().padStart(2, '0');
        const expectedDay = day.toString().padStart(2, '0');
        expect(result).toBe(`${expectedYear}-${expectedMonth}-${expectedDay}`);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 11.1**
   *
   * For any invalid date (e.g. Feb 30, month 13), parseNigerianDate SHALL
   * return null rather than producing an incorrect date.
   */
  it('returns null for invalid calendar dates', () => {
    const invalidDates = [
      '31/02/2024', // Feb 31
      '30/02/2024', // Feb 30
      '29/02/2023', // Feb 29 non-leap
      '00/01/2024', // day 0
      '15/00/2024', // month 0
      '15/13/2024', // month 13
      '',
      'not-a-date',
    ];

    for (const input of invalidDates) {
      expect(parseNigerianDate(input)).toBeNull();
    }
  });
});

// ─── Property 23: Nigerian Currency Format Parsing ──────────────────────────

describe('Property 23: Nigerian Currency Format Parsing', () => {
  /**
   * **Validates: Requirements 11.2, 11.3**
   *
   * For any non-negative integer formatted with a Nigerian currency prefix,
   * parseNigerianCurrency SHALL return the exact numeric value.
   */
  it('correctly parses prefixed integer amounts', () => {
    fc.assert(
      fc.property(currencyPrefixArb, fc.integer({ min: 0, max: 99_999_999 }), (prefix, amount) => {
        const input = `${prefix}${amount}`;
        const result = parseNigerianCurrency(input);

        expect(result).not.toBeNull();
        expect(result).toBe(amount);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 11.2, 11.3**
   *
   * For any non-negative integer formatted with comma-separated thousands
   * and a Nigerian currency prefix, parseNigerianCurrency SHALL return
   * the correct numeric value.
   */
  it('correctly parses comma-separated amounts', () => {
    fc.assert(
      fc.property(
        currencyPrefixArb,
        fc.integer({ min: 1_000, max: 99_999_999 }),
        (prefix, amount) => {
          const formatted = amount.toLocaleString('en-US');
          const input = `${prefix}${formatted}`;
          const result = parseNigerianCurrency(input);

          expect(result).not.toBeNull();
          expect(result).toBe(amount);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 11.2, 11.3**
   *
   * For any non-negative decimal amount with up to 2 decimal places,
   * parseNigerianCurrency SHALL return the correct numeric value.
   */
  it('correctly parses decimal amounts', () => {
    fc.assert(
      fc.property(
        currencyPrefixArb,
        fc.integer({ min: 0, max: 99_999_999 }),
        fc.integer({ min: 0, max: 99 }),
        (prefix, whole, cents) => {
          const decimal = cents.toString().padStart(2, '0');
          const input = `${prefix}${whole}.${decimal}`;
          const result = parseNigerianCurrency(input);

          expect(result).not.toBeNull();
          const expected = parseFloat(`${whole}.${decimal}`);
          expect(result).toBeCloseTo(expected, 2);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 11.2**
   *
   * Empty strings and prefix-only strings SHALL return null.
   */
  it('returns null for invalid currency strings', () => {
    const invalidInputs = ['', '₦', 'NGN', 'N', '₦-100', '₦abc'];

    for (const input of invalidInputs) {
      expect(parseNigerianCurrency(input)).toBeNull();
    }
  });
});

// ─── Property 24: Nigerian Phone Number Extraction ──────────────────────────

describe('Property 24: Nigerian Phone Number Extraction', () => {
  /**
   * **Validates: Requirements 11.6**
   *
   * For any valid Nigerian phone number in local format (0XXXXXXXXXX),
   * extractNigerianPhone SHALL find it in surrounding text and normalize
   * it to the 11-digit local format.
   */
  it('extracts and normalizes local-format phone numbers from text', () => {
    fc.assert(
      fc.property(
        phonePrefixArb,
        fc.integer({ min: 10_000_000, max: 99_999_999 }),
        fc.string({ minLength: 0, maxLength: 20 }),
        fc.string({ minLength: 0, maxLength: 20 }),
        (prefix, suffix, before, after) => {
          const phone = `${prefix}${suffix}`;
          // Surround with non-digit text to simulate free text
          const safeBefore = before.replace(/\d/g, 'x');
          const safeAfter = after.replace(/\d/g, 'x');
          const text = `${safeBefore} ${phone} ${safeAfter}`;

          const results = extractNigerianPhone(text);

          expect(results.length).toBeGreaterThanOrEqual(1);

          const normalized = results.map((r) => r.normalized);
          expect(normalized).toContain(phone);

          // Verify normalized format: 11 digits starting with 0
          for (const r of results) {
            expect(r.normalized).toMatch(/^0[789][01]\d{8}$/);
            expect(r.normalized).toHaveLength(11);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 11.6**
   *
   * For any valid Nigerian phone number in international format (+234XXXXXXXXXX),
   * extractNigerianPhone SHALL find it and normalize to 11-digit local format.
   */
  it('extracts and normalizes international-format phone numbers', () => {
    fc.assert(
      fc.property(
        phonePrefixArb,
        fc.integer({ min: 10_000_000, max: 99_999_999 }),
        (prefix, suffix) => {
          // Convert local prefix 0XX to international 234XX
          const localDigits = prefix.slice(1); // e.g. '80' from '080'
          const internationalPhone = `+234${localDigits}${suffix}`;
          const expectedLocal = `${prefix}${suffix}`;

          const text = `Call me at ${internationalPhone} for details`;
          const results = extractNigerianPhone(text);

          expect(results.length).toBeGreaterThanOrEqual(1);

          const normalized = results.map((r) => r.normalized);
          expect(normalized).toContain(expectedLocal);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 11.6**
   *
   * For any text containing multiple distinct Nigerian phone numbers,
   * extractNigerianPhone SHALL find all of them with unique normalization.
   */
  it('extracts multiple distinct phone numbers from text', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(phonePrefixArb, fc.integer({ min: 10_000_000, max: 99_999_999 })), {
          minLength: 2,
          maxLength: 5,
        }),
        (phones) => {
          // Deduplicate by full number
          const uniquePhones = [
            ...new Map(phones.map(([p, s]) => [`${p}${s}`, [p, s] as const])).values(),
          ];
          fc.pre(uniquePhones.length >= 2);

          const text = uniquePhones.map(([p, s]) => `Contact: ${p}${s}`).join(', ');
          const results = extractNigerianPhone(text);

          const normalizedSet = new Set(results.map((r) => r.normalized));
          for (const [p, s] of uniquePhones) {
            expect(normalizedSet.has(`${p}${s}`)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 11.6**
   *
   * For text containing no Nigerian phone numbers, extractNigerianPhone
   * SHALL return an empty array.
   */
  it('returns empty array when no phone numbers are present', () => {
    const noPhoneTexts = [
      'Hello world, no numbers here',
      'Invoice #12345 for services rendered',
      'Email: test@example.com',
      '',
    ];

    for (const text of noPhoneTexts) {
      expect(extractNigerianPhone(text)).toEqual([]);
    }
  });
});
