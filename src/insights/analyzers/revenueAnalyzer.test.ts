/**
 * Unit tests for RevenueAnalyzer.
 *
 * **Validates: Requirements 5.1, 5.3**
 *
 * @module insights/analyzers/revenueAnalyzer.test
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { makeAnalysisContext, makeBusinessProfile, makeTransaction } from '../test/fixtures.js';

import {
  detectSeasonalPattern,
  groupRevenueByCategory,
  groupRevenueByMonth,
  groupRevenueByCustomer,
  detectDecliningFrequency,
  LOW_MONTH_MULTIPLIER,
  MIN_MONTHS_FOR_SEASONAL,
  MIN_REVENUE_TRANSACTIONS,
  PEAK_MONTH_MULTIPLIER,
  RevenueAnalyzer,
  TOP_PERFORMER_COUNT,
  HIGH_VALUE_CUSTOMER_COUNT,
  MIN_CUSTOMER_TRANSACTIONS,
  FREQUENCY_DECLINE_THRESHOLD,
} from './revenueAnalyzer.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Create N credit transactions spread across given categories. */
function makeRevenueTxsByCategory(
  entries: { category: string; amountKobo: number; count: number }[],
  businessId: string,
): ReturnType<typeof makeTransaction>[] {
  const txs: ReturnType<typeof makeTransaction>[] = [];
  let day = 1;
  for (const entry of entries) {
    for (let i = 0; i < entry.count; i++) {
      txs.push(
        makeTransaction({
          businessId,
          type: 'credit',
          amountKobo: entry.amountKobo,
          category: entry.category,
          date: new Date(`2024-06-${String(day).padStart(2, '0')}T10:00:00+01:00`),
        }),
      );
      day = (day % 28) + 1;
    }
  }
  return txs;
}

