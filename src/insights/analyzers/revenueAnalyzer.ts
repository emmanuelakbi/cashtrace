/**
 * Revenue Pattern Analyzer for the Insights Engine.
 *
 * Identifies high-performing products/services by grouping credit transactions
 * by category, and detects seasonal revenue patterns by analysing monthly
 * revenue distribution.
 *
 * All amounts are in Kobo (integers) for precision.
 *
 * **Validates: Requirements 5.1, 5.3**
 *
 * @module insights/analyzers/revenueAnalyzer
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

/** Minimum number of credit transactions required to run analysis. */
export const MIN_REVENUE_TRANSACTIONS = 3;

/** Number of top-performing categories to highlight. */
export const TOP_PERFORMER_COUNT = 3;

/**
 * A month is considered a "peak" when its revenue is at least this multiplier
 * above the monthly average.
 */
export const PEAK_MONTH_MULTIPLIER = 1.3;

/**
 * A month is considered a "low" when its revenue is at or below this multiplier
 * of the monthly average.
 */
export const LOW_MONTH_MULTIPLIER = 0.7;

/** Minimum distinct months of data required to detect seasonal patterns. */
export const MIN_MONTHS_FOR_SEASONAL = 3;

/** Number of top customers to highlight as high-value. */
export const HIGH_VALUE_CUSTOMER_COUNT = 5;

/** Minimum number of credit transactions from distinct counterparties for customer analysis. */
export const MIN_CUSTOMER_TRANSACTIONS = 3;

/**
 * A customer's recent-period frequency must drop by more than this ratio
 * compared to the earlier period to be flagged as declining.
 * 0.5 means a >50 % decline triggers the insight.
 */
export const FREQUENCY_DECLINE_THRESHOLD = 0.5;

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Filter transactions to only revenue (credit) items. */
function getRevenueTransactions(transactions: Transaction[]): Transaction[] {
  return transactions.filter((tx) => tx.type === 'credit');
}

/** Sum the Kobo amounts of the given transactions. */
function sumAmountKobo(transactions: Transaction[]): number {
  return transactions.reduce((total, tx) => total + tx.amountKobo, 0);
}

/** Represents revenue grouped by category. */
export interface CategoryRevenue {
  category: string;
  totalKobo: number;
  transactionCount: number;
  percentage: number; // 0-100
}

/** Group credit transactions by category and compute totals. */
export function groupRevenueByCategory(transactions: Transaction[]): CategoryRevenue[] {
  const map = new Map<string, { totalKobo: number; count: number }>();

  for (const tx of transactions) {
    const existing = map.get(tx.category);
    if (existing) {
      existing.totalKobo += tx.amountKobo;
      existing.count += 1;
    } else {
      map.set(tx.category, { totalKobo: tx.amountKobo, count: 1 });
    }
  }

  const grandTotal = sumAmountKobo(transactions);

  return Array.from(map.entries())
    .map(([category, { totalKobo, count }]) => ({
      category,
      totalKobo,
      transactionCount: count,
      percentage: grandTotal > 0 ? Math.round((totalKobo / grandTotal) * 100) : 0,
    }))
    .sort((a, b) => b.totalKobo - a.totalKobo);
}

/** Represents revenue for a single month. */
export interface MonthlyRevenue {
  /** Format: "YYYY-MM" */
  month: string;
  totalKobo: number;
  transactionCount: number;
}

