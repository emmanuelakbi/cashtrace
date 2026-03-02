/**
 * Personal Spending Analyzer for the Insights Engine.
 *
 * Identifies personal spending patterns mixed with business transactions and
 * generates insights when personal spending exceeds thresholds.
 *
 * Personal spending categories:
 * - entertainment
 * - personal_shopping
 * - family_transfers
 * - personal_transport
 * - personal_health
 * - personal_education
 *
 * Threshold: personal spending > 10% of monthly business expenses triggers
 * a medium-priority insight.
 *
 * All amounts are in Kobo (integers) for precision.
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.6**
 *
 * @module insights/analyzers/spendingAnalyzer
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  ActionItem,
  AnalysisContext,
  DataRequirement,
  InsightCategory,
  RawInsight,
  Transaction,
} from '../types/index.js';
import { formatNaira } from '../types/index.js';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Categories considered personal spending. */
export const PERSONAL_SPENDING_CATEGORIES = [
  'entertainment',
  'personal_shopping',
  'family_transfers',
  'personal_transport',
  'personal_health',
  'personal_education',
] as const;

export type PersonalSpendingCategory = (typeof PERSONAL_SPENDING_CATEGORIES)[number];

/**
 * Threshold percentage (0–1) above which personal spending triggers an insight.
 * 10% of monthly business expenses.
 */
export const PERSONAL_SPENDING_THRESHOLD = 0.1;

/**
 * Keywords in transaction descriptions that hint at business entertainment
 * rather than personal entertainment. These transactions should NOT be
 * flagged as personal spending even when their category is "entertainment".
 *
 * **Validates: Requirement 2.6**
 */
export const BUSINESS_ENTERTAINMENT_KEYWORDS = [
  'client',
  'meeting',
  'conference',
  'seminar',
  'workshop',
  'corporate',
  'team',
  'staff',
  'business lunch',
  'business dinner',
  'networking',
] as const;

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Filter transactions to only debit (expense) items. */
function getExpenseTransactions(transactions: Transaction[]): Transaction[] {
  return transactions.filter((tx) => tx.type === 'debit');
}

/** Sum the Kobo amounts of the given transactions. */
function sumAmountKobo(transactions: Transaction[]): number {
  return transactions.reduce((total, tx) => total + tx.amountKobo, 0);
}

/**
 * Check whether a transaction description contains business entertainment
 * keywords, indicating it is a legitimate business expense rather than
 * personal spending.
 *
 * **Validates: Requirement 2.6**
 */
export function isBusinessEntertainment(transaction: Transaction): boolean {
  if (transaction.category !== 'entertainment') {
    return false;
  }
  const desc = transaction.description.toLowerCase();
  return BUSINESS_ENTERTAINMENT_KEYWORDS.some((keyword) => desc.includes(keyword));
}

/**
 * Check whether a transaction matches a personal spending category.
 *
 * Entertainment transactions that contain business-related keywords are
 * excluded to avoid false positives.
 *
 * **Validates: Requirements 2.1, 2.2, 2.6**
 */
export function isPersonalSpending(transaction: Transaction): boolean {
  const category = transaction.category as string;
  if (!PERSONAL_SPENDING_CATEGORIES.includes(category as PersonalSpendingCategory)) {
    return false;
  }
  // Requirement 2.6 — do not flag legitimate business entertainment
  if (isBusinessEntertainment(transaction)) {
    return false;
  }
  return true;
}

/**
 * Calculate the personal spending percentage relative to total expenses.
 * Returns a value between 0 and 1 (e.g. 0.15 = 15%).
 * Returns 0 when there are no expenses.
 */
export function calculatePersonalSpendingPercentage(
  personalSpendingKobo: number,
  totalExpensesKobo: number,
): number {
  if (totalExpensesKobo <= 0) return 0;
  return personalSpendingKobo / totalExpensesKobo;
}

// ─── SpendingAnalyzer ──────────────────────────────────────────────────────

export class SpendingAnalyzer {
  /**
   * Analyse transactions and produce personal-spending-related insights.
   *
   * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
   */
  async analyze(context: AnalysisContext): Promise<RawInsight[]> {
    const insights: RawInsight[] = [];
    const expenses = getExpenseTransactions(context.transactions);

    if (expenses.length === 0) {
      return insights;
    }

    const totalExpensesKobo = sumAmountKobo(expenses);
    const personalTxs = expenses.filter(isPersonalSpending);
    const personalSpendingKobo = sumAmountKobo(personalTxs);

    const percentage = calculatePersonalSpendingPercentage(personalSpendingKobo, totalExpensesKobo);

    // Requirement 2.3 — medium-priority insight when personal spending > 10%
    if (percentage > PERSONAL_SPENDING_THRESHOLD && personalTxs.length > 0) {
      insights.push(
        this.buildPersonalSpendingInsight(
          personalTxs,
          personalSpendingKobo,
          totalExpensesKobo,
          percentage,
        ),
      );
    }

    return insights;
  }

  /** Return the insight category this analyzer covers. */
  getCategory(): InsightCategory {
    return 'spending';
  }

  /** Declare the data this analyzer needs. */
  getRequiredData(): DataRequirement[] {
    return [
      {
        source: 'transaction-engine',
        fields: ['type', 'amountKobo', 'category', 'description', 'date'],
        required: true,
      },
    ];
  }

  // ── Private builders ───────────────────────────────────────────────────

  /**
   * Build a medium-priority insight for personal spending exceeding 10%.
   *
   * **Validates: Requirements 2.3, 2.4**
   */
  private buildPersonalSpendingInsight(
    personalTxs: Transaction[],
    personalSpendingKobo: number,
    totalExpensesKobo: number,
    percentage: number,
  ): RawInsight {
    const percentDisplay = Math.round(percentage * 100);

    const actionItems: ActionItem[] = [
      {
        id: uuidv4(),
        description: 'Review flagged personal transactions and recategorize if needed',
        actionType: 'navigate',
        actionData: { screen: 'transaction_review' },
        completed: false,
      },
      {
        id: uuidv4(),
        description: 'Consider opening a separate personal account for non-business expenses',
        actionType: 'navigate',
        actionData: { screen: 'financial_tips' },
        completed: false,
      },
    ];

    return {
      category: 'spending',
      type: 'personal_spending',
      title: `Personal spending is ${percentDisplay}% of business expenses`,
      body:
        `${personalTxs.length} transaction(s) totalling ${formatNaira(personalSpendingKobo)} ` +
        `appear to be personal expenses, representing ${percentDisplay}% of your ` +
        `${formatNaira(totalExpensesKobo)} monthly business expenses. ` +
        `Mixing personal and business finances can complicate tax filing and audits.`,
      data: {
        personalSpendingKobo,
        totalExpensesKobo,
        percentage: Math.round(percentage * 10000) / 10000, // 4 decimal places
        thresholdPercentage: PERSONAL_SPENDING_THRESHOLD,
        flaggedTransactionIds: personalTxs.map((tx) => tx.id),
        flaggedTransactionCount: personalTxs.length,
        categoryCounts: this.countByCategory(personalTxs),
      },
      actionItems,
      financialImpact: personalSpendingKobo,
      urgency: 50,
      confidence: 75,
    };
  }

  /** Count flagged transactions by personal spending category. */
  private countByCategory(transactions: Transaction[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const tx of transactions) {
      counts[tx.category] = (counts[tx.category] ?? 0) + 1;
    }
    return counts;
  }
}