/** Create credit transactions spread across multiple months. */
function makeMonthlyRevenueTxs(
  entries: { month: number; year: number; amountKobo: number }[],
  businessId: string,
): ReturnType<typeof makeTransaction>[] {
  return entries.map((e) =>
    makeTransaction({
      businessId,
      type: 'credit',
      amountKobo: e.amountKobo,
      category: 'sales',
      date: new Date(`${e.year}-${String(e.month).padStart(2, '0')}-15T10:00:00+01:00`),
    }),
  );
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('RevenueAnalyzer', () => {
  let analyzer: RevenueAnalyzer;

  beforeEach(() => {
    analyzer = new RevenueAnalyzer();
  });

  // ── getCategory() ──────────────────────────────────────────────────────

  describe('getCategory()', () => {
    it('returns "revenue"', () => {
      expect(analyzer.getCategory()).toBe('revenue');
    });
  });

  // ── getRequiredData() ──────────────────────────────────────────────────

  describe('getRequiredData()', () => {
    it('requires transaction data', () => {
      const requirements = analyzer.getRequiredData();
      expect(requirements.some((r) => r.source === 'transaction-engine')).toBe(true);
    });
  });

  // ── analyze() — no data / insufficient data ───────────────────────────

  describe('analyze() — insufficient data', () => {
    it('returns no insights when there are no transactions', async () => {
      const ctx = makeAnalysisContext({ transactions: [] });
      const insights = await analyzer.analyze(ctx);
      expect(insights).toHaveLength(0);
    });

    it('returns no insights when there are only debit transactions', async () => {
      const ctx = makeAnalysisContext({
        transactions: [
          makeTransaction({ type: 'debit', amountKobo: 1_000_000_00 }),
          makeTransaction({ type: 'debit', amountKobo: 2_000_000_00 }),
          makeTransaction({ type: 'debit', amountKobo: 3_000_000_00 }),
        ],
      });
      const insights = await analyzer.analyze(ctx);
      expect(insights).toHaveLength(0);
    });

    it('returns no insights when credit transactions are below minimum', async () => {
      const ctx = makeAnalysisContext({
        transactions: [
          makeTransaction({ type: 'credit', amountKobo: 100_000_00 }),
          makeTransaction({ type: 'credit', amountKobo: 200_000_00 }),
        ],
      });
      expect(MIN_REVENUE_TRANSACTIONS).toBe(3);
      const insights = await analyzer.analyze(ctx);
      expect(insights).toHaveLength(0);
    });
  });

  // ── analyze() — Requirement 5.1: top performers ──────────────────────

  describe('analyze() — top performers (Req 5.1)', () => {
    it('generates a top_performers insight when enough credit transactions exist', async () => {
      const businessId = 'biz-rev';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: makeRevenueTxsByCategory(
          [
            { category: 'sales', amountKobo: 500_000_00, count: 3 },
            { category: 'consulting', amountKobo: 300_000_00, count: 2 },
          ],
          businessId,
        ),
        dateRange: {
          start: new Date('2024-06-01T00:00:00+01:00'),
          end: new Date('2024-06-30T23:59:59+01:00'),
        },
      });

      const insights = await analyzer.analyze(ctx);
      const topInsight = insights.find((i) => i.type === 'top_performers');

      expect(topInsight).toBeDefined();
      expect(topInsight!.category).toBe('revenue');
    });

    it('ranks categories by total revenue descending', async () => {
      const businessId = 'biz-rank';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: makeRevenueTxsByCategory(
          [
            { category: 'consulting', amountKobo: 1_000_000_00, count: 1 },
            { category: 'sales', amountKobo: 500_000_00, count: 3 },
            { category: 'training', amountKobo: 200_000_00, count: 1 },
          ],
          businessId,
        ),
        dateRange: {
          start: new Date('2024-06-01T00:00:00+01:00'),
          end: new Date('2024-06-30T23:59:59+01:00'),
        },
      });

      const insights = await analyzer.analyze(ctx);
      const topInsight = insights.find((i) => i.type === 'top_performers');

      expect(topInsight).toBeDefined();
      const topCategories = topInsight!.data.topCategories as {
        category: string;
        totalKobo: number;
      }[];
      expect(topCategories[0]!.category).toBe('sales'); // 3 × ₦500K = ₦1.5M
      expect(topCategories[1]!.category).toBe('consulting'); // 1 × ₦1M
    });

    it('limits top categories to TOP_PERFORMER_COUNT', async () => {
      const businessId = 'biz-limit';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: makeRevenueTxsByCategory(
          [
            { category: 'sales', amountKobo: 500_000_00, count: 2 },
            { category: 'consulting', amountKobo: 400_000_00, count: 1 },
            { category: 'training', amountKobo: 300_000_00, count: 1 },
            { category: 'support', amountKobo: 200_000_00, count: 1 },
          ],
          businessId,
        ),
        dateRange: {
          start: new Date('2024-06-01T00:00:00+01:00'),
          end: new Date('2024-06-30T23:59:59+01:00'),
        },
      });

      const insights = await analyzer.analyze(ctx);
      const topInsight = insights.find((i) => i.type === 'top_performers');

      expect(topInsight).toBeDefined();
      const topCategories = topInsight!.data.topCategories as { category: string }[];
      expect(topCategories).toHaveLength(TOP_PERFORMER_COUNT);
    });

    it('includes financial impact in Kobo', async () => {
      const businessId = 'biz-kobo';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: makeRevenueTxsByCategory(
          [{ category: 'sales', amountKobo: 100_000_00, count: 5 }],
          businessId,
        ),
        dateRange: {
          start: new Date('2024-06-01T00:00:00+01:00'),
          end: new Date('2024-06-30T23:59:59+01:00'),
        },
      });

      const insights = await analyzer.analyze(ctx);
      const topInsight = insights.find((i) => i.type === 'top_performers');

      expect(topInsight).toBeDefined();
      expect(Number.isInteger(topInsight!.financialImpact)).toBe(true);
      expect(topInsight!.financialImpact).toBe(500_000_00); // 5 × ₦100K
    });

    it('includes actionable recommendations', async () => {
      const businessId = 'biz-actions';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: makeRevenueTxsByCategory(
          [{ category: 'sales', amountKobo: 100_000_00, count: 4 }],
          businessId,
        ),
        dateRange: {
          start: new Date('2024-06-01T00:00:00+01:00'),
          end: new Date('2024-06-30T23:59:59+01:00'),
        },
      });

      const insights = await analyzer.analyze(ctx);
      const topInsight = insights.find((i) => i.type === 'top_performers');

      expect(topInsight).toBeDefined();
      expect(topInsight!.actionItems.length).toBeGreaterThanOrEqual(1);
      expect(topInsight!.actionItems.some((a) => a.description.length > 0)).toBe(true);
    });
  });

  // ── analyze() — Requirement 5.3: seasonal patterns ────────────────────

  describe('analyze() — seasonal patterns (Req 5.3)', () => {
    it('generates a seasonal_pattern insight when peak/low months are detected', async () => {
      const businessId = 'biz-season';
      const txs = makeMonthlyRevenueTxs(
        [
          { month: 1, year: 2024, amountKobo: 100_000_00 },
          { month: 2, year: 2024, amountKobo: 100_000_00 },
          { month: 3, year: 2024, amountKobo: 100_000_00 },
          { month: 4, year: 2024, amountKobo: 500_000_00 }, // peak
          { month: 5, year: 2024, amountKobo: 50_000_00 }, // low
        ],
        businessId,
      );

      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: txs,
        dateRange: {
          start: new Date('2024-01-01T00:00:00+01:00'),
          end: new Date('2024-05-31T23:59:59+01:00'),
        },
      });

      const insights = await analyzer.analyze(ctx);
      const seasonalInsight = insights.find((i) => i.type === 'seasonal_pattern');

      expect(seasonalInsight).toBeDefined();
      expect(seasonalInsight!.category).toBe('revenue');
    });

    it('does not generate seasonal insight with fewer than MIN_MONTHS_FOR_SEASONAL months', async () => {
      const businessId = 'biz-few-months';
      // Only 2 months of data
      const txs = makeMonthlyRevenueTxs(
        [
          { month: 1, year: 2024, amountKobo: 100_000_00 },
          { month: 2, year: 2024, amountKobo: 500_000_00 },
        ],
        businessId,
      );

      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: txs,
        dateRange: {
          start: new Date('2024-01-01T00:00:00+01:00'),
          end: new Date('2024-02-28T23:59:59+01:00'),
        },
      });

      expect(MIN_MONTHS_FOR_SEASONAL).toBe(3);
      const insights = await analyzer.analyze(ctx);
      const seasonalInsight = insights.find((i) => i.type === 'seasonal_pattern');
      expect(seasonalInsight).toBeUndefined();
    });

    it('does not generate seasonal insight when revenue is evenly distributed', async () => {
      const businessId = 'biz-even';
      const txs = makeMonthlyRevenueTxs(
        [
          { month: 1, year: 2024, amountKobo: 100_000_00 },
          { month: 2, year: 2024, amountKobo: 100_000_00 },
          { month: 3, year: 2024, amountKobo: 100_000_00 },
          { month: 4, year: 2024, amountKobo: 100_000_00 },
        ],
        businessId,
      );

      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: txs,
        dateRange: {
          start: new Date('2024-01-01T00:00:00+01:00'),
          end: new Date('2024-04-30T23:59:59+01:00'),
        },
      });

      const insights = await analyzer.analyze(ctx);
      const seasonalInsight = insights.find((i) => i.type === 'seasonal_pattern');
      expect(seasonalInsight).toBeUndefined();
    });

    it('includes peak and low month data in insight', async () => {
      const businessId = 'biz-data';
      const txs = makeMonthlyRevenueTxs(
        [
          { month: 1, year: 2024, amountKobo: 50_000_00 }, // low
          { month: 2, year: 2024, amountKobo: 200_000_00 },
          { month: 3, year: 2024, amountKobo: 200_000_00 },
          { month: 4, year: 2024, amountKobo: 500_000_00 }, // peak
        ],
        businessId,
      );

      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: txs,
        dateRange: {
          start: new Date('2024-01-01T00:00:00+01:00'),
          end: new Date('2024-04-30T23:59:59+01:00'),
        },
      });

      const insights = await analyzer.analyze(ctx);
      const seasonalInsight = insights.find((i) => i.type === 'seasonal_pattern');

      expect(seasonalInsight).toBeDefined();
      expect(seasonalInsight!.data.peakMonths).toBeDefined();
      expect(seasonalInsight!.data.lowMonths).toBeDefined();
      expect(seasonalInsight!.data.averageMonthlyKobo).toBeDefined();
    });

    it('includes actionable recommendations for seasonal patterns', async () => {
      const businessId = 'biz-seasonal-actions';
      const txs = makeMonthlyRevenueTxs(
        [
          { month: 1, year: 2024, amountKobo: 50_000_00 },
          { month: 2, year: 2024, amountKobo: 200_000_00 },
          { month: 3, year: 2024, amountKobo: 200_000_00 },
          { month: 4, year: 2024, amountKobo: 500_000_00 },
        ],
        businessId,
      );

      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: txs,
        dateRange: {
          start: new Date('2024-01-01T00:00:00+01:00'),
          end: new Date('2024-04-30T23:59:59+01:00'),
        },
      });

      const insights = await analyzer.analyze(ctx);
      const seasonalInsight = insights.find((i) => i.type === 'seasonal_pattern');

      expect(seasonalInsight).toBeDefined();
      expect(seasonalInsight!.actionItems.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── analyze() — combined insights ─────────────────────────────────────

  describe('analyze() — combined insights', () => {
    it('can generate both top_performers and seasonal_pattern insights', async () => {
      const businessId = 'biz-both';
      const txs = makeMonthlyRevenueTxs(
        [
          { month: 1, year: 2024, amountKobo: 50_000_00 },
          { month: 2, year: 2024, amountKobo: 200_000_00 },
          { month: 3, year: 2024, amountKobo: 200_000_00 },
          { month: 4, year: 2024, amountKobo: 500_000_00 },
        ],
        businessId,
      );

      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: txs,
        dateRange: {
          start: new Date('2024-01-01T00:00:00+01:00'),
          end: new Date('2024-04-30T23:59:59+01:00'),
        },
      });

      const insights = await analyzer.analyze(ctx);
      expect(insights.find((i) => i.type === 'top_performers')).toBeDefined();
      expect(insights.find((i) => i.type === 'seasonal_pattern')).toBeDefined();
    });
  });
});

