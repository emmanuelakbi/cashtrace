/**
 * Cashflow Analyzer for the Insights Engine.
 *
 * Projects cashflow for 30, 60, and 90 day horizons based on transaction
 * history, recurring patterns, and seasonal variations by business sector.
 *
 * All amounts are in Kobo (integers) for precision.
 *
 * **Validates: Requirements 3.1, 3.5, 3.6**
 *
 * @module insights/analyzers/cashflowAnalyzer
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  ActionItem,
  AnalysisContext,
  DataRequirement,
  InsightCategory,
  NigerianSector,
  RawInsight,
  Transaction,
} from '../types/index.js';
import { formatNaira } from '../types/index.js';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Projection horizons in days. */
export const PROJECTION_HORIZONS = [30, 60, 90] as const;

/** Milliseconds in one day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Minimum number of transactions required for meaningful analysis.
 * Below this threshold, projections are too unreliable.
 */
export const MIN_TRANSACTIONS_FOR_ANALYSIS = 3;

/**
 * Seasonal multipliers by sector and month (1-indexed: 1 = January).
 *
 * Values > 1.0 indicate higher-than-average activity;
 * values < 1.0 indicate lower-than-average activity.
 *
 * **Validates: Requirement 3.6**
 */
export const SEASONAL_MULTIPLIERS: Record<NigerianSector, Record<number, number>> = {
  retail: {
    1: 0.8, // Post-holiday slowdown
    2: 0.85,
    3: 0.9,
    4: 1.0,
    5: 1.0,
    6: 1.0,
    7: 0.95,
    8: 0.95,
    9: 1.05,
    10: 1.1,
    11: 1.15,
    12: 1.3, // Holiday season boost
  },
  services: {
    1: 0.9,
    2: 0.95,
    3: 1.0,
    4: 1.05,
    5: 1.0,
    6: 0.95,
    7: 0.9,
    8: 0.9,
    9: 1.05,
    10: 1.1,
    11: 1.05,
    12: 1.0,
  },
  manufacturing: {
    1: 0.85,
    2: 0.9,
    3: 1.0,
    4: 1.05,
    5: 1.1,
    6: 1.05,
    7: 1.0,
    8: 0.95,
    9: 1.0,
    10: 1.05,
    11: 1.0,
    12: 0.9,
  },
  agriculture: {
    1: 0.7, // Dry season
    2: 0.7,
    3: 0.8,
    4: 0.9,
    5: 1.0,
    6: 1.1, // Planting season
    7: 1.15,
    8: 1.1,
    9: 1.2, // Harvest season
    10: 1.3,
    11: 1.1,
    12: 0.8,
  },
  technology: {
    1: 0.9,
    2: 0.95,
    3: 1.0,
    4: 1.05,
    5: 1.0,
    6: 1.0,
    7: 0.95,
    8: 0.95,
    9: 1.05,
    10: 1.1,
    11: 1.05,
    12: 0.9,
  },
  healthcare: {
    1: 1.05,
    2: 1.0,
    3: 1.0,
    4: 1.0,
    5: 1.0,
    6: 1.0,
    7: 1.0,
    8: 1.0,
    9: 1.0,
    10: 1.0,
    11: 1.0,
    12: 1.0,
  },
  education: {
    1: 1.2, // New term
    2: 1.0,
    3: 0.9,
    4: 0.8, // Holiday
    5: 1.1, // New term
    6: 1.0,
    7: 0.7, // Long holiday
    8: 0.7,
    9: 1.3, // New academic year
    10: 1.1,
    11: 1.0,
    12: 0.8,
  },
  logistics: {
    1: 0.85,
    2: 0.9,
    3: 1.0,
    4: 1.0,
    5: 1.05,
    6: 1.0,
    7: 0.95,
    8: 0.95,
    9: 1.05,
    10: 1.1,
    11: 1.15,
    12: 1.25, // Holiday logistics
  },
  hospitality: {
    1: 0.8,
    2: 0.85,
    3: 0.9,
    4: 1.1, // Easter
    5: 1.0,
    6: 1.05,
    7: 1.1, // Summer travel
    8: 1.1,
    9: 0.95,
    10: 1.0,
    11: 1.0,
    12: 1.3, // Holiday travel
  },
};

