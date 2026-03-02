/**
 * Property-based tests for NormalizationService — Kobo Conversion
 *
 * **Property 1: Kobo Conversion Round-Trip**
 * For any non-negative integer kobo value, converting kobo→naira→kobo should
 * return the original value. For any non-negative Naira amount with at most
 * 2 decimal places, converting naira→kobo→naira should return the original value.
 *
 * **Validates: Requirements 1.2**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  determineTransactionType,
  formatAsNaira,
  koboToNaira,
  nairaToKobo,
  normalize,
} from './normalizationService.js';
import type { RawExtractedTransaction, SourceType } from './types.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/** Non-negative integer kobo values (0 up to 10 billion kobo = 100M Naira). */
const koboArb = fc.integer({ min: 0, max: 10_000_000_000 });

/**
 * Non-negative Naira amounts with at most 2 decimal places.
 * Generated as integer kobo then divided by 100 to guarantee exactly 2 decimals.
 */
const nairaWith2DecimalsArb = koboArb.map((kobo) => kobo / 100);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Kobo Conversion Round-Trip (Property 1)', () => {
  /**
   * **Validates: Requirements 1.2**
   * For any non-negative integer kobo value, kobo → naira → kobo
   * should return the original value.
   */
  it('kobo → naira → kobo round-trip preserves the original value', () => {
    fc.assert(
      fc.property(koboArb, (kobo) => {
        const naira = koboToNaira(kobo);
        const backToKobo = nairaToKobo(naira);
        expect(backToKobo).toBe(kobo);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.2**
   * For any non-negative Naira amount with at most 2 decimal places,
   * naira → kobo → naira should return the original value.
   */
  it('naira → kobo → naira round-trip preserves the original value', () => {
    fc.assert(
      fc.property(nairaWith2DecimalsArb, (naira) => {
        const kobo = nairaToKobo(naira);
        const backToNaira = koboToNaira(kobo);
        expect(backToNaira).toBe(naira);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.2**
   * nairaToKobo always returns an integer for any input.
   */
  it('nairaToKobo always returns an integer', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 100_000_000, noNaN: true, noDefaultInfinity: true }),
        (naira) => {
          const kobo = nairaToKobo(naira);
          expect(Number.isInteger(kobo)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.2**
   * formatAsNaira always starts with the ₦ symbol.
   */
  it('formatAsNaira always starts with ₦', () => {
    fc.assert(
      fc.property(koboArb, (kobo) => {
        const formatted = formatAsNaira(kobo);
        expect(formatted.startsWith('₦')).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.2**
   * For non-negative inputs, amounts are always non-negative.
   */
  it('non-negative inputs produce non-negative outputs', () => {
    fc.assert(
      fc.property(koboArb, (kobo) => {
        const naira = koboToNaira(kobo);
        expect(naira).toBeGreaterThanOrEqual(0);
        expect(nairaToKobo(naira)).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Generators for Normalization ────────────────────────────────────────────

/** Valid source types. */
const sourceTypeArb: fc.Arbitrary<SourceType> = fc.constantFrom(
  'RECEIPT',
  'BANK_STATEMENT',
  'POS_EXPORT',
  'MANUAL',
);

/** Positive Naira amounts (0.01 to 100,000,000). */
const positiveNairaArb = fc.double({ min: 0.01, max: 100_000_000, noNaN: true });

/** Transaction type from raw data: 'credit', 'debit', or undefined. */
const rawTypeArb: fc.Arbitrary<'credit' | 'debit' | undefined> = fc.constantFrom(
  'credit' as const,
  'debit' as const,
  undefined,
);

/** Non-empty description strings. */
const descriptionArb = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0);

/** ISO date strings within a reasonable range. */
const isoDateArb = fc
  .date({ min: new Date('2000-01-01'), max: new Date('2030-12-31') })
  .map((d) => d.toISOString());

/** Optional reference string. */
const referenceArb: fc.Arbitrary<string | undefined> = fc.option(
  fc.string({ minLength: 1, maxLength: 50 }),
  { nil: undefined },
);

/** Optional counterparty string. */
const counterpartyArb: fc.Arbitrary<string | undefined> = fc.option(
  fc.string({ minLength: 1, maxLength: 100 }),
  { nil: undefined },
);

/** Optional metadata record. */
const metadataArb: fc.Arbitrary<Record<string, unknown> | undefined> = fc.option(
  fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.jsonValue()),
  { nil: undefined },
);

/** Arbitrary RawExtractedTransaction. */
const rawTransactionArb: fc.Arbitrary<RawExtractedTransaction> = fc.record({
  date: isoDateArb,
  description: descriptionArb,
  amount: positiveNairaArb,
  type: rawTypeArb,
  reference: referenceArb,
  counterparty: counterpartyArb,
  metadata: metadataArb,
});

// ─── Property 2: Normalization Completeness ──────────────────────────────────

/**
 * **Property 2: Normalization Completeness**
 *
 * For any valid RawExtractedTransaction, normalize() should always produce
 * a valid NormalizedTransaction with all required fields populated correctly.
 *
 * **Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.6, 1.7**
 */
describe('Normalization Completeness (Property 2)', () => {
  /**
   * **Validates: Requirements 1.1**
   * amountKobo is always a positive integer.
   */
  it('amountKobo is always a positive integer', () => {
    fc.assert(
      fc.property(rawTransactionArb, sourceTypeArb, (raw, sourceType) => {
        const result = normalize(raw, sourceType);
        expect(result.amountKobo).toBeGreaterThan(0);
        expect(Number.isInteger(result.amountKobo)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.1**
   * transactionDate is always a valid Date (not NaN).
   */
  it('transactionDate is always a valid Date', () => {
    fc.assert(
      fc.property(rawTransactionArb, sourceTypeArb, (raw, sourceType) => {
        const result = normalize(raw, sourceType);
        expect(result.transactionDate).toBeInstanceOf(Date);
        expect(isNaN(result.transactionDate.getTime())).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.3**
   * transactionType is always 'INFLOW' or 'OUTFLOW'.
   */
  it('transactionType is always INFLOW or OUTFLOW', () => {
    fc.assert(
      fc.property(rawTransactionArb, sourceTypeArb, (raw, sourceType) => {
        const result = normalize(raw, sourceType);
        expect(['INFLOW', 'OUTFLOW']).toContain(result.transactionType);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.1**
   * description is always preserved from input.
   */
  it('description is always preserved from input', () => {
    fc.assert(
      fc.property(rawTransactionArb, sourceTypeArb, (raw, sourceType) => {
        const result = normalize(raw, sourceType);
        expect(result.description).toBe(raw.description);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.1**
   * rawMetadata is always an object.
   */
  it('rawMetadata is always an object', () => {
    fc.assert(
      fc.property(rawTransactionArb, sourceTypeArb, (raw, sourceType) => {
        const result = normalize(raw, sourceType);
        expect(typeof result.rawMetadata).toBe('object');
        expect(result.rawMetadata).not.toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.6, 1.7**
   * counterparty and reference are always string or null.
   */
  it('counterparty and reference are always string or null', () => {
    fc.assert(
      fc.property(rawTransactionArb, sourceTypeArb, (raw, sourceType) => {
        const result = normalize(raw, sourceType);
        expect(result.counterparty === null || typeof result.counterparty === 'string').toBe(true);
        expect(result.reference === null || typeof result.reference === 'string').toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 3: Transaction Type Determination ──────────────────────────────

/**
 * **Property 3: Transaction Type Determination**
 *
 * For any RawExtractedTransaction:
 * - If type is 'credit', result is always 'INFLOW'
 * - If type is 'debit', result is always 'OUTFLOW'
 * - If type is undefined, result is always 'OUTFLOW'
 *
 * **Validates: Requirements 1.3**
 */
describe('Transaction Type Determination (Property 3)', () => {
  /**
   * **Validates: Requirements 1.3**
   * Credit type always maps to INFLOW.
   */
  it('credit type always maps to INFLOW', () => {
    fc.assert(
      fc.property(rawTransactionArb, (raw) => {
        const creditRaw: RawExtractedTransaction = { ...raw, type: 'credit' };
        expect(determineTransactionType(creditRaw)).toBe('INFLOW');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.3**
   * Debit type always maps to OUTFLOW.
   */
  it('debit type always maps to OUTFLOW', () => {
    fc.assert(
      fc.property(rawTransactionArb, (raw) => {
        const debitRaw: RawExtractedTransaction = { ...raw, type: 'debit' };
        expect(determineTransactionType(debitRaw)).toBe('OUTFLOW');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.3**
   * Undefined type always defaults to OUTFLOW.
   */
  it('undefined type always defaults to OUTFLOW', () => {
    fc.assert(
      fc.property(rawTransactionArb, (raw) => {
        const noTypeRaw: RawExtractedTransaction = { ...raw, type: undefined };
        expect(determineTransactionType(noTypeRaw)).toBe('OUTFLOW');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.3**
   * normalize() and determineTransactionType() agree on the transaction type.
   */
  it('normalize() and determineTransactionType() agree on transaction type', () => {
    fc.assert(
      fc.property(rawTransactionArb, sourceTypeArb, (raw, sourceType) => {
        const normalized = normalize(raw, sourceType);
        const directType = determineTransactionType(raw);
        expect(normalized.transactionType).toBe(directType);
      }),
      { numRuns: 100 },
    );
  });
});
