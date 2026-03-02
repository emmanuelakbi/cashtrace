/**
 * Unit tests for TaxAnalyzer.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 *
 * @module insights/analyzers/taxAnalyzer.test
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { createWATDate } from '../../utils/timezone.js';
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

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Build a date range spanning the given number of days ending now. */
function makeDateRange(days: number): { start: Date; end: Date } {
  const end = new Date('2024-06-30T23:59:59+01:00');
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Create N revenue transactions each worth `amountKobo`. */
function makeRevenueTxs(
  count: number,
  amountKobo: number,
  businessId: string,
): ReturnType<typeof makeTransaction>[] {
  return Array.from({ length: count }, (_, i) =>
    makeTransaction({
      businessId,
      type: 'credit',
      amountKobo,
      category: 'sales',
      description: `Invoice #${i + 1}`,
      date: new Date(`2024-06-${String(i + 1).padStart(2, '0')}T10:00:00+01:00`),
    }),
  );
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('TaxAnalyzer', () => {
  let analyzer: TaxAnalyzer;

  beforeEach(() => {
    analyzer = new TaxAnalyzer();
  });

  // ── getCategory() ──────────────────────────────────────────────────────

  describe('getCategory()', () => {
    it('returns "tax"', () => {
      expect(analyzer.getCategory()).toBe('tax');
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

  // ── analyze() — Requirement 1.1 ───────────────────────────────────────

  describe('analyze() — VAT liability calculation (Req 1.1)', () => {
    it('returns no insights when there are no transactions', async () => {
      const ctx = makeAnalysisContext({ transactions: [] });
      const insights = await analyzer.analyze(ctx);
      expect(insights).toHaveLength(0);
    });

    it('returns no insights when there are only debit transactions', async () => {
      const ctx = makeAnalysisContext({
        transactions: [makeTransaction({ type: 'debit', amountKobo: 1_000_000_00 })],
      });
      const insights = await analyzer.analyze(ctx);
      expect(insights).toHaveLength(0);
    });

    it('returns no VAT or registration insights when revenue is below all thresholds', async () => {
      const businessId = 'biz-1';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId, vatRegistered: false }),
        transactions: makeRevenueTxs(2, 10_000_00, businessId), // ₦20K total
        dateRange: makeDateRange(30),
      });
      const insights = await analyzer.analyze(ctx);
      const vatOrReg = insights.filter(
        (i) => i.type === 'vat_liability' || i.type === 'vat_registration',
      );
      expect(vatOrReg).toHaveLength(0);
    });
  });

  // ── analyze() — Requirement 1.2 ───────────────────────────────────────

  describe('analyze() — quarterly VAT threshold (Req 1.2)', () => {
    it('generates high-priority insight when quarterly VAT exceeds ₦500K', async () => {
      const businessId = 'biz-vat';
      // Revenue of ₦10M → VAT = ₦750K > ₦500K threshold
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({
          id: businessId,
          vatRegistered: true,
        }),
        transactions: makeRevenueTxs(10, 100_000_000, businessId), // 10 × ₦1M = ₦10M
        dateRange: makeDateRange(90),
      });

      const insights = await analyzer.analyze(ctx);
      const vatInsight = insights.find((i) => i.type === 'vat_liability');

      expect(vatInsight).toBeDefined();
      expect(vatInsight!.category).toBe('tax');
      expect(vatInsight!.urgency).toBeGreaterThanOrEqual(80);
      expect(vatInsight!.confidence).toBeGreaterThanOrEqual(80);
    });

    it('includes VAT liability amount in Kobo in insight data', async () => {
      const businessId = 'biz-data';
      const revenuePerTx = 100_000_000; // ₦1M each
      const txCount = 10;
      const totalRevenue = revenuePerTx * txCount;
      const expectedVat = calculateVatLiability(totalRevenue);

      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId, vatRegistered: true }),
        transactions: makeRevenueTxs(txCount, revenuePerTx, businessId),
        dateRange: makeDateRange(90),
      });

      const insights = await analyzer.analyze(ctx);
      const vatInsight = insights.find((i) => i.type === 'vat_liability');

      expect(vatInsight).toBeDefined();
      expect(vatInsight!.data.vatLiabilityKobo).toBe(expectedVat);
      expect(vatInsight!.data.totalRevenueKobo).toBe(totalRevenue);
      expect(vatInsight!.financialImpact).toBe(expectedVat);
    });

    it('does not generate quarterly insight when VAT is below threshold', async () => {
      const businessId = 'biz-low';
      // Revenue of ₦5M → VAT = ₦375K < ₦500K threshold
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId, vatRegistered: true }),
        transactions: makeRevenueTxs(5, 100_000_000, businessId), // 5 × ₦1M = ₦5M
        dateRange: makeDateRange(90),
      });

      const insights = await analyzer.analyze(ctx);
      const vatInsight = insights.find((i) => i.type === 'vat_liability');
      expect(vatInsight).toBeUndefined();
    });

    it('includes action items with FIRS link', async () => {
      const businessId = 'biz-actions';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId, vatRegistered: true }),
        transactions: makeRevenueTxs(10, 100_000_000, businessId),
        dateRange: makeDateRange(90),
      });

      const insights = await analyzer.analyze(ctx);
      const vatInsight = insights.find((i) => i.type === 'vat_liability');

      expect(vatInsight).toBeDefined();
      expect(vatInsight!.actionItems.length).toBeGreaterThanOrEqual(1);
      const firsAction = vatInsight!.actionItems.find(
        (a) => (a.actionData as { url?: string }).url === 'https://firs.gov.ng',
      );
      expect(firsAction).toBeDefined();
    });
  });

  // ── analyze() — Requirement 1.3 ───────────────────────────────────────

  describe('analyze() — VAT registration threshold (Req 1.3)', () => {
    it('generates compliance insight when annual revenue approaches ₦25M', async () => {
      const businessId = 'biz-reg';
      // 90 days of ₦6M revenue → annualized ~₦24.3M → 97% of ₦25M → above 80% warning
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({
          id: businessId,
          vatRegistered: false,
        }),
        transactions: makeRevenueTxs(6, 100_000_000, businessId), // 6 × ₦1M = ₦6M
        dateRange: makeDateRange(90),
      });

      const insights = await analyzer.analyze(ctx);
      const regInsight = insights.find((i) => i.type === 'vat_registration');

      expect(regInsight).toBeDefined();
      expect(regInsight!.category).toBe('compliance');
      expect(regInsight!.data.annualRevenueEstimateKobo).toBeDefined();
      expect(regInsight!.data.percentOfThreshold).toBeDefined();
    });

    it('does not generate registration insight for VAT-registered businesses', async () => {
      const businessId = 'biz-already-reg';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({
          id: businessId,
          vatRegistered: true, // already registered
        }),
        transactions: makeRevenueTxs(10, 100_000_000, businessId),
        dateRange: makeDateRange(90),
      });

      const insights = await analyzer.analyze(ctx);
      const regInsight = insights.find((i) => i.type === 'vat_registration');
      expect(regInsight).toBeUndefined();
    });

    it('does not generate registration insight when revenue is well below threshold', async () => {
      const businessId = 'biz-small';
      // 90 days of ₦500K → annualized ~₦2M → 8% of ₦25M → well below 80%
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({
          id: businessId,
          vatRegistered: false,
        }),
        transactions: makeRevenueTxs(5, 10_000_000, businessId), // 5 × ₦100K = ₦500K
        dateRange: makeDateRange(90),
      });

      const insights = await analyzer.analyze(ctx);
      const regInsight = insights.find((i) => i.type === 'vat_registration');
      expect(regInsight).toBeUndefined();
    });
  });

  // ── Both insights can fire together ────────────────────────────────────

  describe('analyze() — combined insights', () => {
    it('can generate both VAT liability and registration insights', async () => {
      const businessId = 'biz-both';
      // 90 days of ₦20M → VAT = ₦1.5M > ₦500K, annualized ~₦81M > 80% of ₦25M
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({
          id: businessId,
          vatRegistered: false,
        }),
        transactions: makeRevenueTxs(20, 100_000_000, businessId), // 20 × ₦1M = ₦20M
        dateRange: makeDateRange(90),
      });

      const insights = await analyzer.analyze(ctx);

      expect(insights.find((i) => i.type === 'vat_liability')).toBeDefined();
      expect(insights.find((i) => i.type === 'vat_registration')).toBeDefined();
    });
  });

  // ── analyze() — Requirements 1.5, 1.7 (FIRS deadlines) ────────────────

  describe('analyze() — FIRS deadline reminders (Req 1.5, 1.7)', () => {
    it('generates tax_filing_reminder insights when within 30 days of deadline', async () => {
      const businessId = 'biz-firs';
      // Date range ending June 10 → VAT deadline June 21 (11 days away)
      const end = createWATDate(2024, 6, 10);
      const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: makeRevenueTxs(3, 10_000_00, businessId), // small revenue
        dateRange: { start, end },
      });

      const insights = await analyzer.analyze(ctx);
      const reminders = insights.filter((i) => i.type === 'tax_filing_reminder');

      expect(reminders.length).toBeGreaterThanOrEqual(1);
    });

    it('includes deadline date formatted in WAT in insight data', async () => {
      const businessId = 'biz-firs-data';
      const end = createWATDate(2024, 6, 10);
      const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: makeRevenueTxs(3, 10_000_00, businessId),
        dateRange: { start, end },
      });

      const insights = await analyzer.analyze(ctx);
      const reminders = insights.filter((i) => i.type === 'tax_filing_reminder');

      for (const reminder of reminders) {
        expect(reminder.data.deadlineDate).toBeDefined();
        expect(String(reminder.data.deadlineDate)).toMatch(/\+01:00$/);
        expect(reminder.data.deadlineShortDate).toBeDefined();
        expect(reminder.data.daysUntilDeadline).toBeDefined();
        expect(typeof reminder.data.daysUntilDeadline).toBe('number');
      }
    });

    it('sets category to tax and type to tax_filing_reminder', async () => {
      const businessId = 'biz-firs-cat';
      const end = createWATDate(2024, 6, 10);
      const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: makeRevenueTxs(3, 10_000_00, businessId),
        dateRange: { start, end },
      });

      const insights = await analyzer.analyze(ctx);
      const reminders = insights.filter((i) => i.type === 'tax_filing_reminder');

      for (const reminder of reminders) {
        expect(reminder.category).toBe('tax');
        expect(reminder.type).toBe('tax_filing_reminder');
      }
    });

    it('includes FIRS action items', async () => {
      const businessId = 'biz-firs-actions';
      const end = createWATDate(2024, 6, 10);
      const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: makeRevenueTxs(3, 10_000_00, businessId),
        dateRange: { start, end },
      });

      const insights = await analyzer.analyze(ctx);
      const reminders = insights.filter((i) => i.type === 'tax_filing_reminder');

      for (const reminder of reminders) {
        expect(reminder.actionItems.length).toBeGreaterThanOrEqual(1);
        const firsAction = reminder.actionItems.find(
          (a) => (a.actionData as { url?: string }).url === 'https://firs.gov.ng',
        );
        expect(firsAction).toBeDefined();
      }
    });

    it('does not generate reminders when no deadlines are within 30 days', async () => {
      const businessId = 'biz-no-firs';
      // Aug 21 → next VAT Sep 21 (31 days away), company June 30 next year, individual March 31
      const end = createWATDate(2024, 8, 21);
      const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: makeRevenueTxs(3, 10_000_00, businessId),
        dateRange: { start, end },
      });

      const insights = await analyzer.analyze(ctx);
      const reminders = insights.filter((i) => i.type === 'tax_filing_reminder');
      // Monthly VAT/WHT on Sep 21 is 31 days away → outside 30-day window
      // Annual deadlines are far away
      expect(reminders).toHaveLength(0);
    });

    it('sets higher urgency for deadlines within 7 days', async () => {
      const businessId = 'biz-urgent';
      // June 18 → VAT deadline June 21 = 3 days away
      const end = createWATDate(2024, 6, 18);
      const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: makeRevenueTxs(3, 10_000_00, businessId),
        dateRange: { start, end },
      });

      const insights = await analyzer.analyze(ctx);
      const vatReminder = insights.find(
        (i) => i.type === 'tax_filing_reminder' && i.data.deadlineType === 'monthly_vat_return',
      );

      expect(vatReminder).toBeDefined();
      expect(vatReminder!.urgency).toBe(95);
    });
  });
});

