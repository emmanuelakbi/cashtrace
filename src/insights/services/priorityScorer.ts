/**
 * Priority Scorer for the Insights Engine.
 *
 * Calculates insight priority based on multiple factors:
 * - Financial impact (weight: 0.4) — how much money is at stake
 * - Urgency (weight: 0.3) — how time-sensitive the insight is
 * - Confidence (weight: 0.2) — how certain we are about the insight
 * - Relevance (weight: 0.1) — how relevant to the business context
 *
 * **Validates: Requirements 7.1, 7.2**
 *
 * @module insights/services/priorityScorer
 */

import type {
  BusinessSize,
  Insight,
  InsightPriority,
  RawInsight,
  ScoreFactor,
  ScoredInsight,
  ScoringContext,
  UserEngagement,
} from '../types/index.js';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Default factor weights for scoring. */
const DEFAULT_WEIGHTS = {
  financialImpact: 0.4,
  urgency: 0.3,
  confidence: 0.2,
  relevance: 0.1,
} as const;

/**
 * Priority thresholds — score ranges mapped to priority levels.
 * Scores are 0–100; boundaries are inclusive on the lower end.
 */
const PRIORITY_THRESHOLDS: { min: number; priority: InsightPriority }[] = [
  { min: 80, priority: 'critical' },
  { min: 60, priority: 'high' },
  { min: 40, priority: 'medium' },
  { min: 20, priority: 'low' },
  { min: 0, priority: 'info' },
];

/**
 * Financial impact tiers (in Kobo) used to normalise the raw
 * `financialImpact` value to a 0–100 scale.
 *
 * Tier boundaries are based on typical Nigerian SME transaction sizes.
 */
const FINANCIAL_IMPACT_TIERS = [
  { minKobo: 10_000_000_00, score: 100 }, // ≥ ₦10M
  { minKobo: 5_000_000_00, score: 85 }, // ≥ ₦5M
  { minKobo: 1_000_000_00, score: 70 }, // ≥ ₦1M
  { minKobo: 500_000_00, score: 55 }, // ≥ ₦500K
  { minKobo: 100_000_00, score: 40 }, // ≥ ₦100K
  { minKobo: 50_000_00, score: 25 }, // ≥ ₦50K
  { minKobo: 0, score: 10 }, // < ₦50K
] as const;

/** Business-size multipliers for the relevance factor. */
const SIZE_MULTIPLIERS: Record<BusinessSize, number> = {
  micro: 1.2,
  small: 1.0,
  medium: 0.9,
};

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Clamp a number to the 0–100 range. */
function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * Normalise a raw financial impact (Kobo) to a 0–100 score using the
 * predefined tier table.
 */
function normaliseFinancialImpact(impactKobo: number): number {
  for (const tier of FINANCIAL_IMPACT_TIERS) {
    if (impactKobo >= tier.minKobo) {
      return tier.score;
    }
  }
  return 10;
}

/**
 * Calculate a relevance boost based on how many existing active insights
 * share the same category. Fewer duplicates → higher relevance.
 */
function calculateCategoryRelevance(insight: RawInsight, existingInsights: Insight[]): number {
  const activeInCategory = existingInsights.filter(
    (i) => i.category === insight.category && i.status === 'active',
  ).length;

  // Base relevance starts at 50; reduce by 10 for each existing active
  // insight in the same category (floor at 10).
  return Math.max(10, 50 - activeInCategory * 10);
}

/**
 * Apply an engagement-based adjustment. If the user rarely engages with
 * insights we slightly boost urgency to surface more important items.
 */
function engagementAdjustment(engagement: UserEngagement): number {
  const overallEngagement =
    engagement.viewRate * 0.2 + engagement.acknowledgeRate * 0.3 + engagement.resolveRate * 0.5;

  // Low engagement → small positive boost (max +10)
  // High engagement → no adjustment
  if (overallEngagement < 0.3) return 10;
  if (overallEngagement < 0.5) return 5;
  return 0;
}

// ─── PriorityScorer ────────────────────────────────────────────────────────

export class PriorityScorer {
  /**
   * Score a raw insight and assign a priority level.
   *
   * The final score is a weighted sum of four normalised factors (0–100 each),
   * optionally adjusted by user engagement and business size.
   *
   * **Validates: Requirements 7.1**
   */
  score(insight: RawInsight, context: ScoringContext): ScoredInsight {
    const financialImpactValue = normaliseFinancialImpact(Math.abs(insight.financialImpact));
    const urgencyValue = clamp(insight.urgency);
    const confidenceValue = clamp(insight.confidence);

    const baseRelevance = calculateCategoryRelevance(insight, context.existingInsights);
    const sizeMultiplier = SIZE_MULTIPLIERS[context.businessSize];
    const relevanceValue = clamp(baseRelevance * sizeMultiplier);

    const factors: ScoreFactor[] = [
      {
        name: 'financialImpact',
        weight: DEFAULT_WEIGHTS.financialImpact,
        value: financialImpactValue,
        contribution: Math.round(financialImpactValue * DEFAULT_WEIGHTS.financialImpact),
      },
      {
        name: 'urgency',
        weight: DEFAULT_WEIGHTS.urgency,
        value: urgencyValue,
        contribution: Math.round(urgencyValue * DEFAULT_WEIGHTS.urgency),
      },
      {
        name: 'confidence',
        weight: DEFAULT_WEIGHTS.confidence,
        value: confidenceValue,
        contribution: Math.round(confidenceValue * DEFAULT_WEIGHTS.confidence),
      },
      {
        name: 'relevance',
        weight: DEFAULT_WEIGHTS.relevance,
        value: relevanceValue,
        contribution: Math.round(relevanceValue * DEFAULT_WEIGHTS.relevance),
      },
    ];

    const rawScore = factors.reduce((sum, f) => sum + f.contribution, 0);
    const boost = engagementAdjustment(context.userEngagement);
    const finalScore = clamp(rawScore + boost);

    const priority = this.calculatePriority(finalScore);

    return {
      ...insight,
      score: finalScore,
      priority,
      factors,
    };
  }

  /**
   * Map a numeric score (0–100) to a priority level.
   *
   * - **critical** (≥ 80): Immediate action required
   * - **high** (≥ 60): Address this week
   * - **medium** (≥ 40): Address this month
   * - **low** (≥ 20): When convenient
   * - **info** (< 20): Awareness only
   *
   * **Validates: Requirements 7.2**
   */
  calculatePriority(score: number): InsightPriority {
    const clamped = clamp(score);
    for (const threshold of PRIORITY_THRESHOLDS) {
      if (clamped >= threshold.min) {
        return threshold.priority;
      }
    }
    return 'info';
  }
}