// ─── Pure helper tests ─────────────────────────────────────────────────────

describe('groupRevenueByCategory()', () => {
  it('groups transactions by category and sorts by total descending', () => {
    const txs = [
      makeTransaction({ type: 'credit', amountKobo: 300_000_00, category: 'sales' }),
      makeTransaction({ type: 'credit', amountKobo: 500_000_00, category: 'consulting' }),
      makeTransaction({ type: 'credit', amountKobo: 200_000_00, category: 'sales' }),
    ];

    const result = groupRevenueByCategory(txs);

    expect(result).toHaveLength(2);
    expect(result[0]!.category).toBe('sales'); // 300K + 200K = 500K
    expect(result[0]!.totalKobo).toBe(500_000_00);
    expect(result[0]!.transactionCount).toBe(2);
    expect(result[1]!.category).toBe('consulting');
    expect(result[1]!.totalKobo).toBe(500_000_00);
  });

  it('returns empty array for empty input', () => {
    expect(groupRevenueByCategory([])).toHaveLength(0);
  });

  it('calculates percentage of total revenue', () => {
    const txs = [
      makeTransaction({ type: 'credit', amountKobo: 750_000_00, category: 'sales' }),
      makeTransaction({ type: 'credit', amountKobo: 250_000_00, category: 'other' }),
    ];

    const result = groupRevenueByCategory(txs);
    expect(result[0]!.percentage).toBe(75);
    expect(result[1]!.percentage).toBe(25);
  });
});

