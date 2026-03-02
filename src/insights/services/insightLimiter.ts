/**
 * Insight Limit Enforcer for the Insights Engine.
 *
 * Ensures no business has more than 10 active insights at a time.
 * When the limit is exceeded, lower-priority (and lower-score) insights
 * are auto-expired to make room.
 *
 * **Validates: Requirements 7.4**
 *
 * @module insights/services/insightLimiter
 */

import type { Insight, InsightPriority } from '../types/index.js';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Maximum number of active insights per business. */
export const MAX_ACTIVE_INSIGHTS = 10;

/**
 * Priority rank — lower number means higher priority.
 * Used for sorting when deciding which insights to expire.
 */
const PRIORITY_RANK: Record<InsightPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

// ─── Result Type ───────────────────────────────────────────────────────────

export interface LimitEnforcementResult {
  /** Insights that remain active (up to MAX_ACTIVE_INSIGHTS). */
  active: Insight[];
  /** Insights that should be expired to enforce the limit. */
  expired: Insight[];
}

// ─── InsightLimitEnforcer ──────────────────────────────────────────────────

export class InsightLimitEnforcer {
  /**
   * Enforce the active insight limit for a business.
   *
   * 1. Filters to only active insights.
   * 2. Sorts by priority (critical first) then by score (highest first).
   * 3. Keeps the top {@link MAX_ACTIVE_INSIGHTS} and marks the rest for expiration.
   *
   * @param insights - All insights for a single business (any status).
   * @returns The active insights to keep and the ones to expire.
   */
  enforce(insights: Insight[]): LimitEnforcementResult {
    const activeInsights = insights.filter((i) => i.status === 'active');

    if (activeInsights.length <= MAX_ACTIVE_INSIGHTS) {
      return { active: activeInsights, expired: [] };
    }

    // Sort: highest priority first, then highest score first
    const sorted = [...activeInsights].sort((a, b) => {
      const priorityDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.score - a.score; // higher score first
    });

    const active = sorted.slice(0, MAX_ACTIVE_INSIGHTS);
    const expired = sorted.slice(MAX_ACTIVE_INSIGHTS);

    return { active, expired };
  }
}
