/**
 * Property-based tests for Tax Threshold Accuracy.
 *
 * **Property 8: Tax Threshold Accuracy**
 * For any tax exposure insight, the VAT threshold (₦25M) and quarterly
 * liability threshold (₦500K) SHALL be correctly applied.
 *
 * **Validates: Requirements 1.2, 1.3**
 *
 * @module insights/analyzers/taxAnalyzer.property.test
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { makeAnalysisContext, makeBusinessProfile, makeTransaction } from '../test/fixtures.js';

import {
  ANNUAL_VAT_REGISTRATION_THRESHOLD_KOBO,
  calculateVatLiability,
  extrapolateAnnualRevenue,
  QUARTERLY_VAT_THRESHOLD_KOBO,
  TaxAnalyzer,
  VAT_RATE,
  VAT_REGISTRATION_WARNING_RATIO,
} from './taxAnalyzer.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/** Arbitrary non-negative Kobo revenue (up to ₦100M = 10_000_000_000 Kobo). */
const revenueKoboArb = fc.integer({ min: 0, max: 10_000_000_000 });

/** Arbitrary positive period in days (1–365). */
const periodDaysArb = fc.integer({ min: 1, max: 365 });

/**
 * Build an AnalysisContext with N credit transactions totalling `totalRevenueKobo`
 * over `periodDays`, with the given business profile overrides.
 */