/** Group credit transactions by calendar month (WAT). */
export function groupRevenueByMonth(transactions: Transaction[]): MonthlyRevenue[] {
  const map = new Map<string, { totalKobo: number; count: number }>();

  for (const tx of transactions) {
    // Offset to WAT (UTC+1) before extracting month
    const watDate = new Date(tx.date.getTime() + 60 * 60 * 1000);
    const key = `${watDate.getUTCFullYear()}-${String(watDate.getUTCMonth() + 1).padStart(2, '0')}`;
    const existing = map.get(key);
    if (existing) {
      existing.totalKobo += tx.amountKobo;
      existing.count += 1;
    } else {
      map.set(key, { totalKobo: tx.amountKobo, count: 1 });
    }
  }

  return Array.from(map.entries())
    .map(([month, { totalKobo, count }]) => ({
      month,
      totalKobo,
      transactionCount: count,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Identify peak and low months relative to the average. */
export function detectSeasonalPattern(
  monthlyRevenue: MonthlyRevenue[],
): { peakMonths: MonthlyRevenue[]; lowMonths: MonthlyRevenue[]; averageKobo: number } | null {
  if (monthlyRevenue.length < MIN_MONTHS_FOR_SEASONAL) {
    return null;
  }

  const totalKobo = monthlyRevenue.reduce((sum, m) => sum + m.totalKobo, 0);
  const averageKobo = Math.round(totalKobo / monthlyRevenue.length);

  if (averageKobo === 0) {
    return null;
  }

  const peakMonths = monthlyRevenue.filter(
    (m) => m.totalKobo >= Math.round(averageKobo * PEAK_MONTH_MULTIPLIER),
  );
  const lowMonths = monthlyRevenue.filter(
    (m) => m.totalKobo <= Math.round(averageKobo * LOW_MONTH_MULTIPLIER),
  );

  if (peakMonths.length === 0 && lowMonths.length === 0) {
    return null;
  }

  return { peakMonths, lowMonths, averageKobo };
}

// ─── Customer Analysis Helpers ─────────────────────────────────────────────

/** Represents revenue grouped by customer (counterparty). */
export interface CustomerRevenue {
  counterparty: string;
  totalKobo: number;
  transactionCount: number;
  /** Percentage of total revenue this customer represents (0-100). */
  percentage: number;
}

/** Group credit transactions by counterparty and compute totals. */
export function groupRevenueByCustomer(transactions: Transaction[]): CustomerRevenue[] {
  const map = new Map<string, { totalKobo: number; count: number }>();

  for (const tx of transactions) {
    if (!tx.counterparty) continue;
    const existing = map.get(tx.counterparty);
    if (existing) {
      existing.totalKobo += tx.amountKobo;
      existing.count += 1;
    } else {
      map.set(tx.counterparty, { totalKobo: tx.amountKobo, count: 1 });
    }
  }

  const grandTotal = sumAmountKobo(transactions);

  return Array.from(map.entries())
    .map(([counterparty, { totalKobo, count }]) => ({
      counterparty,
      totalKobo,
      transactionCount: count,
      percentage: grandTotal > 0 ? Math.round((totalKobo / grandTotal) * 100) : 0,
    }))
    .sort((a, b) => b.totalKobo - a.totalKobo);
}

/** A customer whose purchase frequency has declined between two periods. */
export interface DecliningCustomer {
  counterparty: string;
  earlierCount: number;
  recentCount: number;
  /** Decline ratio: 1 = 100 % drop, 0.6 = 60 % drop, etc. */
  declineRatio: number;
  totalKobo: number;
}

/**
 * Detect customers whose purchase frequency has declined significantly.
 *
 * Splits the date range in half and compares transaction counts per customer
 * between the earlier and recent halves.
 */
export function detectDecliningFrequency(
  transactions: Transaction[],
  dateRange: { start: Date; end: Date },
): DecliningCustomer[] {
  const midpoint = new Date(
    dateRange.start.getTime() + (dateRange.end.getTime() - dateRange.start.getTime()) / 2,
  );

  const customerMap = new Map<
    string,
    { earlierCount: number; recentCount: number; totalKobo: number }
  >();

  for (const tx of transactions) {
    if (!tx.counterparty) continue;
    const existing = customerMap.get(tx.counterparty) ?? {
      earlierCount: 0,
      recentCount: 0,
      totalKobo: 0,
    };
    existing.totalKobo += tx.amountKobo;
    if (tx.date < midpoint) {
      existing.earlierCount += 1;
    } else {
      existing.recentCount += 1;
    }
    customerMap.set(tx.counterparty, existing);
  }

  const declining: DecliningCustomer[] = [];

  for (const [counterparty, data] of customerMap) {
    // Need at least 1 transaction in the earlier period to measure decline
    if (data.earlierCount === 0) continue;

    const declineRatio = 1 - data.recentCount / data.earlierCount;
    if (declineRatio > FREQUENCY_DECLINE_THRESHOLD) {
      declining.push({
        counterparty,
        earlierCount: data.earlierCount,
        recentCount: data.recentCount,
        declineRatio,
        totalKobo: data.totalKobo,
      });
    }
  }

  return declining.sort((a, b) => b.totalKobo - a.totalKobo);
}

// ─── RevenueAnalyzer ───────────────────────────────────────────────────────

export class RevenueAnalyzer {
  /**
   * Analyse revenue transactions and produce revenue-related insights.
   *
   * **Validates: Requirements 5.1, 5.2, 5.3, 5.5**
   */
  async analyze(context: AnalysisContext): Promise<RawInsight[]> {
    const insights: RawInsight[] = [];
    const revenueTxs = getRevenueTransactions(context.transactions);

    if (revenueTxs.length < MIN_REVENUE_TRANSACTIONS) {
      return insights;
    }

    // Requirement 5.1 — identify high-performing products/services
    const categoryRevenue = groupRevenueByCategory(revenueTxs);
    if (categoryRevenue.length > 0) {
      insights.push(this.buildTopPerformersInsight(categoryRevenue, revenueTxs));
    }

    // Requirement 5.3 — detect seasonal patterns
    const monthlyRevenue = groupRevenueByMonth(revenueTxs);
    const seasonal = detectSeasonalPattern(monthlyRevenue);
    if (seasonal) {
      insights.push(this.buildSeasonalPatternInsight(seasonal, monthlyRevenue));
    }

    // Requirement 5.5 — identify high-value customers for retention focus
    const customerRevenue = groupRevenueByCustomer(revenueTxs);
    if (customerRevenue.length >= MIN_CUSTOMER_TRANSACTIONS) {
      insights.push(this.buildHighValueCustomerInsight(customerRevenue, revenueTxs));
    }

    // Requirement 5.2 — detect declining purchase frequency
    const declining = detectDecliningFrequency(revenueTxs, context.dateRange);
    if (declining.length > 0) {
      insights.push(this.buildCustomerRetentionInsight(declining));
    }

    return insights;
  }

  /** Return the insight category this analyzer covers. */
  getCategory(): InsightCategory {
    return 'revenue';
  }

  /** Declare the data this analyzer needs. */
  getRequiredData(): DataRequirement[] {
    return [
      {
        source: 'transaction-engine',
        fields: ['type', 'amountKobo', 'category', 'date'],
        required: true,
      },
      { source: 'business-management', fields: ['sector', 'size'], required: false },
    ];
  }

  // ── Private builders ───────────────────────────────────────────────────

  /**
   * Build an insight highlighting top-performing revenue categories.
   *
   * **Validates: Requirement 5.1**
   */
  private buildTopPerformersInsight(
    categoryRevenue: CategoryRevenue[],
    revenueTxs: Transaction[],
  ): RawInsight {
    const topN = categoryRevenue.slice(0, TOP_PERFORMER_COUNT);
    const totalRevenueKobo = sumAmountKobo(revenueTxs);
    const topRevenueKobo = topN.reduce((sum, c) => sum + c.totalKobo, 0);

    const topList = topN
      .map((c, i) => `${i + 1}. ${c.category} — ${formatNaira(c.totalKobo)} (${c.percentage}%)`)
      .join('; ');

    const actionItems: ActionItem[] = [
      {
        id: uuidv4(),
        description: `Focus marketing efforts on your top category: ${topN[0]?.category ?? 'N/A'}`,
        actionType: 'navigate',
        actionData: { screen: 'marketing_campaigns' },
        completed: false,
      },
      {
        id: uuidv4(),
        description: 'Review pricing strategy for top-performing products',
        actionType: 'navigate',
        actionData: { screen: 'pricing_settings' },
        completed: false,
      },
    ];

    return {
      category: 'revenue',
      type: 'top_performers',
      title: 'Top-performing revenue categories identified',
      body:
        `Your top revenue categories are: ${topList}. ` +
        `Together they account for ${formatNaira(topRevenueKobo)} ` +
        `of ${formatNaira(totalRevenueKobo)} total revenue. ` +
        `Consider doubling down on these areas to maximise growth.`,
      data: {
        topCategories: topN.map((c) => ({
          category: c.category,
          totalKobo: c.totalKobo,
          transactionCount: c.transactionCount,
          percentage: c.percentage,
        })),
        totalRevenueKobo,
        topRevenueKobo,
        categoryCount: categoryRevenue.length,
      },
      actionItems,
      financialImpact: topRevenueKobo,
      urgency: 40,
      confidence: 85,
    };
  }

  /**
   * Build an insight about seasonal revenue patterns.
   *
   * **Validates: Requirement 5.3**
   */
  private buildSeasonalPatternInsight(
    seasonal: { peakMonths: MonthlyRevenue[]; lowMonths: MonthlyRevenue[]; averageKobo: number },
    monthlyRevenue: MonthlyRevenue[],
  ): RawInsight {
    const peakLabels = seasonal.peakMonths.map((m) => m.month).join(', ');
    const lowLabels = seasonal.lowMonths.map((m) => m.month).join(', ');

    const parts: string[] = [];
    if (seasonal.peakMonths.length > 0) {
      parts.push(
        `Peak revenue months: ${peakLabels}. ` +
          'Prepare inventory and staffing ahead of these periods to capture maximum sales.',
      );
    }
    if (seasonal.lowMonths.length > 0) {
      parts.push(
        `Low revenue months: ${lowLabels}. ` +
          'Consider promotions or cost-reduction strategies during slower periods.',
      );
    }

    const actionItems: ActionItem[] = [];
    if (seasonal.peakMonths.length > 0) {
      actionItems.push({
        id: uuidv4(),
        description: 'Prepare inventory for upcoming peak season',
        actionType: 'navigate',
        actionData: { screen: 'inventory_management' },
        completed: false,
      });
    }
    if (seasonal.lowMonths.length > 0) {
      actionItems.push({
        id: uuidv4(),
        description: 'Plan promotions for low-revenue periods',
        actionType: 'navigate',
        actionData: { screen: 'promotions' },
        completed: false,
      });
    }

    const peakTotalKobo = seasonal.peakMonths.reduce((sum, m) => sum + m.totalKobo, 0);

    return {
      category: 'revenue',
      type: 'seasonal_pattern',
      title: 'Seasonal revenue pattern detected',
      body:
        `Your monthly average revenue is ${formatNaira(seasonal.averageKobo)}. ` + parts.join(' '),
      data: {
        peakMonths: seasonal.peakMonths.map((m) => ({
          month: m.month,
          totalKobo: m.totalKobo,
        })),
        lowMonths: seasonal.lowMonths.map((m) => ({
          month: m.month,
          totalKobo: m.totalKobo,
        })),
        averageMonthlyKobo: seasonal.averageKobo,
        monthsAnalyzed: monthlyRevenue.length,
      },
      actionItems,
      financialImpact: peakTotalKobo,
      urgency: 35,
      confidence: 75,
    };
  }

  /**
   * Build an insight highlighting high-value customers for retention focus.
   *
   * **Validates: Requirement 5.5**
   */
  private buildHighValueCustomerInsight(
    customerRevenue: CustomerRevenue[],
    revenueTxs: Transaction[],
  ): RawInsight {
    const topN = customerRevenue.slice(0, HIGH_VALUE_CUSTOMER_COUNT);
    const totalRevenueKobo = sumAmountKobo(revenueTxs);
    const topRevenueKobo = topN.reduce((sum, c) => sum + c.totalKobo, 0);

    const topList = topN
      .map((c, i) => `${i + 1}. ${c.counterparty} — ${formatNaira(c.totalKobo)} (${c.percentage}%)`)
      .join('; ');

    const actionItems: ActionItem[] = [
      {
        id: uuidv4(),
        description: `Prioritise retention for your top customer: ${topN[0]?.counterparty ?? 'N/A'}`,
        actionType: 'navigate',
        actionData: { screen: 'customer_management' },
        completed: false,
      },
      {
        id: uuidv4(),
        description: 'Consider loyalty incentives for high-value customers',
        actionType: 'navigate',
        actionData: { screen: 'promotions' },
        completed: false,
      },
    ];

    return {
      category: 'revenue',
      type: 'high_value_customer',
      title: 'High-value customers identified',
      body:
        `Your top customers by revenue are: ${topList}. ` +
        `Together they account for ${formatNaira(topRevenueKobo)} ` +
        `of ${formatNaira(totalRevenueKobo)} total revenue. ` +
        'Focus retention efforts on these key accounts to protect your revenue base.',
      data: {
        topCustomers: topN.map((c) => ({
          counterparty: c.counterparty,
          totalKobo: c.totalKobo,
          transactionCount: c.transactionCount,
          percentage: c.percentage,
        })),
        totalRevenueKobo,
        topRevenueKobo,
        customerCount: customerRevenue.length,
      },
      actionItems,
      financialImpact: topRevenueKobo,
      urgency: 45,
      confidence: 90,
    };
  }

  /**
   * Build an insight about customers with declining purchase frequency.
   *
   * **Validates: Requirement 5.2**
   */
  private buildCustomerRetentionInsight(declining: DecliningCustomer[]): RawInsight {
    const atRiskRevenueKobo = declining.reduce((sum, c) => sum + c.totalKobo, 0);

    const customerList = declining
      .slice(0, HIGH_VALUE_CUSTOMER_COUNT)
      .map(
        (c) =>
          `${c.counterparty} (${Math.round(c.declineRatio * 100)}% decline, ` +
          `${c.earlierCount} → ${c.recentCount} transactions)`,
      )
      .join('; ');

    const actionItems: ActionItem[] = [
      {
        id: uuidv4(),
        description: 'Reach out to declining customers with re-engagement offers',
        actionType: 'navigate',
        actionData: { screen: 'customer_outreach' },
        completed: false,
      },
      {
        id: uuidv4(),
        description: 'Review service quality and pricing for at-risk accounts',
        actionType: 'navigate',
        actionData: { screen: 'pricing_settings' },
        completed: false,
      },
    ];

    return {
      category: 'revenue',
      type: 'customer_retention',
      title: 'Declining customer purchase frequency detected',
      body:
        `${declining.length} customer(s) show declining purchase frequency: ${customerList}. ` +
        `Total at-risk revenue: ${formatNaira(atRiskRevenueKobo)}. ` +
        'Consider re-engagement strategies to retain these customers.',
      data: {
        decliningCustomers: declining.map((c) => ({
          counterparty: c.counterparty,
          earlierCount: c.earlierCount,
          recentCount: c.recentCount,
          declineRatio: c.declineRatio,
          totalKobo: c.totalKobo,
        })),
        atRiskRevenueKobo,
        decliningCount: declining.length,
      },
      actionItems,
      financialImpact: atRiskRevenueKobo,
      urgency: 60,
      confidence: 80,
    };
  }
}
