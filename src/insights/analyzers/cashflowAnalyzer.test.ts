/**
 * Unit tests for CashflowAnalyzer.
 *
 * **Validates: Requirements 3.1, 3.5, 3.6**
 *
 * @module insights/analyzers/cashflowAnalyzer.test
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { makeAnalysisContext, makeBusinessProfile, makeTransaction } from '../test/fixtures.js';

import {
  averageSeasonalMultiplier,
  CashflowAnalyzer,
  detectRecurringPatterns,
  getSeasonalMultiplier,
  MIN_TRANSACTIONS_FOR_ANALYSIS,
  projectCashflow,
  PROJECTION_HORIZONS,
  SEASONAL_MULTIPLIERS,
} from './cashflowAnalyzer.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Build a date range spanning the given number of days ending at a fixed date. */
function makeDateRange(days: number): { start: Date; end: Date } {
  const end = new Date('2024-06-30T23:59:59+01:00');
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Create N transactions of a given type, each worth `amountKobo`. */
function makeTxs(
  count: number,
  type: 'credit' | 'debit',
  amountKobo: number,
  businessId: string,
  counterparty = 'Vendor A',
): ReturnType<typeof makeTransaction>[] {
  return Array.from({ length: count }, (_, i) =>
    makeTransaction({
      businessId,
      type,
      amountKobo,
      counterparty,
      category: type === 'credit' ? 'sales' : 'expenses',
      description: `Tx #${i + 1}`,
      date: new Date(`2024-06-${String(i + 1).padStart(2, '0')}T10:00:00+01:00`),
    }),
  );
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('CashflowAnalyzer', () => {
  let analyzer: CashflowAnalyzer;

  beforeEach(() => {
    analyzer = new CashflowAnalyzer();
  });

  // ── getCategory() ──────────────────────────────────────────────────────

  describe('getCategory()', () => {
    it('returns "cashflow"', () => {
      expect(analyzer.getCategory()).toBe('cashflow');
    });
  });

  // ── getRequiredData() ──────────────────────────────────────────────────

  describe('getRequiredData()', () => {
    it('requires transaction and business data', () => {
      const requirements = analyzer.getRequiredData();
      expect(requirements).toHaveLength(2);
      expect(requirements.some((r) => r.source === 'transaction-engine')).toBe(true);
      expect(requirements.some((r) => r.source === 'business-management')).toBe(true);
    });
  });

  // ── analyze() — insufficient data ──────────────────────────────────────

  describe('analyze() — insufficient data', () => {
    it('returns no insights when there are no transactions', async () => {
      const ctx = makeAnalysisContext({ transactions: [] });
      const insights = await analyzer.analyze(ctx);
      expect(insights).toHaveLength(0);
    });

    it('returns no insights when transactions are below minimum threshold', async () => {
      const businessId = 'biz-few';
      const ctx = makeAnalysisContext({
        businessId,
        transactions: makeTxs(MIN_TRANSACTIONS_FOR_ANALYSIS - 1, 'debit', 100_000_00, businessId),
        dateRange: makeDateRange(30),
      });
      const insights = await analyzer.analyze(ctx);
      expect(insights).toHaveLength(0);
    });
  });

  // ── analyze() — Requirement 3.1: 30/60/90 day projections ─────────────

  describe('analyze() — cashflow projections (Req 3.1)', () => {
    it('generates insight when projected cashflow is negative', async () => {
      const businessId = 'biz-negative';
      // Income: 3 × ₦100K = ₦300K over 30 days → ₦10K/day
      // Expenses: 5 × ₦200K = ₦1M over 30 days → ₦33.3K/day
      // Net daily: -₦23.3K → negative at all horizons
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId, sector: 'retail' }),
        transactions: [
          ...makeTxs(3, 'credit', 100_000_00, businessId, 'Customer A'),
          ...makeTxs(5, 'debit', 200_000_00, businessId, 'Supplier B'),
        ],
        dateRange: makeDateRange(30),
      });

      const insights = await analyzer.analyze(ctx);
      expect(insights.length).toBeGreaterThanOrEqual(1);

      const cashflowInsight = insights.find((i) => i.type === 'cashflow_risk');
      expect(cashflowInsight).toBeDefined();
      expect(cashflowInsight!.category).toBe('cashflow');
    });

    it('includes projection data for all three horizons', async () => {
      const businessId = 'biz-proj';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId, sector: 'services' }),
        transactions: [
          ...makeTxs(3, 'credit', 50_000_00, businessId, 'Client A'),
          ...makeTxs(5, 'debit', 100_000_00, businessId, 'Vendor B'),
        ],
        dateRange: makeDateRange(30),
      });

      const insights = await analyzer.analyze(ctx);
      const cashflowInsight = insights.find((i) => i.type === 'cashflow_risk');
      expect(cashflowInsight).toBeDefined();

      const projections = cashflowInsight!.data.projections as Array<{
        horizonDays: number;
        netCashflowKobo: number;
      }>;
      expect(projections).toHaveLength(3);

      const horizons = projections.map((p) => p.horizonDays);
      expect(horizons).toEqual([30, 60, 90]);
    });

    it('does not generate insight when cashflow is positive', async () => {
      const businessId = 'biz-positive';
      // Income: 5 × ₦500K = ₦2.5M over 30 days
      // Expenses: 3 × ₦100K = ₦300K over 30 days
      // Net daily: positive
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId, sector: 'retail' }),
        transactions: [
          ...makeTxs(5, 'credit', 500_000_00, businessId, 'Customer A'),
          ...makeTxs(3, 'debit', 100_000_00, businessId, 'Supplier B'),
        ],
        dateRange: makeDateRange(30),
      });

      const insights = await analyzer.analyze(ctx);
      const cashflowInsight = insights.find((i) => i.type === 'cashflow_risk');
      expect(cashflowInsight).toBeUndefined();
    });
  });

  // ── analyze() — Requirements 3.2, 3.3: risk alert urgency levels ─────

  describe('analyze() — risk alert urgency (Req 3.2, 3.3)', () => {
    it('sets urgency to 95 (critical) when 30-day projection is negative', async () => {
      const businessId = 'biz-critical';
      // Heavy expenses → negative at all horizons, earliest is 30 days
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId, sector: 'healthcare' }),
        transactions: [
          ...makeTxs(3, 'credit', 100_000_00, businessId, 'Customer A'),
          ...makeTxs(5, 'debit', 200_000_00, businessId, 'Supplier B'),
        ],
        dateRange: makeDateRange(30),
      });

      const insights = await analyzer.analyze(ctx);
      const cashflowInsight = insights.find((i) => i.type === 'cashflow_risk');
      expect(cashflowInsight).toBeDefined();
      expect(cashflowInsight!.urgency).toBe(95);
    });

    it('sets urgency to 75 (high) when 60-day is negative but 30-day is positive', async () => {
      const businessId = 'biz-high';
      // Slightly more income than expenses daily so 30-day is positive,
      // but seasonal multiplier for healthcare is ~1.0 so we need a scenario
      // where the 30-day net is positive but 60-day net is negative.
      // We use a sector with declining seasonal multiplier to achieve this.
      //
      // Income: 5 × ₦100K = ₦500K over 30 days → ₦16,666/day
      // Expenses: 5 × ₦95K = ₦475K over 30 days → ₦15,833/day
      // Net daily: +₦833/day → 30-day: +₦25K (positive)
      // But seasonal multiplier may reduce income at 60 days making it negative.
      //
      // Actually, let's use projectCashflow directly to find the right amounts.
      // We need: 30-day positive, 60-day negative.
      // With healthcare (multiplier ~1.0), income scales linearly.
      // So we need income/day slightly > expenses/day at 30 days but
      // the seasonal multiplier to drop income at 60 days.
      //
      // Simpler approach: use a sector where the seasonal multiplier drops
      // significantly in the months ahead. For education sector in July
      // (month 7 = 0.7), the multiplier is low.
      //
      // Let's set dateRange ending in June, so 30-day projection covers July (0.7)
      // and 60-day covers July-August (0.7, 0.7).
      // Income daily * 30 * 0.7 vs expenses daily * 30
      // We need income * 0.7 > expenses for 30 days (positive)
      // but income * avg(0.7, 0.7) < expenses for 60 days (negative)
      // That won't work since 0.7 is the same.
      //
      // Better: make the daily net slightly negative so that at 30 days
      // the seasonal boost keeps it positive, but at 60 days it goes negative.
      // Use retail in November (1.15) → December (1.3) → January (0.8)
      // dateRange ending in November, 30-day covers Dec (1.3) → positive
      // 60-day covers Dec+Jan avg → lower multiplier → could go negative
      //
      // Actually the simplest approach: directly construct transactions where
      // the math works out. With healthcare (all ~1.0 multipliers):
      // If daily income = 10K and daily expenses = 10.5K
      // 30-day: income = 300K * ~1.0 = 300K, expenses = 315K → net = -15K (negative!)
      // That's negative at 30 days too.
      //
      // The key insight: with a flat multiplier, if 30-day is positive then
      // 60-day and 90-day will also be positive (linear scaling).
      // We NEED a declining seasonal multiplier to make 60-day negative.
      //
      // Use education sector with dateRange ending June 30:
      // 30-day projection (July): multiplier = 0.7
      // 60-day projection (July-Aug): avg multiplier ≈ 0.7
      // 90-day projection (July-Sep): avg multiplier ≈ (0.7+0.7+1.3)/3 ≈ 0.9
      //
      // With education, July=0.7, Aug=0.7, Sep=1.3
      // If daily income = 15K, daily expenses = 10K
      // 30-day: income = 15K * 30 * 0.7 = 315K, expenses = 300K → net = +15K ✓
      // 60-day: income = 15K * 60 * 0.7 = 630K, expenses = 600K → net = +30K ✗ still positive
      //
      // We need expenses to outpace seasonal-adjusted income.
      // daily income = 10K, daily expenses = 8K
      // 30-day: income = 10K * 30 * 0.7 = 210K, expenses = 240K → net = -30K ✗ negative at 30
      //
      // Let's try: daily income = 12K, daily expenses = 8K
      // 30-day: income = 12K * 30 * 0.7 = 252K, expenses = 240K → net = +12K ✓
      // 60-day: income = 12K * 60 * 0.7 = 504K, expenses = 480K → net = +24K ✗ still positive
      //
      // The problem is that with a constant multiplier across both months,
      // the ratio stays the same. We need the multiplier to DROP between
      // the 30-day and 60-day windows.
      //
      // Use retail with dateRange ending Nov 30:
      // 30-day (Dec): multiplier = 1.3
      // 60-day (Dec-Jan): avg ≈ (1.3*31 + 0.8*29)/60 ≈ 1.06
      // 90-day (Dec-Mar): lower avg
      //
      // daily income = 10K, daily expenses = 12K
      // 30-day: income = 10K * 30 * 1.3 = 390K, expenses = 360K → net = +30K ✓
      // 60-day: income = 10K * 60 * 1.06 = 636K, expenses = 720K → net = -84K ✓ negative!
      //
      // That works! Let's use this scenario.
      const dateRangeEnd = new Date('2024-11-30T23:59:59+01:00');
      const dateRangeStart = new Date(dateRangeEnd.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Over 30 days: total income = 5 * 60K = 300K, total expenses = 5 * 72K = 360K
      // daily income = 10K, daily expenses = 12K
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId, sector: 'retail' }),
        transactions: [
          ...makeTxs(5, 'credit', 60_000_00, businessId, 'Customer A'),
          ...makeTxs(5, 'debit', 72_000_00, businessId, 'Supplier B'),
        ],
        dateRange: { start: dateRangeStart, end: dateRangeEnd },
      });

      const insights = await analyzer.analyze(ctx);
      const cashflowInsight = insights.find((i) => i.type === 'cashflow_risk');
      expect(cashflowInsight).toBeDefined();

      // Verify 30-day is positive (due to Dec 1.3 multiplier)
      const projections = cashflowInsight!.data.projections as Array<{
        horizonDays: number;
        netCashflowKobo: number;
      }>;
      const proj30 = projections.find((p) => p.horizonDays === 30);
      const proj60 = projections.find((p) => p.horizonDays === 60);
      expect(proj30!.netCashflowKobo).toBeGreaterThanOrEqual(0);
      expect(proj60!.netCashflowKobo).toBeLessThan(0);
      expect(cashflowInsight!.urgency).toBe(75);
    });

    it('sets urgency to 60 (medium) when only 90-day projection is negative', async () => {
      const businessId = 'biz-medium';
      // We need 30-day positive, 60-day positive, 90-day negative.
      // Use retail with dateRange ending Oct 31:
      // 30-day (Nov): multiplier = 1.15
      // 60-day (Nov-Dec): avg ≈ (1.15*30 + 1.3*30)/60 ≈ 1.225
      // 90-day (Nov-Jan): avg ≈ (1.15*30 + 1.3*31 + 0.8*29)/90 ≈ 1.10
      //
      // daily income = 10K, daily expenses = 11.5K
      // 30-day: income = 10K * 30 * 1.15 = 345K, expenses = 345K → net ≈ 0
      // Need income slightly higher to be positive at 30 and 60 but negative at 90.
      //
      // daily income = 10K, daily expenses = 11K
      // 30-day: income = 10K * 30 * 1.15 = 345K, expenses = 330K → net = +15K ✓
      // 60-day: income = 10K * 60 * 1.225 = 735K, expenses = 660K → net = +75K ✓
      // 90-day: income = 10K * 90 * 1.10 = 990K, expenses = 990K → net ≈ 0
      //
      // Need expenses a bit higher. daily expenses = 12K
      // 30-day: income = 300K * 1.15 = 345K, expenses = 360K → net = -15K ✗
      //
      // Tricky. Let's try a different approach with education ending in March:
      // 30-day (Apr): 0.8
      // 60-day (Apr-May): avg ≈ (0.8*30 + 1.1*30)/60 = 0.95
      // 90-day (Apr-Jun): avg ≈ (0.8*30 + 1.1*30 + 1.0*30)/90 = 0.967
      //
      // Hmm, the multiplier goes UP not down. We need it to go down over time.
      //
      // Use education ending in April:
      // 30-day (May): 1.1
      // 60-day (May-Jun): avg ≈ (1.1*31 + 1.0*29)/60 ≈ 1.05
      // 90-day (May-Jul): avg ≈ (1.1*31 + 1.0*30 + 0.7*29)/90 ≈ 0.95
      //
      // daily income = 10K, daily expenses = 10.2K
      // 30-day: income = 10K * 30 * 1.1 = 330K, expenses = 306K → net = +24K ✓
      // 60-day: income = 10K * 60 * 1.05 = 630K, expenses = 612K → net = +18K ✓
      // 90-day: income = 10K * 90 * 0.95 = 855K, expenses = 918K → net = -63K ✓
      //
      const dateRangeEnd = new Date('2024-04-30T23:59:59+01:00');
      const dateRangeStart = new Date(dateRangeEnd.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Over 30 days: total income = 5 * 60K = 300K, total expenses = 5 * 61.2K = 306K
      // daily income = 10K, daily expenses = 10.2K
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId, sector: 'education' }),
        transactions: [
          ...makeTxs(5, 'credit', 60_000_00, businessId, 'Customer A'),
          ...makeTxs(5, 'debit', 61_200_00, businessId, 'Supplier B'),
        ],
        dateRange: { start: dateRangeStart, end: dateRangeEnd },
      });

      const insights = await analyzer.analyze(ctx);
      const cashflowInsight = insights.find((i) => i.type === 'cashflow_risk');
      expect(cashflowInsight).toBeDefined();

      // Verify 30-day and 60-day are positive, 90-day is negative
      const projections = cashflowInsight!.data.projections as Array<{
        horizonDays: number;
        netCashflowKobo: number;
      }>;
      const proj30 = projections.find((p) => p.horizonDays === 30);
      const proj60 = projections.find((p) => p.horizonDays === 60);
      const proj90 = projections.find((p) => p.horizonDays === 90);
      expect(proj30!.netCashflowKobo).toBeGreaterThanOrEqual(0);
      expect(proj60!.netCashflowKobo).toBeGreaterThanOrEqual(0);
      expect(proj90!.netCashflowKobo).toBeLessThan(0);
      expect(cashflowInsight!.urgency).toBe(60);
    });
  });

  // ── analyze() — Requirement 3.5: recurring patterns ────────────────────

  describe('analyze() — recurring patterns (Req 3.5)', () => {
    it('includes top recurring expenses in insight data', async () => {
      const businessId = 'biz-recurring';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId, sector: 'retail' }),
        transactions: [
          ...makeTxs(3, 'credit', 50_000_00, businessId, 'Customer A'),
          // Recurring expense from same vendor
          ...makeTxs(4, 'debit', 200_000_00, businessId, 'Rent Co'),
          ...makeTxs(3, 'debit', 100_000_00, businessId, 'Utility Co'),
        ],
        dateRange: makeDateRange(30),
      });

      const insights = await analyzer.analyze(ctx);
      const cashflowInsight = insights.find((i) => i.type === 'cashflow_risk');
      expect(cashflowInsight).toBeDefined();

      const topExpenses = cashflowInsight!.data.topRecurringExpenses as Array<{
        identifier: string;
        averageAmountKobo: number;
      }>;
      expect(topExpenses).toBeDefined();
      expect(topExpenses.length).toBeGreaterThanOrEqual(1);
      // Rent Co should be first (higher amount)
      expect(topExpenses[0]!.identifier).toBe('Rent Co');
    });
  });

  // ── analyze() — Requirement 3.6: seasonal variations ───────────────────

  describe('analyze() — seasonal variations (Req 3.6)', () => {
    it('includes seasonal multiplier in projection data', async () => {
      const businessId = 'biz-seasonal';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId, sector: 'retail' }),
        transactions: [
          ...makeTxs(3, 'credit', 50_000_00, businessId, 'Customer A'),
          ...makeTxs(5, 'debit', 100_000_00, businessId, 'Vendor B'),
        ],
        dateRange: makeDateRange(30),
      });

      const insights = await analyzer.analyze(ctx);
      const cashflowInsight = insights.find((i) => i.type === 'cashflow_risk');
      expect(cashflowInsight).toBeDefined();

      const projections = cashflowInsight!.data.projections as Array<{
        seasonalMultiplier: number;
      }>;
      for (const proj of projections) {
        expect(proj.seasonalMultiplier).toBeGreaterThan(0);
      }
    });

    it('records sector in insight data', async () => {
      const businessId = 'biz-sector';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId, sector: 'agriculture' }),
        transactions: [
          ...makeTxs(3, 'credit', 50_000_00, businessId, 'Customer A'),
          ...makeTxs(5, 'debit', 100_000_00, businessId, 'Vendor B'),
        ],
        dateRange: makeDateRange(30),
      });

      const insights = await analyzer.analyze(ctx);
      const cashflowInsight = insights.find((i) => i.type === 'cashflow_risk');
      expect(cashflowInsight).toBeDefined();
      expect(cashflowInsight!.data.sector).toBe('agriculture');
    });
  });

  // ── analyze() — action items and financial impact ──────────────────────

  describe('analyze() — insight structure', () => {
    it('includes action items', async () => {
      const businessId = 'biz-actions';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId, sector: 'retail' }),
        transactions: [
          ...makeTxs(3, 'credit', 50_000_00, businessId, 'Customer A'),
          ...makeTxs(5, 'debit', 100_000_00, businessId, 'Vendor B'),
        ],
        dateRange: makeDateRange(30),
      });

      const insights = await analyzer.analyze(ctx);
      const cashflowInsight = insights.find((i) => i.type === 'cashflow_risk');
      expect(cashflowInsight).toBeDefined();
      expect(cashflowInsight!.actionItems.length).toBeGreaterThanOrEqual(1);
    });

    it('sets financial impact to the shortfall amount in Kobo', async () => {
      const businessId = 'biz-impact';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId, sector: 'retail' }),
        transactions: [
          ...makeTxs(3, 'credit', 50_000_00, businessId, 'Customer A'),
          ...makeTxs(5, 'debit', 100_000_00, businessId, 'Vendor B'),
        ],
        dateRange: makeDateRange(30),
      });

      const insights = await analyzer.analyze(ctx);
      const cashflowInsight = insights.find((i) => i.type === 'cashflow_risk');
      expect(cashflowInsight).toBeDefined();
      expect(cashflowInsight!.financialImpact).toBeGreaterThan(0);
      expect(Number.isInteger(cashflowInsight!.financialImpact)).toBe(true);
    });

    it('all amounts are integers (Kobo)', async () => {
      const businessId = 'biz-kobo';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId, sector: 'retail' }),
        transactions: [
          ...makeTxs(3, 'credit', 50_000_00, businessId, 'Customer A'),
          ...makeTxs(5, 'debit', 100_000_00, businessId, 'Vendor B'),
        ],
        dateRange: makeDateRange(30),
      });

      const insights = await analyzer.analyze(ctx);
      const cashflowInsight = insights.find((i) => i.type === 'cashflow_risk');
      expect(cashflowInsight).toBeDefined();

      const projections = cashflowInsight!.data.projections as Array<{
        projectedIncomeKobo: number;
        projectedExpensesKobo: number;
        netCashflowKobo: number;
      }>;
      for (const proj of projections) {
        expect(Number.isInteger(proj.projectedIncomeKobo)).toBe(true);
        expect(Number.isInteger(proj.projectedExpensesKobo)).toBe(true);
        expect(Number.isInteger(proj.netCashflowKobo)).toBe(true);
      }
    });
  });
});

