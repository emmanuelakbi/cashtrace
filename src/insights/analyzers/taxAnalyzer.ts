/**
 * Tax Exposure Analyzer for the Insights Engine.
 *
 * Calculates estimated VAT liability from revenue transactions and generates
 * insights when Nigerian tax thresholds are approached or exceeded.
 *
 * - VAT rate: 7.5% (Nigerian standard)
 * - Quarterly VAT threshold: ₦500,000 (50_000_000 Kobo)
 * - Annual VAT registration threshold: ₦25M (2_500_000_000 Kobo)
 *
 * All amounts are in Kobo (integers) for precision.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 *
 * @module insights/analyzers/taxAnalyzer
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
import { getDeadlinesNeedingReminder, type FirsDeadline } from './firsDeadlines.js';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Nigerian VAT rate: 7.5%. */
export const VAT_RATE = 0.075;

/** Quarterly VAT liability threshold in Kobo (₦500,000). */
export const QUARTERLY_VAT_THRESHOLD_KOBO = 50_000_000;

/** Annual VAT registration threshold in Kobo (₦25M). */
export const ANNUAL_VAT_REGISTRATION_THRESHOLD_KOBO = 2_500_000_000;

/**
 * Percentage of the annual threshold at which we start warning.
 * 80% of ₦25M = ₦20M.
 */
export const VAT_REGISTRATION_WARNING_RATIO = 0.8;

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Filter transactions to only revenue (credit) items. */
function getRevenueTransactions(transactions: Transaction[]): Transaction[] {
  return transactions.filter((tx) => tx.type === 'credit');
}

/** Sum the Kobo amounts of the given transactions. */
function sumAmountKobo(transactions: Transaction[]): number {
  return transactions.reduce((total, tx) => total + tx.amountKobo, 0);
}

/**
 * Calculate VAT liability in Kobo from a revenue amount in Kobo.
 * Uses Math.round to keep the result as an integer.
 */
export function calculateVatLiability(revenueKobo: number): number {
  return Math.round(revenueKobo * VAT_RATE);
}

/**
 * Extrapolate annual revenue from a partial-period revenue figure.
 * `periodDays` is the number of days covered by the transactions;
 * the result is scaled to a full 365-day year.
 */
export function extrapolateAnnualRevenue(periodRevenueKobo: number, periodDays: number): number {
  if (periodDays <= 0) return 0;
  return Math.round((periodRevenueKobo / periodDays) * 365);
}

// ─── TaxAnalyzer ───────────────────────────────────────────────────────────

export class TaxAnalyzer {
  /**
   * Analyse transactions and produce tax-related insights.
   *
   * **Validates: Requirements 1.1, 1.2, 1.3**
   */
  async analyze(context: AnalysisContext): Promise<RawInsight[]> {
    const insights: RawInsight[] = [];
    const revenueTxs = getRevenueTransactions(context.transactions);

    if (revenueTxs.length === 0) {
      return insights;
    }

    const totalRevenueKobo = sumAmountKobo(revenueTxs);
    const vatLiabilityKobo = calculateVatLiability(totalRevenueKobo);

    const periodMs = context.dateRange.end.getTime() - context.dateRange.start.getTime();
    const periodDays = Math.max(1, Math.round(periodMs / (1000 * 60 * 60 * 24)));

    // Requirement 1.1 — always calculate VAT liability
    // Requirement 1.2 — high-priority insight when quarterly VAT > ₦500K
    if (vatLiabilityKobo > QUARTERLY_VAT_THRESHOLD_KOBO) {
      insights.push(this.buildQuarterlyVatInsight(vatLiabilityKobo, totalRevenueKobo, revenueTxs));
    }

    // Requirement 1.3 — compliance insight when approaching ₦25M annual threshold
    const annualRevenueEstimate = extrapolateAnnualRevenue(totalRevenueKobo, periodDays);
    const warningThreshold = Math.round(
      ANNUAL_VAT_REGISTRATION_THRESHOLD_KOBO * VAT_REGISTRATION_WARNING_RATIO,
    );

    if (annualRevenueEstimate >= warningThreshold && !context.businessProfile.vatRegistered) {
      insights.push(
        this.buildVatRegistrationInsight(annualRevenueEstimate, totalRevenueKobo, periodDays),
      );
    }

    // Requirement 1.5, 1.7 — FIRS deadline reminders 30 days before deadline
    const referenceDate = context.dateRange.end;
    const deadlinesNeedingReminder = getDeadlinesNeedingReminder(referenceDate);
    for (const deadline of deadlinesNeedingReminder) {
      insights.push(this.buildFirsDeadlineInsight(deadline));
    }

    return insights;
  }

  /** Return the insight category this analyzer covers. */
  getCategory(): InsightCategory {
    return 'tax';
  }

  /** Declare the data this analyzer needs. */
  getRequiredData(): DataRequirement[] {
    return [
      { source: 'transaction-engine', fields: ['type', 'amountKobo', 'date'], required: true },
      { source: 'business-management', fields: ['vatRegistered'], required: true },
    ];
  }

