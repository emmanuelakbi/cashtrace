/**
 * Insight Analytics Service.
 *
 * Tracks insight generation counts by category and priority, user engagement
 * rates (view, acknowledge, dismiss, resolve), average resolution times by
 * insight type, and insight accuracy based on user feedback.
 *
 * All time durations are stored in milliseconds.
 *
 * **Validates: Requirements 13.1, 13.2, 13.3, 13.4**
 *
 * @module insights/services/insightAnalytics
 */

import type {
  Insight,
  InsightCategory,
  InsightPriority,
  InsightStatus,
  InsightType,
} from '../types/index.js';

// ─── Types ─────────────────────────────────────────────────────────────────

/** Tracks generation counts keyed by category, then by priority. */
export interface GenerationCounts {
  byCategory: Record<string, number>;
  byPriority: Record<string, number>;
  byCategoryAndPriority: Record<string, Record<string, number>>;
  total: number;
}

/** Engagement rates as fractions between 0 and 1. */
export interface EngagementRates {
  viewRate: number;
  acknowledgeRate: number;
  dismissRate: number;
  resolveRate: number;
  totalInsights: number;
  viewed: number;
  acknowledged: number;
  dismissed: number;
  resolved: number;
}

/** Resolution time statistics for a single insight type (in milliseconds). */
export interface ResolutionTimeStats {
  averageMs: number;
  minMs: number;
  maxMs: number;
  count: number;
}

/** Accuracy metrics based on user feedback. */
export interface AccuracyMetrics {
  totalFeedback: number;
  positiveFeedback: number;
  negativeFeedback: number;
  accuracyRate: number;
}

/** A single feedback entry recorded by a user. */
export interface InsightFeedback {
  insightId: string;
  businessId: string;
  category: InsightCategory;
  type: InsightType;
  positive: boolean;
  timestamp: Date;
}

/** Complete analytics snapshot for a business or system-wide. */
export interface AnalyticsSnapshot {
  generationCounts: GenerationCounts;
  engagementRates: EngagementRates;
  resolutionTimes: Map<InsightType, ResolutionTimeStats>;
  accuracy: AccuracyMetrics;
  periodStart: Date;
  periodEnd: Date;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const ALL_CATEGORIES: InsightCategory[] = [
  'tax',
  'compliance',
  'cashflow',
  'spending',
  'revenue',
  'operational',
];

const ALL_PRIORITIES: InsightPriority[] = ['critical', 'high', 'medium', 'low', 'info'];

// ─── InsightAnalytics ──────────────────────────────────────────────────────

export class InsightAnalytics {
  /** Recorded feedback entries. */
  private readonly feedback: InsightFeedback[] = [];

  /** Set of insight IDs that have been viewed. */
  private readonly viewedInsights = new Set<string>();

  /**
   * Calculate generation counts by category and priority from a list of insights.
   *
   * **Validates: Requirement 13.1**
   */
  calculateGenerationCounts(insights: Insight[]): GenerationCounts {
    const byCategory: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    const byCategoryAndPriority: Record<string, Record<string, number>> = {};

    // Initialise all known keys to 0
    for (const cat of ALL_CATEGORIES) {
      byCategory[cat] = 0;
      byCategoryAndPriority[cat] = {};
      for (const pri of ALL_PRIORITIES) {
        byCategoryAndPriority[cat][pri] = 0;
      }
    }
    for (const pri of ALL_PRIORITIES) {
      byPriority[pri] = 0;
    }

    for (const insight of insights) {
      byCategory[insight.category] = (byCategory[insight.category] ?? 0) + 1;
      byPriority[insight.priority] = (byPriority[insight.priority] ?? 0) + 1;

      if (!byCategoryAndPriority[insight.category]) {
        byCategoryAndPriority[insight.category] = {};
      }
      byCategoryAndPriority[insight.category][insight.priority] =
        (byCategoryAndPriority[insight.category][insight.priority] ?? 0) + 1;
    }

    return {
      byCategory,
      byPriority,
      byCategoryAndPriority,
      total: insights.length,
    };
  }