describe('groupRevenueByMonth()', () => {
  it('groups transactions by YYYY-MM and sorts chronologically', () => {
    const txs = [
      makeTransaction({
        type: 'credit',
        amountKobo: 100_000_00,
        date: new Date('2024-03-15T10:00:00+01:00'),
      }),
      makeTransaction({
        type: 'credit',
        amountKobo: 200_000_00,
        date: new Date('2024-01-10T10:00:00+01:00'),
      }),
      makeTransaction({
        type: 'credit',
        amountKobo: 150_000_00,
        date: new Date('2024-01-20T10:00:00+01:00'),
      }),
    ];

    const result = groupRevenueByMonth(txs);

    expect(result).toHaveLength(2);
    expect(result[0]!.month).toBe('2024-01');
    expect(result[0]!.totalKobo).toBe(350_000_00);
    expect(result[0]!.transactionCount).toBe(2);
    expect(result[1]!.month).toBe('2024-03');
    expect(result[1]!.totalKobo).toBe(100_000_00);
  });

  it('returns empty array for empty input', () => {
    expect(groupRevenueByMonth([])).toHaveLength(0);
  });
});

describe('detectSeasonalPattern()', () => {
  it('returns null when fewer than MIN_MONTHS_FOR_SEASONAL months', () => {
    const monthly = [
      { month: '2024-01', totalKobo: 100_000_00, transactionCount: 1 },
      { month: '2024-02', totalKobo: 500_000_00, transactionCount: 1 },
    ];
    expect(detectSeasonalPattern(monthly)).toBeNull();
  });

  it('returns null when all months have equal revenue', () => {
    const monthly = [
      { month: '2024-01', totalKobo: 100_000_00, transactionCount: 1 },
      { month: '2024-02', totalKobo: 100_000_00, transactionCount: 1 },
      { month: '2024-03', totalKobo: 100_000_00, transactionCount: 1 },
    ];
    expect(detectSeasonalPattern(monthly)).toBeNull();
  });

  it('identifies peak months above PEAK_MONTH_MULTIPLIER × average', () => {
    // Average = (100K + 100K + 100K + 400K) / 4 = 175K
    // Peak threshold = 175K × 1.3 = 227.5K → 400K qualifies
    const monthly = [
      { month: '2024-01', totalKobo: 100_000_00, transactionCount: 1 },
      { month: '2024-02', totalKobo: 100_000_00, transactionCount: 1 },
      { month: '2024-03', totalKobo: 100_000_00, transactionCount: 1 },
      { month: '2024-04', totalKobo: 400_000_00, transactionCount: 1 },
    ];

    const result = detectSeasonalPattern(monthly);
    expect(result).not.toBeNull();
    expect(result!.peakMonths).toHaveLength(1);
    expect(result!.peakMonths[0]!.month).toBe('2024-04');
  });

  it('identifies low months below LOW_MONTH_MULTIPLIER × average', () => {
    // Average = (50K + 200K + 200K + 200K) / 4 = 162.5K
    // Low threshold = 162.5K × 0.7 = 113.75K → 50K qualifies
    const monthly = [
      { month: '2024-01', totalKobo: 50_000_00, transactionCount: 1 },
      { month: '2024-02', totalKobo: 200_000_00, transactionCount: 1 },
      { month: '2024-03', totalKobo: 200_000_00, transactionCount: 1 },
      { month: '2024-04', totalKobo: 200_000_00, transactionCount: 1 },
    ];

    const result = detectSeasonalPattern(monthly);
    expect(result).not.toBeNull();
    expect(result!.lowMonths).toHaveLength(1);
    expect(result!.lowMonths[0]!.month).toBe('2024-01');
  });

  it('returns averageKobo as an integer', () => {
    const monthly = [
      { month: '2024-01', totalKobo: 100_000_00, transactionCount: 1 },
      { month: '2024-02', totalKobo: 100_000_00, transactionCount: 1 },
      { month: '2024-03', totalKobo: 400_000_00, transactionCount: 1 },
    ];

    const result = detectSeasonalPattern(monthly);
    expect(result).not.toBeNull();
    expect(Number.isInteger(result!.averageKobo)).toBe(true);
  });
});

describe('RevenueAnalyzer constants', () => {
  it('MIN_REVENUE_TRANSACTIONS is 3', () => {
    expect(MIN_REVENUE_TRANSACTIONS).toBe(3);
  });

  it('TOP_PERFORMER_COUNT is 3', () => {
    expect(TOP_PERFORMER_COUNT).toBe(3);
  });

  it('PEAK_MONTH_MULTIPLIER is 1.3', () => {
    expect(PEAK_MONTH_MULTIPLIER).toBe(1.3);
  });

  it('LOW_MONTH_MULTIPLIER is 0.7', () => {
    expect(LOW_MONTH_MULTIPLIER).toBe(0.7);
  });

  it('MIN_MONTHS_FOR_SEASONAL is 3', () => {
    expect(MIN_MONTHS_FOR_SEASONAL).toBe(3);
  });

  it('HIGH_VALUE_CUSTOMER_COUNT is 5', () => {
    expect(HIGH_VALUE_CUSTOMER_COUNT).toBe(5);
  });

  it('MIN_CUSTOMER_TRANSACTIONS is 3', () => {
    expect(MIN_CUSTOMER_TRANSACTIONS).toBe(3);
  });

  it('FREQUENCY_DECLINE_THRESHOLD is 0.5', () => {
    expect(FREQUENCY_DECLINE_THRESHOLD).toBe(0.5);
  });
});

// ─── Customer Analysis Helper Tests ────────────────────────────────────────

