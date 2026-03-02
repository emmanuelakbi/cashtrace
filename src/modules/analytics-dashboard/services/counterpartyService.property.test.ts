/**
 * Property-based tests for CounterpartyService.
 *
 * Feature: analytics-dashboard
 *
 * Tests Property 10 from the design document.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { RawCounterpartyAggregation } from '../types/index.js';

import { calculateCounterpartyPercentages, mapRawToBreakdowns } from './counterpartyService.js';

// ---------------------------------------------------------------------------
// Shared arbitraries
// ---------------------------------------------------------------------------

/** Positive kobo amounts up to ₦100M. */
const amountKoboArb = fc.bigInt({ min: 1n, max: 100_000_000_00n });

/** Positive transaction counts. */
const countArb = fc.integer({ min: 1, max: 10_000 });

/** Counterparty name or null. */
const counterpartyArb = fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null });

/** A single raw counterparty aggregation row. */
const rawCounterpartyArb: fc.Arbitrary<RawCounterpartyAggregation> = fc.record({
  counterparty: counterpartyArb,
  totalAmountKobo: amountKoboArb,
  transactionCount: countArb,
});

/** A list of 1–10 raw counterparty aggregation rows. */
const rawCounterpartyListArb = fc.array(rawCounterpartyArb, {
  minLength: 1,
  maxLength: 10,
});

// ---------------------------------------------------------------------------
// Property 10: Null Counterparty Grouping
// ---------------------------------------------------------------------------

describe('Feature: analytics-dashboard, Property 10: Null Counterparty Grouping', () => {
  /**
   * Validates: Requirements 5.5
   *
   * For any counterparty aggregation, all transactions with null
   * counterparty values SHALL be grouped under a single entry named
   * "Unknown", with the total amount and count reflecting all such
   * transactions.
   */
  it('null counterparties are mapped to "Unknown"', () => {
    fc.assert(
      fc.property(rawCounterpartyListArb, (rows) => {
        const breakdowns = mapRawToBreakdowns(rows);

        for (let i = 0; i < rows.length; i++) {
          const raw = rows[i]!;
          const breakdown = breakdowns[i]!;

          if (raw.counterparty === null) {
            expect(breakdown.counterparty).toBe('Unknown');
          } else {
            expect(breakdown.counterparty).toBe(raw.counterparty);
          }

          // Amount and count are always preserved
          expect(breakdown.totalAmountKobo).toBe(Number(raw.totalAmountKobo));
          expect(breakdown.transactionCount).toBe(raw.transactionCount);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('no breakdown ever has an empty or null counterparty name', () => {
    fc.assert(
      fc.property(rawCounterpartyListArb, (rows) => {
        const breakdowns = mapRawToBreakdowns(rows);

        for (const b of breakdowns) {
          expect(b.counterparty).toBeTruthy();
          expect(typeof b.counterparty).toBe('string');
          expect(b.counterparty.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('all-null counterparties produce all "Unknown" entries', () => {
    const allNullArb = fc.array(
      fc.record({
        counterparty: fc.constant(null as string | null),
        totalAmountKobo: amountKoboArb,
        transactionCount: countArb,
      }),
      { minLength: 1, maxLength: 10 },
    );

    fc.assert(
      fc.property(allNullArb, (rows) => {
        const breakdowns = mapRawToBreakdowns(rows);

        for (const b of breakdowns) {
          expect(b.counterparty).toBe('Unknown');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('percentages are correctly calculated for counterparties including Unknown', () => {
    fc.assert(
      fc.property(rawCounterpartyListArb, (rows) => {
        const breakdowns = mapRawToBreakdowns(rows);
        const total = breakdowns.reduce((sum, c) => sum + c.totalAmountKobo, 0);
        const withPercentages = calculateCounterpartyPercentages(breakdowns, total);

        if (total > 0) {
          const percentageSum = withPercentages.reduce((sum, c) => sum + c.percentageOfTotal, 0);
          expect(percentageSum).toBeGreaterThanOrEqual(99.9);
          expect(percentageSum).toBeLessThanOrEqual(100.1);
        }

        for (const c of withPercentages) {
          expect(c.percentageOfTotal).toBeGreaterThanOrEqual(0);
          expect(c.percentageOfTotal).toBeLessThanOrEqual(100);
        }
      }),
      { numRuns: 200 },
    );
  });
});