// ─── Types ─────────────────────────────────────────────────────────────────

/** A single cashflow projection for a given horizon. */
export interface CashflowProjection {
  /** Number of days projected forward. */
  horizonDays: number;
  /** Projected income over the horizon in Kobo. */
  projectedIncomeKobo: number;
  /** Projected expenses over the horizon in Kobo. */
  projectedExpensesKobo: number;
  /** Net cashflow (income - expenses) in Kobo. */
  netCashflowKobo: number;
  /** Seasonal multiplier applied. */
  seasonalMultiplier: number;
}

/** Summary of a detected recurring transaction pattern. */
export interface RecurringPattern {
  /** The counterparty or description identifying the pattern. */
  identifier: string;
  /** Whether this is income or expense. */
  type: 'credit' | 'debit';
  /** Average amount in Kobo. */
  averageAmountKobo: number;
  /** Approximate frequency in days between occurrences. */
  frequencyDays: number;
  /** Number of occurrences detected. */
  occurrences: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Filter transactions by type. */
function filterByType(transactions: Transaction[], type: 'credit' | 'debit'): Transaction[] {
  return transactions.filter((tx) => tx.type === type);
}

/** Sum the Kobo amounts of the given transactions. */
function sumAmountKobo(transactions: Transaction[]): number {
  return transactions.reduce((total, tx) => total + tx.amountKobo, 0);
}

/**
 * Calculate the number of days spanned by a date range.
 * Returns at least 1 to avoid division by zero.
 */
function periodDays(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.round(ms / MS_PER_DAY));
}

/**
 * Get the seasonal multiplier for a given sector and month.
 * Returns 1.0 if no data is available.
 */
export function getSeasonalMultiplier(sector: NigerianSector, month: number): number {
  const sectorData = SEASONAL_MULTIPLIERS[sector];
  if (!sectorData) return 1.0;
  return sectorData[month] ?? 1.0;
}

/**
 * Calculate the average seasonal multiplier across the months covered
 * by a projection starting from a reference date.
 */
export function averageSeasonalMultiplier(
  sector: NigerianSector,
  referenceDate: Date,
  horizonDays: number,
): number {
  if (horizonDays <= 0) return 1.0;

  let totalMultiplier = 0;
  let daysAccounted = 0;

  const startMs = referenceDate.getTime();

  // Walk through each month in the projection window
  let currentMs = startMs;
  while (daysAccounted < horizonDays) {
    const current = new Date(currentMs);
    const month = current.getUTCMonth() + 1; // 1-indexed
    const multiplier = getSeasonalMultiplier(sector, month);

    // Days remaining in this month
    const year = current.getUTCFullYear();
    const daysInMonth = new Date(year, current.getUTCMonth() + 1, 0).getDate();
    const dayOfMonth = current.getUTCDate();
    const daysLeftInMonth = daysInMonth - dayOfMonth + 1;

    const daysToUse = Math.min(daysLeftInMonth, horizonDays - daysAccounted);
    totalMultiplier += multiplier * daysToUse;
    daysAccounted += daysToUse;

    // Move to first day of next month
    if (current.getUTCMonth() === 11) {
      currentMs = Date.UTC(year + 1, 0, 1);
    } else {
      currentMs = Date.UTC(year, current.getUTCMonth() + 1, 1);
    }
  }

  return totalMultiplier / horizonDays;
}

/**
 * Detect recurring transaction patterns by grouping transactions by
 * counterparty and checking for repeated occurrences.
 *
 * A pattern is considered recurring if it has at least 2 occurrences.
 *
 * **Validates: Requirement 3.5**
 */