  // ── Private builders ───────────────────────────────────────────────────

  /**
   * Build a high-priority insight for quarterly VAT liability exceeding ₦500K.
   *
   * **Validates: Requirement 1.2**
   */
  private buildQuarterlyVatInsight(
    vatLiabilityKobo: number,
    totalRevenueKobo: number,
    revenueTxs: Transaction[],
  ): RawInsight {
    const actionItems: ActionItem[] = [
      {
        id: uuidv4(),
        description: 'Review VAT obligations on the FIRS portal',
        actionType: 'external_link',
        actionData: { url: 'https://firs.gov.ng' },
        completed: false,
      },
      {
        id: uuidv4(),
        description: 'Consult a tax professional about VAT filing',
        actionType: 'navigate',
        actionData: { screen: 'tax_advisors' },
        completed: false,
      },
    ];

    return {
      category: 'tax',
      type: 'vat_liability',
      title: 'Quarterly VAT liability exceeds ₦500,000',
      body:
        `Your estimated VAT liability of ${formatNaira(vatLiabilityKobo)} ` +
        `(based on ${formatNaira(totalRevenueKobo)} revenue) exceeds the ₦500,000 quarterly ` +
        `threshold. Ensure timely filing to avoid FIRS penalties.`,
      data: {
        vatLiabilityKobo,
        totalRevenueKobo,
        vatRate: VAT_RATE,
        thresholdKobo: QUARTERLY_VAT_THRESHOLD_KOBO,
        transactionCount: revenueTxs.length,
      },
      actionItems,
      financialImpact: vatLiabilityKobo,
      urgency: 85,
      confidence: 90,
    };
  }

  /**
   * Build a compliance insight when annual revenue approaches the ₦25M
   * VAT registration threshold.
   *
   * **Validates: Requirement 1.3**
   */
  private buildVatRegistrationInsight(
    annualRevenueEstimate: number,
    periodRevenueKobo: number,
    periodDays: number,
  ): RawInsight {
    const percentOfThreshold = Math.round(
      (annualRevenueEstimate / ANNUAL_VAT_REGISTRATION_THRESHOLD_KOBO) * 100,
    );

    const actionItems: ActionItem[] = [
      {
        id: uuidv4(),
        description: 'Check VAT registration requirements on the FIRS portal',
        actionType: 'external_link',
        actionData: { url: 'https://firs.gov.ng/vat-registration' },
        completed: false,
      },
    ];

    return {
      category: 'compliance',
      type: 'vat_registration',
      title: 'Revenue approaching VAT registration threshold',
      body:
        `Your projected annual revenue of ${formatNaira(annualRevenueEstimate)} ` +
        `is at ${percentOfThreshold}% of the ₦25M VAT registration threshold. ` +
        `Consider registering for VAT to stay compliant with FIRS regulations.`,
      data: {
        annualRevenueEstimateKobo: annualRevenueEstimate,
        periodRevenueKobo,
        periodDays,
        thresholdKobo: ANNUAL_VAT_REGISTRATION_THRESHOLD_KOBO,
        percentOfThreshold,
      },
      actionItems,
      financialImpact: calculateVatLiability(annualRevenueEstimate),
      urgency: 70,
      confidence: 75,
    };
  }

  /**
   * Build a tax filing reminder insight for an upcoming FIRS deadline.
   *
   * **Validates: Requirements 1.5, 1.7**
   */
  private buildFirsDeadlineInsight(deadline: FirsDeadline): RawInsight {
    const actionItems: ActionItem[] = [
      {
        id: uuidv4(),
        description: `File your ${deadline.label} before ${deadline.deadlineShortDate}`,
        actionType: 'external_link',
        actionData: { url: 'https://firs.gov.ng' },
        completed: false,
      },
      {
        id: uuidv4(),
        description: 'Consult a tax professional for filing assistance',
        actionType: 'navigate',
        actionData: { screen: 'tax_advisors' },
        completed: false,
      },
    ];

    const urgency =
      deadline.daysUntilDeadline <= 7 ? 95 : deadline.daysUntilDeadline <= 14 ? 85 : 70;

    return {
      category: 'tax',
      type: 'tax_filing_reminder',
      title: `${deadline.label} due in ${deadline.daysUntilDeadline} days`,
      body:
        `Your ${deadline.label} is due on ${deadline.deadlineShortDate}. ` +
        `You have ${deadline.daysUntilDeadline} days remaining to file. ` +
        `Ensure timely submission to avoid FIRS penalties.`,
      data: {
        deadlineType: deadline.type,
        deadlineDate: deadline.deadlineDateWAT,
        deadlineShortDate: deadline.deadlineShortDate,
        daysUntilDeadline: deadline.daysUntilDeadline,
      },
      actionItems,
      financialImpact: 0,
      urgency,
      confidence: 95,
    };
  }
}