  /**
   * Calculate engagement rates from a list of insights.
   *
   * Engagement is measured as the fraction of insights that reached each
   * lifecycle status. An insight counts as "viewed" if it was explicitly
   * recorded via {@link recordView}.
   *
   * **Validates: Requirement 13.2**
   */
  calculateEngagementRates(insights: Insight[]): EngagementRates {
    if (insights.length === 0) {
      return {
        viewRate: 0,
        acknowledgeRate: 0,
        dismissRate: 0,
        resolveRate: 0,
        totalInsights: 0,
        viewed: 0,
        acknowledged: 0,
        dismissed: 0,
        resolved: 0,
      };
    }

    let viewed = 0;
    let acknowledged = 0;
    let dismissed = 0;
    let resolved = 0;

    for (const insight of insights) {
      if (this.viewedInsights.has(insight.id)) {
        viewed++;
      }
      if (isEngaged(insight.status, 'acknowledged')) {
        acknowledged++;
      }
      if (insight.status === 'dismissed') {
        dismissed++;
      }
      if (isEngaged(insight.status, 'resolved')) {
        resolved++;
      }
    }

    const total = insights.length;

    return {
      viewRate: viewed / total,
      acknowledgeRate: acknowledged / total,
      dismissRate: dismissed / total,
      resolveRate: resolved / total,
      totalInsights: total,
      viewed,
      acknowledged,
      dismissed,
      resolved,
    };
  }

  /**
   * Calculate average resolution time grouped by insight type.
   *
   * Resolution time = resolvedAt − createdAt for resolved insights.
   *
   * **Validates: Requirement 13.3**
   */
  calculateResolutionTimes(insights: Insight[]): Map<InsightType, ResolutionTimeStats> {
    const byType = new Map<InsightType, number[]>();

    for (const insight of insights) {
      if (insight.status === 'resolved' && insight.resolvedAt) {
        const durationMs = insight.resolvedAt.getTime() - insight.createdAt.getTime();
        if (durationMs >= 0) {
          const existing = byType.get(insight.type) ?? [];
          existing.push(durationMs);
          byType.set(insight.type, existing);
        }
      }
    }

    const result = new Map<InsightType, ResolutionTimeStats>();

    for (const [type, durations] of byType) {
      const sum = durations.reduce((a, b) => a + b, 0);
      result.set(type, {
        averageMs: Math.round(sum / durations.length),
        minMs: Math.min(...durations),
        maxMs: Math.max(...durations),
        count: durations.length,
      });
    }

    return result;
  }

  /**
   * Calculate insight accuracy based on recorded user feedback.
   *
   * Accuracy = positiveFeedback / totalFeedback.
   *
   * **Validates: Requirement 13.4**
   */
  calculateAccuracy(businessId?: string): AccuracyMetrics {
    const relevant = businessId
      ? this.feedback.filter((f) => f.businessId === businessId)
      : this.feedback;

    if (relevant.length === 0) {
      return {
        totalFeedback: 0,
        positiveFeedback: 0,
        negativeFeedback: 0,
        accuracyRate: 0,
      };
    }

    const positive = relevant.filter((f) => f.positive).length;
    const negative = relevant.length - positive;

    return {
      totalFeedback: relevant.length,
      positiveFeedback: positive,
      negativeFeedback: negative,
      accuracyRate: positive / relevant.length,
    };
  }

  /**
   * Record that a user viewed an insight.
   *
   * **Validates: Requirement 13.2**
   */
  recordView(insightId: string): void {
    this.viewedInsights.add(insightId);
  }

  /**
   * Record user feedback for an insight.
   *
   * **Validates: Requirement 13.4**
   */
  recordFeedback(feedback: InsightFeedback): void {
    this.feedback.push(feedback);
  }

  /**
   * Build a complete analytics snapshot for a set of insights.
   *
   * **Validates: Requirements 13.1, 13.2, 13.3, 13.4**
   */
  buildSnapshot(insights: Insight[], periodStart: Date, periodEnd: Date): AnalyticsSnapshot {
    return {
      generationCounts: this.calculateGenerationCounts(insights),
      engagementRates: this.calculateEngagementRates(insights),
      resolutionTimes: this.calculateResolutionTimes(insights),
      accuracy: this.calculateAccuracy(),
      periodStart,
      periodEnd,
    };
  }

  /** Return the number of recorded feedback entries. */
  get feedbackCount(): number {
    return this.feedback.length;
  }

  /** Return the number of viewed insight IDs. */
  get viewCount(): number {
    return this.viewedInsights.size;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Returns `true` when the insight has reached at least the given engagement
 * status. Acknowledged insights also count as acknowledged when resolved.
 */
function isEngaged(current: InsightStatus, target: 'acknowledged' | 'resolved'): boolean {
  if (target === 'resolved') {
    return current === 'resolved';
  }
  // acknowledged counts if the insight was acknowledged or later resolved
  return current === 'acknowledged' || current === 'resolved';
}