// ─── Pure helper tests ─────────────────────────────────────────────────────

describe('getSeasonalMultiplier()', () => {
  it('returns the correct multiplier for retail in December', () => {
    expect(getSeasonalMultiplier('retail', 12)).toBe(1.3);
  });

  it('returns the correct multiplier for agriculture in October', () => {
    expect(getSeasonalMultiplier('agriculture', 10)).toBe(1.3);
  });

  it('returns 1.0 for healthcare in most months', () => {
    expect(getSeasonalMultiplier('healthcare', 5)).toBe(1.0);
  });
});

describe('averageSeasonalMultiplier()', () => {
  it('returns a positive number', () => {
    const result = averageSeasonalMultiplier('retail', new Date('2024-06-15'), 30);
    expect(result).toBeGreaterThan(0);
  });

  it('returns 1.0 for zero horizon', () => {
    const result = averageSeasonalMultiplier('retail', new Date('2024-06-15'), 0);
    expect(result).toBe(1.0);
  });

  it('returns a weighted average across months for multi-month horizons', () => {
    // 90-day horizon starting mid-June should span June, July, August, September
    const result = averageSeasonalMultiplier('retail', new Date('2024-06-15'), 90);
    // Should be between the min and max of those months
    expect(result).toBeGreaterThan(0.9);
    expect(result).toBeLessThan(1.1);
  });
});

