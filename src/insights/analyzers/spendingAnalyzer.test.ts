/**
 * Unit tests for SpendingAnalyzer.
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.6**
 *
 * @module insights/analyzers/spendingAnalyzer.test
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { makeAnalysisContext, makeBusinessProfile, makeTransaction } from '../test/fixtures.js';

import {
  BUSINESS_ENTERTAINMENT_KEYWORDS,
  calculatePersonalSpendingPercentage,
  isBusinessEntertainment,
  isPersonalSpending,
  PERSONAL_SPENDING_CATEGORIES,
  PERSONAL_SPENDING_THRESHOLD,
  SpendingAnalyzer,
} from './spendingAnalyzer.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Create a personal spending debit transaction. */
function makePersonalTx(
  category: string,
  amountKobo: number,
  businessId: string,
  overrides: Partial<ReturnType<typeof makeTransaction>> = {},
): ReturnType<typeof makeTransaction> {
  return makeTransaction({
    businessId,
    type: 'debit',
    amountKobo,
    category,
    description: `Personal ${category} expense`,
    ...overrides,
  });
}

/** Create a business debit transaction. */
function makeBusinessTx(
  amountKobo: number,
  businessId: string,
  overrides: Partial<ReturnType<typeof makeTransaction>> = {},
): ReturnType<typeof makeTransaction> {
  return makeTransaction({
    businessId,
    type: 'debit',
    amountKobo,
    category: 'office_supplies',
    description: 'Office supplies purchase',
    ...overrides,
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('SpendingAnalyzer', () => {
  let analyzer: SpendingAnalyzer;

  beforeEach(() => {
    analyzer = new SpendingAnalyzer();
  });

  // ── getCategory() ──────────────────────────────────────────────────────

  describe('getCategory()', () => {
    it('returns "spending"', () => {
      expect(analyzer.getCategory()).toBe('spending');
    });
  });

  // ── getRequiredData() ──────────────────────────────────────────────────

  describe('getRequiredData()', () => {
    it('requires transaction data', () => {
      const requirements = analyzer.getRequiredData();
      expect(requirements).toHaveLength(1);
      expect(requirements[0]!.source).toBe('transaction-engine');
      expect(requirements[0]!.required).toBe(true);
    });

    it('requires category and description fields', () => {
      const requirements = analyzer.getRequiredData();
      const fields = requirements[0]!.fields;
      expect(fields).toContain('category');
      expect(fields).toContain('description');
    });
  });

  // ── analyze() — no transactions ────────────────────────────────────────

  describe('analyze() — empty / no expenses', () => {
    it('returns no insights when there are no transactions', async () => {
      const ctx = makeAnalysisContext({ transactions: [] });
      const insights = await analyzer.analyze(ctx);
      expect(insights).toHaveLength(0);
    });

    it('returns no insights when there are only credit transactions', async () => {
      const ctx = makeAnalysisContext({
        transactions: [makeTransaction({ type: 'credit', amountKobo: 1_000_000_00 })],
      });
      const insights = await analyzer.analyze(ctx);
      expect(insights).toHaveLength(0);
    });
  });

  // ── analyze() — Requirement 2.1, 2.2 (personal spending detection) ────

  describe('analyze() — personal spending detection (Req 2.1, 2.2)', () => {
    it('identifies personal spending in entertainment category', async () => {
      const businessId = 'biz-spend';
      // 20% personal spending (above 10% threshold)
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makePersonalTx('entertainment', 200_000_00, businessId),
          makeBusinessTx(800_000_00, businessId),
        ],
      });

      const insights = await analyzer.analyze(ctx);
      expect(insights).toHaveLength(1);
      expect(insights[0]!.type).toBe('personal_spending');
    });

    it('identifies personal spending across all personal categories', async () => {
      const businessId = 'biz-multi';
      const personalTxs = PERSONAL_SPENDING_CATEGORIES.map((cat) =>
        makePersonalTx(cat, 50_000_00, businessId),
      );
      // 6 categories × ₦50K = ₦300K personal, ₦300K business → 50%
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [...personalTxs, makeBusinessTx(300_000_00, businessId)],
      });

      const insights = await analyzer.analyze(ctx);
      expect(insights).toHaveLength(1);
      const data = insights[0]!.data as Record<string, unknown>;
      expect(data.flaggedTransactionCount).toBe(6);
    });
  });

  // ── analyze() — Requirement 2.3 (threshold) ───────────────────────────

  describe('analyze() — 10% threshold (Req 2.3)', () => {
    it('generates medium-priority insight when personal spending exceeds 10%', async () => {
      const businessId = 'biz-threshold';
      // 15% personal spending
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makePersonalTx('personal_shopping', 150_000_00, businessId),
          makeBusinessTx(850_000_00, businessId),
        ],
      });

      const insights = await analyzer.analyze(ctx);
      expect(insights).toHaveLength(1);
      expect(insights[0]!.category).toBe('spending');
      expect(insights[0]!.type).toBe('personal_spending');
    });

    it('does not generate insight when personal spending is exactly 10%', async () => {
      const businessId = 'biz-exact';
      // Exactly 10% — threshold is "exceeds", not "equals"
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makePersonalTx('entertainment', 100_000_00, businessId),
          makeBusinessTx(900_000_00, businessId),
        ],
      });

      const insights = await analyzer.analyze(ctx);
      expect(insights).toHaveLength(0);
    });

    it('does not generate insight when personal spending is below 10%', async () => {
      const businessId = 'biz-below';
      // 5% personal spending
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makePersonalTx('family_transfers', 50_000_00, businessId),
          makeBusinessTx(950_000_00, businessId),
        ],
      });

      const insights = await analyzer.analyze(ctx);
      expect(insights).toHaveLength(0);
    });

    it('does not generate insight when there are no personal transactions', async () => {
      const businessId = 'biz-none';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makeBusinessTx(500_000_00, businessId),
          makeBusinessTx(500_000_00, businessId),
        ],
      });

      const insights = await analyzer.analyze(ctx);
      expect(insights).toHaveLength(0);
    });
  });

  // ── analyze() — Requirement 2.4 (list transactions) ───────────────────

  describe('analyze() — flagged transactions (Req 2.4)', () => {
    it('lists flagged transaction IDs in insight data', async () => {
      const businessId = 'biz-list';
      const personalTx1 = makePersonalTx('entertainment', 100_000_00, businessId);
      const personalTx2 = makePersonalTx('family_transfers', 100_000_00, businessId);

      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [personalTx1, personalTx2, makeBusinessTx(600_000_00, businessId)],
      });

      const insights = await analyzer.analyze(ctx);
      expect(insights).toHaveLength(1);

      const data = insights[0]!.data as Record<string, unknown>;
      const flaggedIds = data.flaggedTransactionIds as string[];
      expect(flaggedIds).toContain(personalTx1.id);
      expect(flaggedIds).toContain(personalTx2.id);
      expect(flaggedIds).toHaveLength(2);
    });

    it('includes category counts in insight data', async () => {
      const businessId = 'biz-cats';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makePersonalTx('entertainment', 80_000_00, businessId),
          makePersonalTx('entertainment', 60_000_00, businessId),
          makePersonalTx('family_transfers', 70_000_00, businessId),
          makeBusinessTx(500_000_00, businessId),
        ],
      });

      const insights = await analyzer.analyze(ctx);
      expect(insights).toHaveLength(1);

      const data = insights[0]!.data as Record<string, unknown>;
      const categoryCounts = data.categoryCounts as Record<string, number>;
      expect(categoryCounts.entertainment).toBe(2);
      expect(categoryCounts.family_transfers).toBe(1);
    });

    it('includes financial amounts in Kobo', async () => {
      const businessId = 'biz-kobo';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makePersonalTx('personal_shopping', 200_000_00, businessId),
          makeBusinessTx(800_000_00, businessId),
        ],
      });

      const insights = await analyzer.analyze(ctx);
      expect(insights).toHaveLength(1);

      const data = insights[0]!.data as Record<string, unknown>;
      expect(data.personalSpendingKobo).toBe(200_000_00);
      expect(data.totalExpensesKobo).toBe(1_000_000_00);
      expect(insights[0]!.financialImpact).toBe(200_000_00);
    });

    it('includes action items for review', async () => {
      const businessId = 'biz-actions';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makePersonalTx('personal_transport', 200_000_00, businessId),
          makeBusinessTx(800_000_00, businessId),
        ],
      });

      const insights = await analyzer.analyze(ctx);
      expect(insights).toHaveLength(1);
      expect(insights[0]!.actionItems.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── analyze() — Requirement 2.6 (business entertainment) ──────────────

  describe('analyze() — business entertainment exclusion (Req 2.6)', () => {
    it('does not flag entertainment with business keywords as personal', async () => {
      const businessId = 'biz-ent';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makePersonalTx('entertainment', 200_000_00, businessId, {
            description: 'Client dinner at Eko Hotel',
          }),
          makeBusinessTx(800_000_00, businessId),
        ],
      });

      const insights = await analyzer.analyze(ctx);
      // Business entertainment should not be flagged, so 0% personal → no insight
      expect(insights).toHaveLength(0);
    });

    it('flags entertainment without business keywords as personal', async () => {
      const businessId = 'biz-personal-ent';
      const ctx = makeAnalysisContext({
        businessId,
        businessProfile: makeBusinessProfile({ id: businessId }),
        transactions: [
          makePersonalTx('entertainment', 200_000_00, businessId, {
            description: 'Movie tickets and popcorn',
          }),
          makeBusinessTx(800_000_00, businessId),
        ],
      });

      const insights = await analyzer.analyze(ctx);
      expect(insights).toHaveLength(1);
    });
  });
});

