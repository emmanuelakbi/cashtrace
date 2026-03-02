/**
 * Cost Optimization Analyzer for the Insights Engine.
 *
 * Identifies cost optimization opportunities by:
 * - Detecting categories with above-average spending (>1.5× the mean)
 * - Finding duplicate/redundant subscriptions (recurring charges to the same
 *   counterparty with similar amounts)
 *
 * All amounts are in Kobo (integers) for precision.
 *
 * **Validates: Requirements 4.1, 4.5**
 *
 * @module insights/analyzers/costOptimizer
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

/**
 * Multiplier above the mean category spend that triggers a cost optimization
 * insight. A category spending more than 1.5× the average is flagged.
 */
export const ABOVE_AVERAGE_MULTIPLIER = 1.5;

/**
 * Tolerance ratio for detecting duplicate subscriptions. Two recurring
 * amounts are considered "similar" when the smaller is at least this
 * fraction of the larger (i.e. within 10% of each other).
 */
export const DUPLICATE_AMOUNT_TOLERANCE = 0.9;

/**
 * Minimum number of transactions to the same counterparty required before
 * they are considered a recurring subscription.
 */
export const MIN_RECURRING_COUNT = 2;

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
 * Group expense transactions by category and return total spend per category.
 */
export function groupSpendingByCategory(
  expenses: Transaction[],
): Map<string, { totalKobo: number; transactions: Transaction[] }> {
  const groups = new Map<string, { totalKobo: number; transactions: Transaction[] }>();

  for (const tx of expenses) {
    const existing = groups.get(tx.category);
    if (existing) {
      existing.totalKobo += tx.amountKobo;
      existing.transactions.push(tx);
    } else {
      groups.set(tx.category, { totalKobo: tx.amountKobo, transactions: [tx] });
    }
  }

  return groups;
}

/**
 * Calculate the mean spending across all categories.
 * Returns 0 when there are no categories.
 */
export function calculateMeanCategorySpend(
  categorySpending: Map<string, { totalKobo: number }>,
): number {
  if (categorySpending.size === 0) return 0;

  let total = 0;
  for (const { totalKobo } of categorySpending.values()) {
    total += totalKobo;
  }
  return Math.round(total / categorySpending.size);
}

/**
 * Identify categories where spending exceeds the mean by the given multiplier.
 *
 * **Validates: Requirement 4.1**
 */
export function findAboveAverageCategories(
  categorySpending: Map<string, { totalKobo: number; transactions: Transaction[] }>,
  multiplier: number = ABOVE_AVERAGE_MULTIPLIER,
): { category: string; totalKobo: number; meanKobo: number; transactions: Transaction[] }[] {
  const meanKobo = calculateMeanCategorySpend(categorySpending);
  if (meanKobo === 0) return [];

  const threshold = Math.round(meanKobo * multiplier);
  const results: {
    category: string;
    totalKobo: number;
    meanKobo: number;
    transactions: Transaction[];
  }[] = [];

  for (const [category, data] of categorySpending.entries()) {
    if (data.totalKobo > threshold) {
      results.push({
        category,
        totalKobo: data.totalKobo,
        meanKobo,
        transactions: data.transactions,
      });
    }
  }

  // Sort by total spend descending for consistent output
  results.sort((a, b) => b.totalKobo - a.totalKobo);
  return results;
}

/** A group of recurring transactions to the same counterparty. */
export interface DuplicateSubscription {
  counterparty: string;
  transactions: Transaction[];
  totalKobo: number;
  averageAmountKobo: number;
}

/**
 * Detect duplicate/redundant subscriptions by finding recurring transactions
 * to the same counterparty with similar amounts.
 *
 * Two transactions are "similar" when the smaller amount is at least
 * `DUPLICATE_AMOUNT_TOLERANCE` of the larger.
 *
 * **Validates: Requirement 4.5**
 */
export function findDuplicateSubscriptions(
  expenses: Transaction[],
  minCount: number = MIN_RECURRING_COUNT,
  tolerance: number = DUPLICATE_AMOUNT_TOLERANCE,
): DuplicateSubscription[] {
  // Group by normalised counterparty name
  const byCounterparty = new Map<string, Transaction[]>();
  for (const tx of expenses) {
    const key = tx.counterparty.trim().toLowerCase();
    if (!key) continue;
    const existing = byCounterparty.get(key);
    if (existing) {
      existing.push(tx);
    } else {
      byCounterparty.set(key, [tx]);
    }
  }

  const duplicates: DuplicateSubscription[] = [];

  for (const [, txs] of byCounterparty.entries()) {
    if (txs.length < minCount) continue;

    // Check if amounts are similar (within tolerance)
    const amounts = txs.map((tx) => tx.amountKobo);
    const maxAmount = Math.max(...amounts);
    const minAmount = Math.min(...amounts);

    if (maxAmount === 0) continue;
    if (minAmount / maxAmount >= tolerance) {
      const totalKobo = sumAmountKobo(txs);
      duplicates.push({
        counterparty: txs[0]!.counterparty,
        transactions: txs,
        totalKobo,
        averageAmountKobo: Math.round(totalKobo / txs.length),
      });
    }
  }

  // Sort by total spend descending
  duplicates.sort((a, b) => b.totalKobo - a.totalKobo);
  return duplicates;
}

