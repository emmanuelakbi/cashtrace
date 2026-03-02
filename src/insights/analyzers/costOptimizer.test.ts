/**
 * Unit tests for CostOptimizer.
 *
 * **Validates: Requirements 4.1, 4.4, 4.5**
 *
 * @module insights/analyzers/costOptimizer.test
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { makeAnalysisContext, makeBusinessProfile, makeTransaction } from '../test/fixtures.js';

import {
  ABOVE_AVERAGE_MULTIPLIER,
  calculateMeanCategorySpend,
  CostOptimizer,
  DUPLICATE_AMOUNT_TOLERANCE,
  findAboveAverageCategories,
  findDuplicateSubscriptions,
  groupSpendingByCategory,
} from './costOptimizer.js';

import type { Transaction } from '../types/index.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Create a debit transaction in a given category. */
function makeExpense(
  category: string,
  amountKobo: number,
  businessId: string,
  overrides: Partial<Transaction> = {},
): Transaction {
  return makeTransaction({
    businessId,
    type: 'debit',
    amountKobo,
    category,
    counterparty: overrides.counterparty ?? `Vendor-${category}`,
    description: `${category} expense`,
    ...overrides,
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('CostOptimizer', () => {
  let optimizer: CostOptimizer;

  beforeEach(() => {
    optimizer = new CostOptimizer();
  });

  // ── getCategory() ──────────────────────────────────────────────────────

  describe('getCategory()', () => {
    it('returns "spending"', () => {
      expect(optimizer.getCategory()).toBe('spending');
    });
  });

  // ── getRequiredData() ──────────────────────────────────────────────────

  describe('getRequiredData()', () => {
    it('requires transaction data', () => {
      const requirements = optimizer.getRequiredData();
      expect(requirements).toHaveLength(1);
      expect(requirements[0]!.source).toBe('transaction-engine');
      expect(requirements[0]!.required).toBe(true);
    });

    it('requires counterparty field for subscription detection', () => {
      const requirements = optimizer.getRequiredData();
      const fields = requirements[0]!.fields;
      expect(fields).toContain('counterparty');
      expect(fields).toContain('amountKobo');
      expect(fields).toContain('category');
    });
  });

  // ── analyze() — empty / no expenses ──────────────────────────────────

  describe('analyze() — empty / no expenses', () => {
    it('returns no insights when there are no transactions', async () => {
      const ctx = makeAnalysisContext({ transactions: [] });
      const insights = await optimizer.analyze(ctx);
      expect(insights).toHaveLength(0);
    });

    it('returns no insights when there are only credit transactions', async () => {
      const ctx = makeAnalysisContext({
        transactions: [makeTransaction({ type: 'credit', amountKobo: 1_000_000_00 })],
      });
      const insights = await optimizer.analyze(ctx);
      expect(insights).toHaveLength(0);
    });
  });

  // ── analyze() — above-average spending (Req 4.1) ────────────────────

  describe('analyze() — above-average spending detection (Req 4.1)', () => {
    it('detects a category spending significantly above average', async () => {
      const businessId = 'biz-cost';
      // 3 categories: rent=500K, utilities=100K, supplies=100K
      // mean = ~233K, threshold = 233K * 1.5 = ~350K → rent is above
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makeExpense('rent', 500_000_00, businessId),
          makeExpense('utilities', 100_000_00, businessId),
          makeExpense('supplies', 100_000_00, businessId),
        ],
      });

      const insights = await optimizer.analyze(ctx);
      const costInsights = insights.filter((i) => i.type === 'cost_optimization');
      expect(costInsights).toHaveLength(1);
      expect(costInsights[0]!.category).toBe('spending');

      const data = costInsights[0]!.data as Record<string, unknown>;
      expect(data.category).toBe('rent');
      expect(data.totalKobo).toBe(500_000_00);
    });

    it('does not flag categories at or below the threshold', async () => {
      const businessId = 'biz-even';
      // All categories spend equally → none above 1.5× mean
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makeExpense('rent', 100_000_00, businessId),
          makeExpense('utilities', 100_000_00, businessId),
          makeExpense('supplies', 100_000_00, businessId),
        ],
      });

      const insights = await optimizer.analyze(ctx);
      const costInsights = insights.filter((i) => i.type === 'cost_optimization');
      expect(costInsights).toHaveLength(0);
    });

    it('includes potential savings (excess over mean) in Kobo', async () => {
      const businessId = 'biz-savings';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makeExpense('rent', 600_000_00, businessId),
          makeExpense('utilities', 100_000_00, businessId),
          makeExpense('supplies', 100_000_00, businessId),
        ],
      });

      const insights = await optimizer.analyze(ctx);
      const costInsight = insights.find((i) => i.type === 'cost_optimization');
      expect(costInsight).toBeDefined();

      const data = costInsight!.data as Record<string, unknown>;
      const meanKobo = data.meanKobo as number;
      const excessKobo = data.excessKobo as number;
      expect(excessKobo).toBe(600_000_00 - meanKobo);
      expect(costInsight!.financialImpact).toBe(excessKobo);
    });

    it('includes action items for review', async () => {
      const businessId = 'biz-actions';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makeExpense('rent', 500_000_00, businessId),
          makeExpense('utilities', 100_000_00, businessId),
          makeExpense('supplies', 100_000_00, businessId),
        ],
      });

      const insights = await optimizer.analyze(ctx);
      const costInsight = insights.find((i) => i.type === 'cost_optimization');
      expect(costInsight).toBeDefined();
      expect(costInsight!.actionItems.length).toBeGreaterThanOrEqual(1);
    });

    it('detects multiple above-average categories', async () => {
      const businessId = 'biz-multi';
      // rent=500K, marketing=400K, utilities=50K, supplies=50K
      // mean = 250K, threshold = 375K → rent and marketing above
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makeExpense('rent', 500_000_00, businessId),
          makeExpense('marketing', 400_000_00, businessId),
          makeExpense('utilities', 50_000_00, businessId),
          makeExpense('supplies', 50_000_00, businessId),
        ],
      });

      const insights = await optimizer.analyze(ctx);
      const costInsights = insights.filter((i) => i.type === 'cost_optimization');
      expect(costInsights).toHaveLength(2);
    });
  });

  // ── analyze() — duplicate subscriptions (Req 4.5) ───────────────────

  describe('analyze() — duplicate subscription detection (Req 4.5)', () => {
    it('detects duplicate subscriptions to the same counterparty', async () => {
      const businessId = 'biz-dup';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makeExpense('subscriptions', 50_000_00, businessId, {
            counterparty: 'Netflix Nigeria',
          }),
          makeExpense('subscriptions', 50_000_00, businessId, {
            counterparty: 'Netflix Nigeria',
          }),
          makeExpense('rent', 200_000_00, businessId),
        ],
      });

      const insights = await optimizer.analyze(ctx);
      const dupInsights = insights.filter((i) => i.type === 'duplicate_subscription');
      expect(dupInsights).toHaveLength(1);
      expect(dupInsights[0]!.category).toBe('spending');

      const data = dupInsights[0]!.data as Record<string, unknown>;
      expect(data.counterparty).toBe('Netflix Nigeria');
      expect(data.occurrences).toBe(2);
    });

    it('detects subscriptions with similar but not identical amounts', async () => {
      const businessId = 'biz-similar';
      // 50K and 52K → 50/52 ≈ 0.96 > 0.9 tolerance → similar
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makeExpense('subscriptions', 50_000_00, businessId, {
            counterparty: 'SaaS Provider',
          }),
          makeExpense('subscriptions', 52_000_00, businessId, {
            counterparty: 'SaaS Provider',
          }),
          makeExpense('rent', 200_000_00, businessId),
        ],
      });

      const insights = await optimizer.analyze(ctx);
      const dupInsights = insights.filter((i) => i.type === 'duplicate_subscription');
      expect(dupInsights).toHaveLength(1);
    });

    it('does not flag subscriptions with very different amounts', async () => {
      const businessId = 'biz-diff';
      // 50K and 100K → 50/100 = 0.5 < 0.9 tolerance → not similar
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makeExpense('subscriptions', 50_000_00, businessId, {
            counterparty: 'Cloud Provider',
          }),
          makeExpense('subscriptions', 100_000_00, businessId, {
            counterparty: 'Cloud Provider',
          }),
          makeExpense('rent', 200_000_00, businessId),
        ],
      });

      const insights = await optimizer.analyze(ctx);
      const dupInsights = insights.filter((i) => i.type === 'duplicate_subscription');
      expect(dupInsights).toHaveLength(0);
    });

    it('does not flag single transactions to a counterparty', async () => {
      const businessId = 'biz-single';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makeExpense('subscriptions', 50_000_00, businessId, {
            counterparty: 'One-Time Vendor',
          }),
          makeExpense('rent', 200_000_00, businessId),
        ],
      });

      const insights = await optimizer.analyze(ctx);
      const dupInsights = insights.filter((i) => i.type === 'duplicate_subscription');
      expect(dupInsights).toHaveLength(0);
    });

    it('includes potential savings in Kobo', async () => {
      const businessId = 'biz-dup-savings';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makeExpense('subscriptions', 30_000_00, businessId, {
            counterparty: 'Streaming Service',
          }),
          makeExpense('subscriptions', 30_000_00, businessId, {
            counterparty: 'Streaming Service',
          }),
          makeExpense('subscriptions', 30_000_00, businessId, {
            counterparty: 'Streaming Service',
          }),
          makeExpense('rent', 200_000_00, businessId),
        ],
      });

      const insights = await optimizer.analyze(ctx);
      const dupInsight = insights.find((i) => i.type === 'duplicate_subscription');
      expect(dupInsight).toBeDefined();

      const data = dupInsight!.data as Record<string, unknown>;
      // 3 × 30K = 90K total, avg = 30K, savings = 90K - 30K = 60K
      expect(data.potentialSavingsKobo).toBe(60_000_00);
      expect(dupInsight!.financialImpact).toBe(60_000_00);
    });

    it('is case-insensitive for counterparty matching', async () => {
      const businessId = 'biz-case';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makeExpense('subscriptions', 50_000_00, businessId, {
            counterparty: 'Netflix Nigeria',
          }),
          makeExpense('subscriptions', 50_000_00, businessId, {
            counterparty: 'netflix nigeria',
          }),
          makeExpense('rent', 200_000_00, businessId),
        ],
      });

      const insights = await optimizer.analyze(ctx);
      const dupInsights = insights.filter((i) => i.type === 'duplicate_subscription');
      expect(dupInsights).toHaveLength(1);
    });

    it('includes action items for subscription review', async () => {
      const businessId = 'biz-dup-actions';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makeExpense('subscriptions', 50_000_00, businessId, {
            counterparty: 'SaaS Tool',
          }),
          makeExpense('subscriptions', 50_000_00, businessId, {
            counterparty: 'SaaS Tool',
          }),
          makeExpense('rent', 200_000_00, businessId),
        ],
      });

      const insights = await optimizer.analyze(ctx);
      const dupInsight = insights.find((i) => i.type === 'duplicate_subscription');
      expect(dupInsight).toBeDefined();
      expect(dupInsight!.actionItems.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── analyze() — combined scenarios ─────────────────────────────────

  describe('analyze() — combined scenarios', () => {
    it('generates both cost optimization and duplicate subscription insights', async () => {
      const businessId = 'biz-combined';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          // High-spend category (rent is way above average)
          makeExpense('rent', 800_000_00, businessId),
          makeExpense('utilities', 50_000_00, businessId),
          makeExpense('supplies', 50_000_00, businessId),
          // Duplicate subscription
          makeExpense('subscriptions', 30_000_00, businessId, {
            counterparty: 'Cloud SaaS',
          }),
          makeExpense('subscriptions', 30_000_00, businessId, {
            counterparty: 'Cloud SaaS',
          }),
        ],
      });

      const insights = await optimizer.analyze(ctx);
      const costInsights = insights.filter((i) => i.type === 'cost_optimization');
      const dupInsights = insights.filter((i) => i.type === 'duplicate_subscription');

      expect(costInsights.length).toBeGreaterThanOrEqual(1);
      expect(dupInsights.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// ─── Pure helper tests ─────────────────────────────────────────────────────

describe('groupSpendingByCategory()', () => {
  it('groups expenses by category with correct totals', () => {
    const expenses = [
      makeExpense('rent', 200_000_00, 'biz'),
      makeExpense('rent', 100_000_00, 'biz'),
      makeExpense('utilities', 50_000_00, 'biz'),
    ];

    const groups = groupSpendingByCategory(expenses);
    expect(groups.size).toBe(2);
    expect(groups.get('rent')!.totalKobo).toBe(300_000_00);
    expect(groups.get('rent')!.transactions).toHaveLength(2);
    expect(groups.get('utilities')!.totalKobo).toBe(50_000_00);
  });

  it('returns empty map for empty input', () => {
    const groups = groupSpendingByCategory([]);
    expect(groups.size).toBe(0);
  });
});

describe('calculateMeanCategorySpend()', () => {
  it('calculates correct mean', () => {
    const map = new Map<string, { totalKobo: number }>([
      ['rent', { totalKobo: 300_000_00 }],
      ['utilities', { totalKobo: 100_000_00 }],
      ['supplies', { totalKobo: 200_000_00 }],
    ]);
    // (300K + 100K + 200K) / 3 = 200K
    expect(calculateMeanCategorySpend(map)).toBe(200_000_00);
  });

  it('returns 0 for empty map', () => {
    expect(calculateMeanCategorySpend(new Map())).toBe(0);
  });
});

describe('findAboveAverageCategories()', () => {
  it('finds categories above the multiplier threshold', () => {
    const expenses = [
      makeExpense('rent', 500_000_00, 'biz'),
      makeExpense('utilities', 100_000_00, 'biz'),
      makeExpense('supplies', 100_000_00, 'biz'),
    ];
    const groups = groupSpendingByCategory(expenses);
    const above = findAboveAverageCategories(groups);

    expect(above).toHaveLength(1);
    expect(above[0]!.category).toBe('rent');
  });

  it('returns empty array when no categories are above threshold', () => {
    const expenses = [
      makeExpense('rent', 100_000_00, 'biz'),
      makeExpense('utilities', 100_000_00, 'biz'),
    ];
    const groups = groupSpendingByCategory(expenses);
    const above = findAboveAverageCategories(groups);

    expect(above).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    const above = findAboveAverageCategories(new Map());
    expect(above).toHaveLength(0);
  });

  it('sorts results by total spend descending', () => {
    const expenses = [
      makeExpense('rent', 600_000_00, 'biz'),
      makeExpense('marketing', 500_000_00, 'biz'),
      makeExpense('utilities', 50_000_00, 'biz'),
      makeExpense('supplies', 50_000_00, 'biz'),
    ];
    const groups = groupSpendingByCategory(expenses);
    const above = findAboveAverageCategories(groups);

    expect(above.length).toBeGreaterThanOrEqual(2);
    expect(above[0]!.totalKobo).toBeGreaterThanOrEqual(above[1]!.totalKobo);
  });
});

describe('findDuplicateSubscriptions()', () => {
  it('finds recurring charges to the same counterparty', () => {
    const expenses = [
      makeExpense('sub', 50_000_00, 'biz', { counterparty: 'Netflix' }),
      makeExpense('sub', 50_000_00, 'biz', { counterparty: 'Netflix' }),
    ];
    const dups = findDuplicateSubscriptions(expenses);

    expect(dups).toHaveLength(1);
    expect(dups[0]!.counterparty).toBe('Netflix');
    expect(dups[0]!.transactions).toHaveLength(2);
  });

  it('ignores transactions with empty counterparty', () => {
    const expenses = [
      makeExpense('sub', 50_000_00, 'biz', { counterparty: '' }),
      makeExpense('sub', 50_000_00, 'biz', { counterparty: '' }),
    ];
    const dups = findDuplicateSubscriptions(expenses);
    expect(dups).toHaveLength(0);
  });

  it('ignores zero-amount transactions', () => {
    const expenses = [
      makeExpense('sub', 0, 'biz', { counterparty: 'FreeService' }),
      makeExpense('sub', 0, 'biz', { counterparty: 'FreeService' }),
    ];
    const dups = findDuplicateSubscriptions(expenses);
    expect(dups).toHaveLength(0);
  });

  it('returns empty array when no duplicates exist', () => {
    const expenses = [
      makeExpense('sub', 50_000_00, 'biz', { counterparty: 'Vendor A' }),
      makeExpense('sub', 50_000_00, 'biz', { counterparty: 'Vendor B' }),
    ];
    const dups = findDuplicateSubscriptions(expenses);
    expect(dups).toHaveLength(0);
  });

  it('sorts results by total spend descending', () => {
    const expenses = [
      makeExpense('sub', 30_000_00, 'biz', { counterparty: 'Cheap Service' }),
      makeExpense('sub', 30_000_00, 'biz', { counterparty: 'Cheap Service' }),
      makeExpense('sub', 80_000_00, 'biz', { counterparty: 'Expensive Service' }),
      makeExpense('sub', 80_000_00, 'biz', { counterparty: 'Expensive Service' }),
    ];
    const dups = findDuplicateSubscriptions(expenses);

    expect(dups).toHaveLength(2);
    expect(dups[0]!.totalKobo).toBeGreaterThanOrEqual(dups[1]!.totalKobo);
  });
});

describe('CostOptimizer constants', () => {
  it('above-average multiplier is 1.5', () => {
    expect(ABOVE_AVERAGE_MULTIPLIER).toBe(1.5);
  });

  it('duplicate amount tolerance is 0.9', () => {
    expect(DUPLICATE_AMOUNT_TOLERANCE).toBe(0.9);
  });
});