// ─── Pure helper tests ─────────────────────────────────────────────────────

describe('isPersonalSpending()', () => {
  it('returns true for each personal spending category', () => {
    for (const category of PERSONAL_SPENDING_CATEGORIES) {
      const tx = makeTransaction({
        type: 'debit',
        category,
        description: `${category} expense`,
      });
      expect(isPersonalSpending(tx)).toBe(true);
    }
  });

  it('returns false for non-personal categories', () => {
    const nonPersonal = ['sales', 'office_supplies', 'rent', 'utilities', 'payroll'];
    for (const category of nonPersonal) {
      const tx = makeTransaction({ type: 'debit', category });
      expect(isPersonalSpending(tx)).toBe(false);
    }
  });

  it('returns false for entertainment with business keywords', () => {
    const tx = makeTransaction({
      type: 'debit',
      category: 'entertainment',
      description: 'Team building event at resort',
    });
    expect(isPersonalSpending(tx)).toBe(false);
  });
});

describe('isBusinessEntertainment()', () => {
  it('returns true for entertainment with business keywords', () => {
    for (const keyword of BUSINESS_ENTERTAINMENT_KEYWORDS) {
      const tx = makeTransaction({
        type: 'debit',
        category: 'entertainment',
        description: `Expense for ${keyword} event`,
      });
      expect(isBusinessEntertainment(tx)).toBe(true);
    }
  });

  it('returns false for non-entertainment categories even with business keywords', () => {
    const tx = makeTransaction({
      type: 'debit',
      category: 'personal_shopping',
      description: 'Client gift purchase',
    });
    expect(isBusinessEntertainment(tx)).toBe(false);
  });

  it('returns false for entertainment without business keywords', () => {
    const tx = makeTransaction({
      type: 'debit',
      category: 'entertainment',
      description: 'Cinema tickets for weekend',
    });
    expect(isBusinessEntertainment(tx)).toBe(false);
  });

  it('is case-insensitive for keyword matching', () => {
    const tx = makeTransaction({
      type: 'debit',
      category: 'entertainment',
      description: 'CLIENT MEETING dinner',
    });
    expect(isBusinessEntertainment(tx)).toBe(true);
  });
});