/** Create credit transactions from different counterparties. */
function makeCustomerTxs(
  entries: { counterparty: string; amountKobo: number; count: number; date?: Date }[],
  businessId: string,
): ReturnType<typeof makeTransaction>[] {
  const txs: ReturnType<typeof makeTransaction>[] = [];
  let day = 1;
  for (const entry of entries) {
    for (let i = 0; i < entry.count; i++) {
      txs.push(
        makeTransaction({
          businessId,
          type: 'credit',
          amountKobo: entry.amountKobo,
          counterparty: entry.counterparty,
          category: 'sales',
          date: entry.date ?? new Date(`2024-06-${String(day).padStart(2, '0')}T10:00:00+01:00`),
        }),
      );
      day = (day % 28) + 1;
    }
  }
  return txs;
}

describe('groupRevenueByCustomer()', () => {
  it('groups transactions by counterparty and sorts by total descending', () => {
    const txs = [
      makeTransaction({
        type: 'credit',
        amountKobo: 300_000_00,
        counterparty: 'Customer A',
      }),
      makeTransaction({
        type: 'credit',
        amountKobo: 500_000_00,
        counterparty: 'Customer B',
      }),
      makeTransaction({
        type: 'credit',
        amountKobo: 200_000_00,
        counterparty: 'Customer A',
      }),
    ];

    const result = groupRevenueByCustomer(txs);

    expect(result).toHaveLength(2);
    expect(result[0]!.counterparty).toBe('Customer A'); // 300K + 200K = 500K
    expect(result[0]!.totalKobo).toBe(500_000_00);
    expect(result[0]!.transactionCount).toBe(2);
    expect(result[1]!.counterparty).toBe('Customer B');
    expect(result[1]!.totalKobo).toBe(500_000_00);
  });

  it('returns empty array for empty input', () => {
    expect(groupRevenueByCustomer([])).toHaveLength(0);
  });

  it('calculates percentage of total revenue', () => {
    const txs = [
      makeTransaction({
        type: 'credit',
        amountKobo: 750_000_00,
        counterparty: 'Big Corp',
      }),
      makeTransaction({
        type: 'credit',
        amountKobo: 250_000_00,
        counterparty: 'Small Co',
      }),
    ];

    const result = groupRevenueByCustomer(txs);
    expect(result[0]!.percentage).toBe(75);
    expect(result[1]!.percentage).toBe(25);
  });

  it('skips transactions with empty counterparty', () => {
    const txs = [
      makeTransaction({
        type: 'credit',
        amountKobo: 100_000_00,
        counterparty: '',
      }),
      makeTransaction({
        type: 'credit',
        amountKobo: 200_000_00,
        counterparty: 'Customer A',
      }),
    ];

    const result = groupRevenueByCustomer(txs);
    expect(result).toHaveLength(1);
    expect(result[0]!.counterparty).toBe('Customer A');
  });
});