describe('detectRecurringPatterns()', () => {
  it('returns empty array for no transactions', () => {
    expect(detectRecurringPatterns([])).toHaveLength(0);
  });

  it('returns empty array for single transactions per counterparty', () => {
    const txs = [
      makeTransaction({ counterparty: 'A', type: 'debit' }),
      makeTransaction({ counterparty: 'B', type: 'debit' }),
    ];
    expect(detectRecurringPatterns(txs)).toHaveLength(0);
  });

  it('detects recurring patterns from same counterparty', () => {
    const txs = [
      makeTransaction({
        counterparty: 'Rent Co',
        type: 'debit',
        amountKobo: 500_000_00,
        date: new Date('2024-06-01'),
      }),
      makeTransaction({
        counterparty: 'Rent Co',
        type: 'debit',
        amountKobo: 500_000_00,
        date: new Date('2024-07-01'),
      }),
    ];
    const patterns = detectRecurringPatterns(txs);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.identifier).toBe('Rent Co');
    expect(patterns[0]!.type).toBe('debit');
    expect(patterns[0]!.occurrences).toBe(2);
  });

  it('calculates average amount across occurrences', () => {
    const txs = [
      makeTransaction({
        counterparty: 'Utility',
        type: 'debit',
        amountKobo: 100_000,
        date: new Date('2024-06-01'),
      }),
      makeTransaction({
        counterparty: 'Utility',
        type: 'debit',
        amountKobo: 200_000,
        date: new Date('2024-07-01'),
      }),
    ];
    const patterns = detectRecurringPatterns(txs);
    expect(patterns[0]!.averageAmountKobo).toBe(150_000);
  });

  it('separates credit and debit patterns for same counterparty', () => {
    const txs = [
      makeTransaction({ counterparty: 'Partner', type: 'credit', date: new Date('2024-06-01') }),
      makeTransaction({ counterparty: 'Partner', type: 'credit', date: new Date('2024-07-01') }),
      makeTransaction({ counterparty: 'Partner', type: 'debit', date: new Date('2024-06-15') }),
      makeTransaction({ counterparty: 'Partner', type: 'debit', date: new Date('2024-07-15') }),
    ];
    const patterns = detectRecurringPatterns(txs);
    expect(patterns).toHaveLength(2);
  });
});