describe('calculatePersonalSpendingPercentage()', () => {
  it('returns correct percentage', () => {
    expect(calculatePersonalSpendingPercentage(200, 1000)).toBe(0.2);
  });

  it('returns 0 when total expenses is 0', () => {
    expect(calculatePersonalSpendingPercentage(100, 0)).toBe(0);
  });

  it('returns 0 when personal spending is 0', () => {
    expect(calculatePersonalSpendingPercentage(0, 1000)).toBe(0);
  });

  it('returns 1 when all expenses are personal', () => {
    expect(calculatePersonalSpendingPercentage(500, 500)).toBe(1);
  });

  it('returns 0 for negative total expenses', () => {
    expect(calculatePersonalSpendingPercentage(100, -500)).toBe(0);
  });
});

describe('SpendingAnalyzer constants', () => {
  it('personal spending threshold is 10%', () => {
    expect(PERSONAL_SPENDING_THRESHOLD).toBe(0.1);
  });

  it('has 6 personal spending categories', () => {
    expect(PERSONAL_SPENDING_CATEGORIES).toHaveLength(6);
    expect(PERSONAL_SPENDING_CATEGORIES).toContain('entertainment');
    expect(PERSONAL_SPENDING_CATEGORIES).toContain('personal_shopping');
    expect(PERSONAL_SPENDING_CATEGORIES).toContain('family_transfers');
    expect(PERSONAL_SPENDING_CATEGORIES).toContain('personal_transport');
    expect(PERSONAL_SPENDING_CATEGORIES).toContain('personal_health');
    expect(PERSONAL_SPENDING_CATEGORIES).toContain('personal_education');
  });
});