// ─── Pure helper tests ─────────────────────────────────────────────────────

describe('calculateVatLiability()', () => {
  it('calculates 7.5% of revenue', () => {
    expect(calculateVatLiability(100_000_000)).toBe(7_500_000); // ₦1M → ₦75K
  });

  it('returns 0 for zero revenue', () => {
    expect(calculateVatLiability(0)).toBe(0);
  });

  it('returns an integer (Kobo)', () => {
    const result = calculateVatLiability(333_333);
    expect(Number.isInteger(result)).toBe(true);
  });
});

describe('extrapolateAnnualRevenue()', () => {
  it('scales 90-day revenue to 365 days', () => {
    const result = extrapolateAnnualRevenue(1_000_000_000, 90); // ₦10M in 90 days
    // Expected: 10M * (365/90) ≈ ₦40.56M
    expect(result).toBe(Math.round((1_000_000_000 / 90) * 365));
  });

  it('returns 0 for zero-day period', () => {
    expect(extrapolateAnnualRevenue(1_000_000, 0)).toBe(0);
  });

  it('returns an integer', () => {
    const result = extrapolateAnnualRevenue(777_777, 45);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('returns the same amount for a 365-day period', () => {
    expect(extrapolateAnnualRevenue(1_000_000_000, 365)).toBe(1_000_000_000);
  });
});

describe('TaxAnalyzer constants', () => {
  it('VAT rate is 7.5%', () => {
    expect(VAT_RATE).toBe(0.075);
  });

  it('quarterly threshold is ₦500K in Kobo', () => {
    expect(QUARTERLY_VAT_THRESHOLD_KOBO).toBe(50_000_000);
  });

  it('annual registration threshold is ₦25M in Kobo', () => {
    expect(ANNUAL_VAT_REGISTRATION_THRESHOLD_KOBO).toBe(2_500_000_000);
  });

  it('warning ratio is 80%', () => {
    expect(VAT_REGISTRATION_WARNING_RATIO).toBe(0.8);
  });
});