describe('detectDecliningFrequency()', () => {
  const dateRange = {
    start: new Date('2024-01-01T00:00:00+01:00'),
    end: new Date('2024-06-30T23:59:59+01:00'),
  };
  // Midpoint: ~2024-04-01

  it('detects customers with >50% frequency decline', () => {
    const txs = [
      // Customer A: 3 in earlier half, 1 in recent half → 67% decline
      makeTransaction({
        type: 'credit',
        amountKobo: 100_000_00,
        counterparty: 'Customer A',
        date: new Date('2024-01-15T10:00:00+01:00'),
      }),
      makeTransaction({
        type: 'credit',
        amountKobo: 100_000_00,
        counterparty: 'Customer A',
        date: new Date('2024-02-15T10:00:00+01:00'),
      }),
      makeTransaction({
        type: 'credit',
        amountKobo: 100_000_00,
        counterparty: 'Customer A',
        date: new Date('2024-03-15T10:00:00+01:00'),
      }),
      makeTransaction({
        type: 'credit',
        amountKobo: 100_000_00,
        counterparty: 'Customer A',
        date: new Date('2024-05-15T10:00:00+01:00'),
      }),
    ];

    const result = detectDecliningFrequency(txs, dateRange);
    expect(result).toHaveLength(1);
    expect(result[0]!.counterparty).toBe('Customer A');
    expect(result[0]!.earlierCount).toBe(3);
    expect(result[0]!.recentCount).toBe(1);
    expect(result[0]!.declineRatio).toBeCloseTo(0.667, 2);
  });

  it('does not flag customers with stable frequency', () => {
    const txs = [
      // Customer A: 2 in earlier, 2 in recent → 0% decline
      makeTransaction({
        type: 'credit',
        amountKobo: 100_000_00,
        counterparty: 'Customer A',
        date: new Date('2024-02-15T10:00:00+01:00'),
      }),
      makeTransaction({
        type: 'credit',
        amountKobo: 100_000_00,
        counterparty: 'Customer A',
        date: new Date('2024-03-15T10:00:00+01:00'),
      }),
      makeTransaction({
        type: 'credit',
        amountKobo: 100_000_00,
        counterparty: 'Customer A',
        date: new Date('2024-05-15T10:00:00+01:00'),
      }),
      makeTransaction({
        type: 'credit',
        amountKobo: 100_000_00,
        counterparty: 'Customer A',
        date: new Date('2024-06-15T10:00:00+01:00'),
      }),
    ];

    const result = detectDecliningFrequency(txs, dateRange);
    expect(result).toHaveLength(0);
  });

  it('does not flag customers with only recent transactions', () => {
    const txs = [
      makeTransaction({
        type: 'credit',
        amountKobo: 100_000_00,
        counterparty: 'New Customer',
        date: new Date('2024-05-15T10:00:00+01:00'),
      }),
      makeTransaction({
        type: 'credit',
        amountKobo: 100_000_00,
        counterparty: 'New Customer',
        date: new Date('2024-06-15T10:00:00+01:00'),
      }),
    ];

    const result = detectDecliningFrequency(txs, dateRange);
    expect(result).toHaveLength(0);
  });

  it('flags customers who completely stopped purchasing', () => {
    const txs = [
      // Customer A: 3 in earlier, 0 in recent → 100% decline
      makeTransaction({
        type: 'credit',
        amountKobo: 200_000_00,
        counterparty: 'Gone Customer',
        date: new Date('2024-01-15T10:00:00+01:00'),
      }),
      makeTransaction({
        type: 'credit',
        amountKobo: 200_000_00,
        counterparty: 'Gone Customer',
        date: new Date('2024-02-15T10:00:00+01:00'),
      }),
      makeTransaction({
        type: 'credit',
        amountKobo: 200_000_00,
        counterparty: 'Gone Customer',
        date: new Date('2024-03-15T10:00:00+01:00'),
      }),
    ];

    const result = detectDecliningFrequency(txs, dateRange);
    expect(result).toHaveLength(1);
    expect(result[0]!.declineRatio).toBe(1);
    expect(result[0]!.recentCount).toBe(0);
  });

  it('sorts declining customers by total revenue descending', () => {
    const txs = [
      // Small customer: 2 earlier, 0 recent
      makeTransaction({
        type: 'credit',
        amountKobo: 50_000_00,
        counterparty: 'Small',
        date: new Date('2024-02-15T10:00:00+01:00'),
      }),
      makeTransaction({
        type: 'credit',
        amountKobo: 50_000_00,
        counterparty: 'Small',
        date: new Date('2024-03-15T10:00:00+01:00'),
      }),
      // Big customer: 2 earlier, 0 recent
      makeTransaction({
        type: 'credit',
        amountKobo: 500_000_00,
        counterparty: 'Big',
        date: new Date('2024-02-15T10:00:00+01:00'),
      }),
      makeTransaction({
        type: 'credit',
        amountKobo: 500_000_00,
        counterparty: 'Big',
        date: new Date('2024-03-15T10:00:00+01:00'),
      }),
    ];

    const result = detectDecliningFrequency(txs, dateRange);
    expect(result).toHaveLength(2);
    expect(result[0]!.counterparty).toBe('Big');
    expect(result[1]!.counterparty).toBe('Small');
  });

  it('returns empty array for empty input', () => {
    expect(detectDecliningFrequency([], dateRange)).toHaveLength(0);
  });
});

// ─── RevenueAnalyzer — Customer Analysis Integration ───────────────────────