export function detectRecurringPatterns(transactions: Transaction[]): RecurringPattern[] {
  const grouped = new Map<string, Transaction[]>();

  for (const tx of transactions) {
    const key = `${tx.type}:${tx.counterparty}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.push(tx);
    } else {
      grouped.set(key, [tx]);
    }
  }

  const patterns: RecurringPattern[] = [];

  for (const [_key, txs] of grouped) {
    if (txs.length < 2) continue;

    // Sort by date
    const sorted = [...txs].sort((a, b) => a.date.getTime() - b.date.getTime());

    // Calculate average interval between occurrences
    let totalIntervalMs = 0;
    for (let i = 1; i < sorted.length; i++) {
      totalIntervalMs += sorted[i]!.date.getTime() - sorted[i - 1]!.date.getTime();
    }
    const avgIntervalDays = Math.round(totalIntervalMs / ((sorted.length - 1) * MS_PER_DAY));

    // Calculate average amount
    const totalKobo = sumAmountKobo(sorted);
    const avgAmountKobo = Math.round(totalKobo / sorted.length);

    patterns.push({
      identifier: sorted[0]!.counterparty,
      type: sorted[0]!.type,
      averageAmountKobo: avgAmountKobo,
      frequencyDays: Math.max(1, avgIntervalDays),
      occurrences: sorted.length,
    });
  }

  return patterns;
}

/**
 * Project cashflow for a given horizon based on historical averages
 * and seasonal adjustments.
 *
 * **Validates: Requirements 3.1, 3.5, 3.6**
 */
export function projectCashflow(
  transactions: Transaction[],
  dateRange: { start: Date; end: Date },
  sector: NigerianSector,
  horizonDays: number,
): CashflowProjection {
  const days = periodDays(dateRange.start, dateRange.end);

  const creditTxs = filterByType(transactions, 'credit');
  const debitTxs = filterByType(transactions, 'debit');

  const totalIncomeKobo = sumAmountKobo(creditTxs);
  const totalExpensesKobo = sumAmountKobo(debitTxs);

  // Daily averages from historical data
  const dailyIncomeKobo = totalIncomeKobo / days;
  const dailyExpensesKobo = totalExpensesKobo / days;

  // Apply seasonal adjustment
  const seasonalMult = averageSeasonalMultiplier(sector, dateRange.end, horizonDays);

  // Project forward with seasonal adjustment applied to income
  const projectedIncomeKobo = Math.round(dailyIncomeKobo * horizonDays * seasonalMult);
  const projectedExpensesKobo = Math.round(dailyExpensesKobo * horizonDays);
  const netCashflowKobo = projectedIncomeKobo - projectedExpensesKobo;

  return {
    horizonDays,
    projectedIncomeKobo,
    projectedExpensesKobo,
    netCashflowKobo,
    seasonalMultiplier: seasonalMult,
  };
}

// ─── CashflowAnalyzer ─────────────────────────────────────────────────────

export class CashflowAnalyzer {
  /**
   * Analyse transactions and produce cashflow-related insights.
   *
   * Projects cashflow for 30, 60, and 90 day horizons and generates
   * insights when projected cashflow is negative.
   *
   * **Validates: Requirements 3.1, 3.5, 3.6**
   */
  async analyze(context: AnalysisContext): Promise<RawInsight[]> {
    const insights: RawInsight[] = [];

    if (context.transactions.length < MIN_TRANSACTIONS_FOR_ANALYSIS) {
      return insights;
    }

    const { businessProfile, transactions, dateRange } = context;
    const sector = businessProfile.sector;

    // Generate projections for each horizon
    const projections = PROJECTION_HORIZONS.map((horizon) =>
      projectCashflow(transactions, dateRange, sector, horizon),
    );

    // Detect recurring patterns for enrichment
    const recurringPatterns = detectRecurringPatterns(transactions);

    // Build insight for the worst projection (longest negative horizon)
    const negativeProjections = projections.filter((p) => p.netCashflowKobo < 0);

    if (negativeProjections.length > 0) {
      insights.push(this.buildCashflowRiskInsight(projections, recurringPatterns, sector));
    }

    return insights;
  }

  /** Return the insight category this analyzer covers. */
  getCategory(): InsightCategory {
    return 'cashflow';
  }

  /** Declare the data this analyzer needs. */
  getRequiredData(): DataRequirement[] {
    return [
      {
        source: 'transaction-engine',
        fields: ['type', 'amountKobo', 'date', 'counterparty'],
        required: true,
      },
      { source: 'business-management', fields: ['sector'], required: true },
    ];
  }

  // ── Private builders ───────────────────────────────────────────────────

  /**
   * Build a cashflow risk insight from projections.
   *
   * Urgency levels:
   * - 30-day negative → 95 (critical) — Validates: Requirement 3.2
   * - 60-day negative → 75 (high) — Validates: Requirement 3.3
   * - 90-day negative only → 60 (medium)
   *
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
   */
  private buildCashflowRiskInsight(
    projections: CashflowProjection[],
    recurringPatterns: RecurringPattern[],
    sector: NigerianSector,
  ): RawInsight {
    // Find the earliest negative projection
    const negativeProjections = projections.filter((p) => p.netCashflowKobo < 0);
    const earliest = negativeProjections.reduce(
      (min, p) => (p.horizonDays < min.horizonDays ? p : min),
      negativeProjections[0]!,
    );

    const shortfallKobo = Math.abs(earliest.netCashflowKobo);

    // Urgency based on how soon the negative cashflow hits
    // Validates: Requirements 3.2 (critical for 30-day), 3.3 (high for 60-day)
    const urgency = earliest.horizonDays <= 30 ? 95 : earliest.horizonDays <= 60 ? 75 : 60;

    const recurringExpenses = recurringPatterns.filter((p) => p.type === 'debit');
    const topExpenses = recurringExpenses
      .sort((a, b) => b.averageAmountKobo - a.averageAmountKobo)
      .slice(0, 3);

    const actionItems: ActionItem[] = [
      {
        id: uuidv4(),
        description: 'Review upcoming expenses and identify items to defer or reduce',
        actionType: 'navigate',
        actionData: { screen: 'expenses' },
        completed: false,
      },
      {
        id: uuidv4(),
        description: 'Follow up on outstanding invoices to accelerate collections',
        actionType: 'navigate',
        actionData: { screen: 'invoices' },
        completed: false,
      },
    ];

    const projectionSummary = projections
      .map((p) => `${p.horizonDays} days: ${formatNaira(p.netCashflowKobo)}`)
      .join(', ');

    return {
      category: 'cashflow',
      type: 'cashflow_risk',
      title: `Cashflow risk detected within ${earliest.horizonDays} days`,
      body:
        `Based on your transaction history and ${sector} sector seasonal patterns, ` +
        `your projected cashflow may turn negative within ${earliest.horizonDays} days. ` +
        `Estimated shortfall: ${formatNaira(shortfallKobo)}. ` +
        `Projections — ${projectionSummary}.`,
      data: {
        projections: projections.map((p) => ({
          horizonDays: p.horizonDays,
          projectedIncomeKobo: p.projectedIncomeKobo,
          projectedExpensesKobo: p.projectedExpensesKobo,
          netCashflowKobo: p.netCashflowKobo,
          seasonalMultiplier: p.seasonalMultiplier,
        })),
        shortfallKobo,
        earliestNegativeHorizon: earliest.horizonDays,
        sector,
        topRecurringExpenses: topExpenses.map((p) => ({
          identifier: p.identifier,
          averageAmountKobo: p.averageAmountKobo,
          frequencyDays: p.frequencyDays,
        })),
      },
      actionItems,
      financialImpact: shortfallKobo,
      urgency,
      confidence: 70,
    };
  }
}