function buildContext(
  totalRevenueKobo: number,
  periodDays: number,
  vatRegistered: boolean,
): ReturnType<typeof makeAnalysisContext> {
  const businessId = 'prop-test-biz';
  const end = new Date('2024-06-30T23:59:59+01:00');
  const start = new Date(end.getTime() - periodDays * 24 * 60 * 60 * 1000);

  // Split revenue across a few transactions to be realistic
  const txCount = Math.max(1, Math.min(10, Math.ceil(totalRevenueKobo / 100_000_000)));
  const perTx = Math.floor(totalRevenueKobo / txCount);
  const remainder = totalRevenueKobo - perTx * txCount;

  const transactions = Array.from({ length: txCount }, (_, i) =>
    makeTransaction({
      businessId,
      type: 'credit',
      amountKobo: i === 0 ? perTx + remainder : perTx,
      date: new Date(
        start.getTime() + ((end.getTime() - start.getTime()) / (txCount + 1)) * (i + 1),
      ),
    }),
  );

  return makeAnalysisContext({
    businessId,
    businessProfile: makeBusinessProfile({ id: businessId, vatRegistered }),
    transactions,
    dateRange: { start, end },
    previousInsights: [],
  });
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Tax Threshold Accuracy (Property 8)', () => {
  const analyzer = new TaxAnalyzer();

  // ── Sub-property 1: calculateVatLiability always returns an integer ────

  /**
   * **Validates: Requirements 1.2**
   * calculateVatLiability always returns an integer (Kobo precision).
   */
  it('calculateVatLiability always returns an integer', () => {
    fc.assert(
      fc.property(revenueKoboArb, (revenue) => {
        const vat = calculateVatLiability(revenue);
        expect(Number.isInteger(vat)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  // ── Sub-property 2: calculateVatLiability is monotonic ─────────────────

  /**
   * **Validates: Requirements 1.2**
   * calculateVatLiability is monotonic — higher revenue → higher or equal VAT.
   */
  it('calculateVatLiability is monotonic (higher revenue → higher or equal VAT)', () => {
    fc.assert(
      fc.property(revenueKoboArb, revenueKoboArb, (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(calculateVatLiability(hi)).toBeGreaterThanOrEqual(calculateVatLiability(lo));
      }),
      { numRuns: 200 },
    );
  });

  // ── Sub-property 3: quarterly VAT > ₦500K → vat_liability insight ─────

  /**
   * **Validates: Requirements 1.2**
   * When quarterly VAT exceeds the ₦500K threshold, analyze() always
   * produces a vat_liability insight.
   */
  it('generates vat_liability insight when quarterly VAT > ₦500K threshold', () => {
    // Revenue that guarantees VAT > QUARTERLY_VAT_THRESHOLD_KOBO
    // VAT = Math.round(revenue * 0.075), so we need Math.round(revenue * 0.075) > threshold
    // Find the smallest revenue where this holds, then filter to be safe.
    const aboveThresholdArb = fc
      .integer({ min: Math.ceil(QUARTERLY_VAT_THRESHOLD_KOBO / VAT_RATE), max: 10_000_000_000 })
      .filter((r) => calculateVatLiability(r) > QUARTERLY_VAT_THRESHOLD_KOBO);

    fc.assert(
      fc.asyncProperty(aboveThresholdArb, periodDaysArb, async (revenue, days) => {
        const ctx = buildContext(revenue, days, true);
        const insights = await analyzer.analyze(ctx);
        const vatInsight = insights.find((i) => i.type === 'vat_liability');

        expect(vatInsight).toBeDefined();
        expect(vatInsight!.category).toBe('tax');
        expect(vatInsight!.data.vatLiabilityKobo).toBeGreaterThan(QUARTERLY_VAT_THRESHOLD_KOBO);
      }),
      { numRuns: 100 },
    );
  });

  // ── Sub-property 4: quarterly VAT <= ₦500K → no vat_liability insight ─

  /**
   * **Validates: Requirements 1.2**
   * When quarterly VAT is at or below the ₦500K threshold, analyze() never
   * produces a vat_liability insight.
   */
  it('does not generate vat_liability insight when quarterly VAT <= ₦500K threshold', () => {
    // Revenue that guarantees VAT <= QUARTERLY_VAT_THRESHOLD_KOBO
    // VAT = Math.round(revenue * 0.075), filter to ensure at-or-below threshold.
    const belowThresholdArb = fc
      .integer({ min: 0, max: Math.ceil(QUARTERLY_VAT_THRESHOLD_KOBO / VAT_RATE) })
      .filter((r) => calculateVatLiability(r) <= QUARTERLY_VAT_THRESHOLD_KOBO);

    fc.assert(
      fc.asyncProperty(belowThresholdArb, periodDaysArb, async (revenue, days) => {
        const ctx = buildContext(revenue, days, true);
        const insights = await analyzer.analyze(ctx);
        const vatInsight = insights.find((i) => i.type === 'vat_liability');

        expect(vatInsight).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  // ── Sub-property 5: annual revenue >= 80% of ₦25M + not registered → vat_registration ─

  /**
   * **Validates: Requirements 1.3**
   * When extrapolated annual revenue >= 80% of ₦25M and business is not
   * VAT-registered, analyze() produces a vat_registration insight.
   */
  it('generates vat_registration insight when annual revenue >= 80% of ₦25M and not registered', () => {
    const warningThreshold = Math.round(
      ANNUAL_VAT_REGISTRATION_THRESHOLD_KOBO * VAT_REGISTRATION_WARNING_RATIO,
    );

    // We need: extrapolateAnnualRevenue(revenue, days) >= warningThreshold
    // i.e. (revenue / days) * 365 >= warningThreshold
    // i.e. revenue >= warningThreshold * days / 365
    // Generate days first, then compute minimum revenue for that period.
    fc.assert(
      fc.asyncProperty(periodDaysArb, fc.integer({ min: 0, max: 100 }), async (days, extra) => {
        const minRevenue = Math.ceil((warningThreshold * days) / 365);
        // Add a small extra to ensure we're above the threshold after rounding
        const revenue = minRevenue + extra;

        // Verify our generator actually produces above-threshold values
        const annualEstimate = extrapolateAnnualRevenue(revenue, days);
        if (annualEstimate < warningThreshold) return; // skip edge cases from rounding

        const ctx = buildContext(revenue, days, false);
        const insights = await analyzer.analyze(ctx);
        const regInsight = insights.find((i) => i.type === 'vat_registration');

        expect(regInsight).toBeDefined();
        expect(regInsight!.category).toBe('compliance');
      }),
      { numRuns: 100 },
    );
  });

  // ── Sub-property 6: extrapolateAnnualRevenue always returns an integer ─

  /**
   * **Validates: Requirements 1.2, 1.3**
   * extrapolateAnnualRevenue always returns an integer (Kobo precision).
   */
  it('extrapolateAnnualRevenue always returns an integer', () => {
    fc.assert(
      fc.property(revenueKoboArb, periodDaysArb, (revenue, days) => {
        const result = extrapolateAnnualRevenue(revenue, days);
        expect(Number.isInteger(result)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