describe('RevenueAnalyzer — customer analysis', () => {
  let analyzer: RevenueAnalyzer;

  beforeEach(() => {
    analyzer = new RevenueAnalyzer();
  });

  describe('analyze() — high-value customers (Req 5.5)', () => {
    it('generates a high_value_customer insight when enough distinct customers exist', async () => {
      const businessId = 'biz-hvc';
      const txs = makeCustomerTxs(
        [
          { counterparty: 'Customer A', amountKobo: 500_000_00, count: 2 },
          { counterparty: 'Customer B', amountKobo: 300_000_00, count: 2 },
          { counterparty: 'Customer C', amountKobo: 100_000_00, count: 2 },
        ],
        businessId,
      );

      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: txs,
        dateRange: {
          start: new Date('2024-06-01T00:00:00+01:00'),
          end: new Date('2024-06-30T23:59:59+01:00'),
        },
      });

      const insights = await analyzer.analyze(ctx);
      const hvInsight = insights.find((i) => i.type === 'high_value_customer');

      expect(hvInsight).toBeDefined();
      expect(hvInsight!.category).toBe('revenue');
    });

    it('ranks customers by total revenue descending', async () => {
      const businessId = 'biz-hvc-rank';
      const txs = makeCustomerTxs(
        [
          { counterparty: 'Small Co', amountKobo: 100_000_00, count: 1 },
          { counterparty: 'Big Corp', amountKobo: 500_000_00, count: 3 },
          { counterparty: 'Medium Ltd', amountKobo: 300_000_00, count: 2 },
        ],
        businessId,
      );

      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: txs,
        dateRange: {
          start: new Date('2024-06-01T00:00:00+01:00'),
          end: new Date('2024-06-30T23:59:59+01:00'),
        },
      });

      const insights = await analyzer.analyze(ctx);
      const hvInsight = insights.find((i) => i.type === 'high_value_customer');

      expect(hvInsight).toBeDefined();
      const topCustomers = hvInsight!.data.topCustomers as {
        counterparty: string;
        totalKobo: number;
      }[];
      expect(topCustomers[0]!.counterparty).toBe('Big Corp');
      expect(topCustomers[1]!.counterparty).toBe('Medium Ltd');
    });

    it('limits top customers to HIGH_VALUE_CUSTOMER_COUNT', async () => {
      const businessId = 'biz-hvc-limit';
      const txs = makeCustomerTxs(
        [
          { counterparty: 'C1', amountKobo: 600_000_00, count: 1 },
          { counterparty: 'C2', amountKobo: 500_000_00, count: 1 },
          { counterparty: 'C3', amountKobo: 400_000_00, count: 1 },
          { counterparty: 'C4', amountKobo: 300_000_00, count: 1 },
          { counterparty: 'C5', amountKobo: 200_000_00, count: 1 },
          { counterparty: 'C6', amountKobo: 100_000_00, count: 1 },
          { counterparty: 'C7', amountKobo: 50_000_00, count: 1 },
        ],
        businessId,
      );

      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: txs,
        dateRange: {
          start: new Date('2024-06-01T00:00:00+01:00'),
          end: new Date('2024-06-30T23:59:59+01:00'),
        },
      });

      const insights = await analyzer.analyze(ctx);
      const hvInsight = insights.find((i) => i.type === 'high_value_customer');

      expect(hvInsight).toBeDefined();
      const topCustomers = hvInsight!.data.topCustomers as { counterparty: string }[];
      expect(topCustomers).toHaveLength(HIGH_VALUE_CUSTOMER_COUNT);
    });

    it('includes financial impact in Kobo (integer)', async () => {
      const businessId = 'biz-hvc-kobo';
      const txs = makeCustomerTxs(
        [
          { counterparty: 'A', amountKobo: 100_000_00, count: 2 },
          { counterparty: 'B', amountKobo: 200_000_00, count: 1 },
          { counterparty: 'C', amountKobo: 50_000_00, count: 1 },
        ],
        businessId,
      );

      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: txs,
        dateRange: {
          start: new Date('2024-06-01T00:00:00+01:00'),
          end: new Date('2024-06-30T23:59:59+01:00'),
        },
      });

      const insights = await analyzer.analyze(ctx);
      const hvInsight = insights.find((i) => i.type === 'high_value_customer');

      expect(hvInsight).toBeDefined();
      expect(Number.isInteger(hvInsight!.financialImpact)).toBe(true);
    });

    it('includes actionable recommendations', async () => {
      const businessId = 'biz-hvc-actions';
      const txs = makeCustomerTxs(
        [
          { counterparty: 'A', amountKobo: 100_000_00, count: 2 },
          { counterparty: 'B', amountKobo: 200_000_00, count: 1 },
          { counterparty: 'C', amountKobo: 50_000_00, count: 1 },
        ],
        businessId,
      );

      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: txs,
        dateRange: {
          start: new Date('2024-06-01T00:00:00+01:00'),
          end: new Date('2024-06-30T23:59:59+01:00'),
        },
      });

      const insights = await analyzer.analyze(ctx);
      const hvInsight = insights.find((i) => i.type === 'high_value_customer');

      expect(hvInsight).toBeDefined();
      expect(hvInsight!.actionItems.length).toBeGreaterThanOrEqual(1);
      expect(hvInsight!.actionItems.some((a) => a.description.length > 0)).toBe(true);
    });

    it('does not generate high_value_customer when fewer than MIN_CUSTOMER_TRANSACTIONS distinct customers', async () => {
      const businessId = 'biz-hvc-few';
      // Only 2 distinct counterparties
      const txs = makeCustomerTxs(
        [
          { counterparty: 'A', amountKobo: 100_000_00, count: 2 },
          { counterparty: 'B', amountKobo: 200_000_00, count: 2 },
        ],
        businessId,
      );

      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: txs,
        dateRange: {
          start: new Date('2024-06-01T00:00:00+01:00'),
          end: new Date('2024-06-30T23:59:59+01:00'),
        },
      });

      const insights = await analyzer.analyze(ctx);
      const hvInsight = insights.find((i) => i.type === 'high_value_customer');
      expect(hvInsight).toBeUndefined();
    });
  });

  describe('analyze() — customer retention (Req 5.2)', () => {
    it('generates a customer_retention insight when frequency declines', async () => {
      const businessId = 'biz-ret';
      const txs = [
        // Customer A: 3 in earlier half, 0 in recent half → 100% decline
        makeTransaction({
          businessId,
          type: 'credit',
          amountKobo: 200_000_00,
          counterparty: 'Declining Corp',
          category: 'sales',
          date: new Date('2024-01-15T10:00:00+01:00'),
        }),
        makeTransaction({
          businessId,
          type: 'credit',
          amountKobo: 200_000_00,
          counterparty: 'Declining Corp',
          category: 'sales',
          date: new Date('2024-02-15T10:00:00+01:00'),
        }),
        makeTransaction({
          businessId,
          type: 'credit',
          amountKobo: 200_000_00,
          counterparty: 'Declining Corp',
          category: 'sales',
          date: new Date('2024-03-15T10:00:00+01:00'),
        }),
        // Stable customer to meet MIN_REVENUE_TRANSACTIONS
        makeTransaction({
          businessId,
          type: 'credit',
          amountKobo: 100_000_00,
          counterparty: 'Stable Co',
          category: 'sales',
          date: new Date('2024-05-15T10:00:00+01:00'),
        }),
      ];

      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: txs,
        dateRange: {
          start: new Date('2024-01-01T00:00:00+01:00'),
          end: new Date('2024-06-30T23:59:59+01:00'),
        },
      });

      const insights = await analyzer.analyze(ctx);
      const retInsight = insights.find((i) => i.type === 'customer_retention');

      expect(retInsight).toBeDefined();
      expect(retInsight!.category).toBe('revenue');
    });

    it('includes declining customer details in data', async () => {
      const businessId = 'biz-ret-data';
      const txs = [
        makeTransaction({
          businessId,
          type: 'credit',
          amountKobo: 300_000_00,
          counterparty: 'Fading Ltd',
          category: 'sales',
          date: new Date('2024-01-15T10:00:00+01:00'),
        }),
        makeTransaction({
          businessId,
          type: 'credit',
          amountKobo: 300_000_00,
          counterparty: 'Fading Ltd',
          category: 'sales',
          date: new Date('2024-02-15T10:00:00+01:00'),
        }),
        makeTransaction({
          businessId,
          type: 'credit',
          amountKobo: 300_000_00,
          counterparty: 'Fading Ltd',
          category: 'sales',
          date: new Date('2024-03-15T10:00:00+01:00'),
        }),
        // Need a recent tx from another customer to meet min
        makeTransaction({
          businessId,
          type: 'credit',
          amountKobo: 100_000_00,
          counterparty: 'Other',
          category: 'sales',
          date: new Date('2024-05-15T10:00:00+01:00'),
        }),
      ];

      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: txs,
        dateRange: {
          start: new Date('2024-01-01T00:00:00+01:00'),
          end: new Date('2024-06-30T23:59:59+01:00'),
        },
      });

      const insights = await analyzer.analyze(ctx);
      const retInsight = insights.find((i) => i.type === 'customer_retention');

      expect(retInsight).toBeDefined();
      expect(retInsight!.data.decliningCustomers).toBeDefined();
      expect(retInsight!.data.atRiskRevenueKobo).toBeDefined();
      expect(retInsight!.data.decliningCount).toBeGreaterThanOrEqual(1);
    });

    it('includes re-engagement action items', async () => {
      const businessId = 'biz-ret-actions';
      const txs = [
        makeTransaction({
          businessId,
          type: 'credit',
          amountKobo: 200_000_00,
          counterparty: 'Lost Customer',
          category: 'sales',
          date: new Date('2024-01-15T10:00:00+01:00'),
        }),
        makeTransaction({
          businessId,
          type: 'credit',
          amountKobo: 200_000_00,
          counterparty: 'Lost Customer',
          category: 'sales',
          date: new Date('2024-02-15T10:00:00+01:00'),
        }),
        makeTransaction({
          businessId,
          type: 'credit',
          amountKobo: 200_000_00,
          counterparty: 'Lost Customer',
          category: 'sales',
          date: new Date('2024-03-15T10:00:00+01:00'),
        }),
        makeTransaction({
          businessId,
          type: 'credit',
          amountKobo: 100_000_00,
          counterparty: 'Active Co',
          category: 'sales',
          date: new Date('2024-05-15T10:00:00+01:00'),
        }),
      ];

      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: txs,
        dateRange: {
          start: new Date('2024-01-01T00:00:00+01:00'),
          end: new Date('2024-06-30T23:59:59+01:00'),
        },
      });

      const insights = await analyzer.analyze(ctx);
      const retInsight = insights.find((i) => i.type === 'customer_retention');

      expect(retInsight).toBeDefined();
      expect(retInsight!.actionItems.length).toBeGreaterThanOrEqual(1);
      expect(
        retInsight!.actionItems.some((a) => a.description.toLowerCase().includes('re-engagement')),
      ).toBe(true);
    });

    it('does not generate retention insight when no customers are declining', async () => {
      const businessId = 'biz-ret-stable';
      // All transactions in the recent half — no earlier period data to compare
      const txs = makeCustomerTxs(
        [
          {
            counterparty: 'A',
            amountKobo: 100_000_00,
            count: 2,
            date: new Date('2024-05-15T10:00:00+01:00'),
          },
          {
            counterparty: 'B',
            amountKobo: 200_000_00,
            count: 2,
            date: new Date('2024-06-15T10:00:00+01:00'),
          },
        ],
        businessId,
      );

      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: txs,
        dateRange: {
          start: new Date('2024-01-01T00:00:00+01:00'),
          end: new Date('2024-06-30T23:59:59+01:00'),
        },
      });

      const insights = await analyzer.analyze(ctx);
      const retInsight = insights.find((i) => i.type === 'customer_retention');
      expect(retInsight).toBeUndefined();
    });

    it('calculates at-risk revenue in Kobo (integer)', async () => {
      const businessId = 'biz-ret-kobo';
      const txs = [
        makeTransaction({
          businessId,
          type: 'credit',
          amountKobo: 150_000_00,
          counterparty: 'Declining A',
          category: 'sales',
          date: new Date('2024-02-15T10:00:00+01:00'),
        }),
        makeTransaction({
          businessId,
          type: 'credit',
          amountKobo: 150_000_00,
          counterparty: 'Declining A',
          category: 'sales',
          date: new Date('2024-03-15T10:00:00+01:00'),
        }),
        makeTransaction({
          businessId,
          type: 'credit',
          amountKobo: 100_000_00,
          counterparty: 'Other',
          category: 'sales',
          date: new Date('2024-05-15T10:00:00+01:00'),
        }),
      ];

      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: txs,
        dateRange: {
          start: new Date('2024-01-01T00:00:00+01:00'),
          end: new Date('2024-06-30T23:59:59+01:00'),
        },
      });

      const insights = await analyzer.analyze(ctx);
      const retInsight = insights.find((i) => i.type === 'customer_retention');

      expect(retInsight).toBeDefined();
      expect(Number.isInteger(retInsight!.financialImpact)).toBe(true);
      expect(retInsight!.financialImpact).toBe(300_000_00); // 150K × 2
    });
  });
});