// ─── CostOptimizer ─────────────────────────────────────────────────────────

export class CostOptimizer {
  /**
   * Analyse transactions and produce cost-optimization-related insights.
   *
   * **Validates: Requirements 4.1, 4.5**
   */
  async analyze(context: AnalysisContext): Promise<RawInsight[]> {
    const insights: RawInsight[] = [];
    const expenses = getExpenseTransactions(context.transactions);

    if (expenses.length === 0) {
      return insights;
    }

    // Requirement 4.1 — above-average spending categories
    const categorySpending = groupSpendingByCategory(expenses);
    const aboveAverage = findAboveAverageCategories(categorySpending);

    for (const entry of aboveAverage) {
      insights.push(this.buildAboveAverageInsight(entry, categorySpending.size));
    }

    // Requirement 4.5 — duplicate/redundant subscriptions
    const duplicates = findDuplicateSubscriptions(expenses);

    for (const dup of duplicates) {
      insights.push(this.buildDuplicateSubscriptionInsight(dup));
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
        fields: ['type', 'amountKobo', 'category', 'description', 'counterparty', 'date'],
        required: true,
      },
    ];
  }

  // ── Private builders ───────────────────────────────────────────────────

  /**
   * Build a cost_optimization insight for an above-average spending category.
   *
   * **Validates: Requirements 4.1, 4.4**
   */
  private buildAboveAverageInsight(
    entry: {
      category: string;
      totalKobo: number;
      meanKobo: number;
      transactions: Transaction[];
    },
    categoryCount: number,
  ): RawInsight {
    const excessKobo = entry.totalKobo - entry.meanKobo;
    const multiplier =
      entry.meanKobo > 0 ? Math.round((entry.totalKobo / entry.meanKobo) * 10) / 10 : 0;

    const actionItems: ActionItem[] = [
      {
        id: uuidv4(),
        description: `Review ${entry.category} expenses and identify potential savings`,
        actionType: 'navigate',
        actionData: { screen: 'expense_review', category: entry.category },
        completed: false,
      },
      {
        id: uuidv4(),
        description: 'Compare vendor rates and consider alternatives',
        actionType: 'navigate',
        actionData: { screen: 'vendor_comparison' },
        completed: false,
      },
    ];

    return {
      category: 'spending',
      type: 'cost_optimization',
      title: `${entry.category} spending is ${multiplier}× the average`,
      body:
        `Your ${entry.category} expenses total ${formatNaira(entry.totalKobo)}, which is ` +
        `${multiplier}× the average category spend of ${formatNaira(entry.meanKobo)} ` +
        `across ${categoryCount} categories. ` +
        `Potential savings: ${formatNaira(excessKobo)}.`,
      data: {
        category: entry.category,
        totalKobo: entry.totalKobo,
        meanKobo: entry.meanKobo,
        excessKobo,
        multiplier,
        transactionCount: entry.transactions.length,
        transactionIds: entry.transactions.map((tx) => tx.id),
      },
      actionItems,
      financialImpact: excessKobo,
      urgency: 40,
      confidence: 70,
    };
  }

  /**
   * Build a duplicate_subscription insight for recurring charges to the same
   * counterparty.
   *
   * **Validates: Requirements 4.4, 4.5**
   */
  private buildDuplicateSubscriptionInsight(dup: DuplicateSubscription): RawInsight {
    // Potential savings = total minus one occurrence (keep one subscription)
    const potentialSavingsKobo = dup.totalKobo - dup.averageAmountKobo;

    const actionItems: ActionItem[] = [
      {
        id: uuidv4(),
        description: `Review ${dup.transactions.length} recurring charges to ${dup.counterparty}`,
        actionType: 'navigate',
        actionData: {
          screen: 'subscription_review',
          counterparty: dup.counterparty,
        },
        completed: false,
      },
      {
        id: uuidv4(),
        description: 'Cancel redundant subscriptions if applicable',
        actionType: 'navigate',
        actionData: { screen: 'subscription_management' },
        completed: false,
      },
    ];

    return {
      category: 'spending',
      type: 'duplicate_subscription',
      title: `Possible duplicate subscription: ${dup.counterparty}`,
      body:
        `${dup.transactions.length} recurring charges to ${dup.counterparty} detected, ` +
        `averaging ${formatNaira(dup.averageAmountKobo)} each, ` +
        `totalling ${formatNaira(dup.totalKobo)}. ` +
        `Potential savings if duplicates are removed: ${formatNaira(potentialSavingsKobo)}.`,
      data: {
        counterparty: dup.counterparty,
        totalKobo: dup.totalKobo,
        averageAmountKobo: dup.averageAmountKobo,
        occurrences: dup.transactions.length,
        potentialSavingsKobo,
        transactionIds: dup.transactions.map((tx) => tx.id),
      },
      actionItems,
      financialImpact: potentialSavingsKobo,
      urgency: 35,
      confidence: 65,
    };
  }
}