describe('projectCashflow()', () => {
  it('returns integer amounts for all projections', () => {
    const txs = [
      makeTransaction({ type: 'credit', amountKobo: 333_333 }),
      makeTransaction({ type: 'debit', amountKobo: 111_111 }),
      makeTransaction({ type: 'credit', amountKobo: 222_222 }),
    ];
    const result = projectCashflow(txs, makeDateRange(30), 'retail', 60);
    expect(Number.isInteger(result.projectedIncomeKobo)).toBe(true);
    expect(Number.isInteger(result.projectedExpensesKobo)).toBe(true);
    expect(Number.isInteger(result.netCashflowKobo)).toBe(true);
  });

  it('projects positive net when income exceeds expenses', () => {
    const txs = [
      makeTransaction({ type: 'credit', amountKobo: 1_000_000 }),
      makeTransaction({ type: 'debit', amountKobo: 100_000 }),
    ];
    const result = projectCashflow(txs, makeDateRange(30), 'services', 30);
    expect(result.netCashflowKobo).toBeGreaterThan(0);
  });

  it('projects negative net when expenses exceed income', () => {
    const txs = [
      makeTransaction({ type: 'credit', amountKobo: 100_000 }),
      makeTransaction({ type: 'debit', amountKobo: 1_000_000 }),
    ];
    const result = projectCashflow(txs, makeDateRange(30), 'services', 30);
    expect(result.netCashflowKobo).toBeLessThan(0);
  });

  it('scales projections proportionally to horizon length', () => {
    const txs = [
      makeTransaction({ type: 'credit', amountKobo: 300_000_00 }),
      makeTransaction({ type: 'debit', amountKobo: 100_000_00 }),
    ];
    const dateRange = makeDateRange(30);
    const proj30 = projectCashflow(txs, dateRange, 'healthcare', 30);
    const proj90 = projectCashflow(txs, dateRange, 'healthcare', 90);

    // Healthcare has ~1.0 multiplier, so 90-day should be ~3x of 30-day
    expect(proj90.projectedIncomeKobo).toBeCloseTo(proj30.projectedIncomeKobo * 3, -2);
    expect(proj90.projectedExpensesKobo).toBe(proj30.projectedExpensesKobo * 3);
  });

  it('includes seasonal multiplier in result', () => {
    const txs = [
      makeTransaction({ type: 'credit', amountKobo: 100_000 }),
      makeTransaction({ type: 'debit', amountKobo: 50_000 }),
    ];
    const result = projectCashflow(txs, makeDateRange(30), 'retail', 30);
    expect(result.seasonalMultiplier).toBeGreaterThan(0);
  });

  it('returns all three PROJECTION_HORIZONS values', () => {
    expect(PROJECTION_HORIZONS).toEqual([30, 60, 90]);
  });
});

describe('SEASONAL_MULTIPLIERS', () => {
  it('has entries for all Nigerian sectors', () => {
    const sectors: Array<keyof typeof SEASONAL_MULTIPLIERS> = [
      'retail',
      'services',
      'manufacturing',
      'agriculture',
      'technology',
      'healthcare',
      'education',
      'logistics',
      'hospitality',
    ];
    for (const sector of sectors) {
      expect(SEASONAL_MULTIPLIERS[sector]).toBeDefined();
      // Each sector should have 12 months
      expect(Object.keys(SEASONAL_MULTIPLIERS[sector])).toHaveLength(12);
    }
  });

  it('all multipliers are positive numbers', () => {
    for (const sector of Object.keys(SEASONAL_MULTIPLIERS) as Array<
      keyof typeof SEASONAL_MULTIPLIERS
    >) {
      for (const month of Object.keys(SEASONAL_MULTIPLIERS[sector])) {
        const value = SEASONAL_MULTIPLIERS[sector][Number(month)];
        expect(value).toBeGreaterThan(0);
      }
    }
  });
});
