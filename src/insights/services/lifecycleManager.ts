/**
 * Lifecycle Manager for the Insights Engine.
 *
 * Manages insight state transitions: create, acknowledge, dismiss, resolve,
 * and expire. Validates that transitions follow allowed paths and updates
 * timestamps and metadata accordingly.
 *
 * Valid transitions:
 * - active → acknowledged (user acknowledges)
 * - active → dismissed (user dismisses)
 * - active → expired (auto-expire)
 * - acknowledged → resolved (user resolves)
 * - acknowledged → expired (auto-expire)
 *
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
 *
 * @module insights/services/lifecycleManager
 */

import { v4 as uuidv4 } from 'uuid';

import type { Insight, InsightStatus, ScoredInsight } from '../types/index.js';

// ─── Error Codes ───────────────────────────────────────────────────────────

export const INSIGHT_ALREADY_RESOLVED = 'INSIGHT_ALREADY_RESOLVED' as const;
export const INSIGHT_INVALID_TRANSITION = 'INSIGHT_INVALID_TRANSITION' as const;

// ─── Error Class ───────────────────────────────────────────────────────────

export class InsightLifecycleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'InsightLifecycleError';
  }
}

// ─── Valid Transitions ─────────────────────────────────────────────────────

/**
 * Map of allowed status transitions. Each key is a current status, and the
 * value is the set of statuses it can transition to.
 */
const VALID_TRANSITIONS: Record<InsightStatus, Set<InsightStatus>> = {
  active: new Set(['acknowledged', 'dismissed', 'expired']),
  acknowledged: new Set(['resolved', 'expired']),
  dismissed: new Set(),
  resolved: new Set(),
  expired: new Set(),
};

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Returns `true` when transitioning from `from` to `to` is allowed.
 */
function isValidTransition(from: InsightStatus, to: InsightStatus): boolean {
  return VALID_TRANSITIONS[from].has(to);
}

// ─── LifecycleManager ──────────────────────────────────────────────────────

export class LifecycleManager {
  /** In-memory store keyed by insight ID. Repository layer added later. */
  private readonly insights = new Map<string, Insight>();

  /**
   * Create a new insight from a scored result.
   *
   * The insight starts in `active` status with a 30-day expiration window.
   */
  async create(scored: ScoredInsight): Promise<Insight> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const insight: Insight = {
      id: uuidv4(),
      businessId: (scored.data['businessId'] as string) ?? uuidv4(),
      category: scored.category,
      type: scored.type,
      priority: scored.priority,
      status: 'active',
      title: scored.title,
      body: scored.body,
      actionItems: scored.actionItems,
      data: {
        amounts: scored.data['amounts'] as number[] | undefined,
        transactions: scored.data['transactions'] as string[] | undefined,
        dates: scored.data['dates'] as string[] | undefined,
        thresholds: scored.data['thresholds'] as Record<string, number> | undefined,
        comparisons: scored.data['comparisons'] as Record<string, unknown> | undefined,
      },
      score: scored.score,
      financialImpactKobo: scored.financialImpact,
      createdAt: now,
      acknowledgedAt: null,
      acknowledgedBy: null,
      dismissedAt: null,
      dismissedBy: null,
      dismissReason: null,
      resolvedAt: null,
      resolvedBy: null,
      resolutionNotes: null,
      expiresAt,
    };

    this.insights.set(insight.id, insight);
    return insight;
  }

  /**
   * Acknowledge an active insight.
   *
   * **Validates: Requirement 8.1**
   *
   * @throws {InsightLifecycleError} INSIGHT_INVALID_TRANSITION if not active
   */
  async acknowledge(insightId: string, userId: string): Promise<void> {
    const insight = this.getOrThrow(insightId);
    this.assertTransition(insight, 'acknowledged');

    insight.status = 'acknowledged';
    insight.acknowledgedAt = new Date();
    insight.acknowledgedBy = userId;
  }

  /**
   * Dismiss an active insight with a reason.
   *
   * **Validates: Requirement 8.2**
   *
   * @throws {InsightLifecycleError} INSIGHT_INVALID_TRANSITION if not active
   */
  async dismiss(insightId: string, userId: string, reason: string): Promise<void> {
    const insight = this.getOrThrow(insightId);
    this.assertTransition(insight, 'dismissed');

    insight.status = 'dismissed';
    insight.dismissedAt = new Date();
    insight.dismissedBy = userId;
    insight.dismissReason = reason;
  }

  /**
   * Resolve an acknowledged insight with resolution notes.
   *
   * **Validates: Requirement 8.3**
   *
   * @throws {InsightLifecycleError} INSIGHT_ALREADY_RESOLVED if already resolved
   * @throws {InsightLifecycleError} INSIGHT_INVALID_TRANSITION if not acknowledged
   */
  async resolve(insightId: string, userId: string, notes: string): Promise<void> {
    const insight = this.getOrThrow(insightId);

    if (insight.status === 'resolved') {
      throw new InsightLifecycleError(
        INSIGHT_ALREADY_RESOLVED,
        `Insight ${insightId} is already resolved`,
      );
    }

    this.assertTransition(insight, 'resolved');

    insight.status = 'resolved';
    insight.resolvedAt = new Date();
    insight.resolvedBy = userId;
    insight.resolutionNotes = notes;
  }

  /**
   * Expire an insight (active or acknowledged).
   *
   * **Validates: Requirement 8.4**
   *
   * @throws {InsightLifecycleError} INSIGHT_INVALID_TRANSITION if not active/acknowledged
   */
  async expire(insightId: string): Promise<void> {
    const insight = this.getOrThrow(insightId);
    this.assertTransition(insight, 'expired');

    insight.status = 'expired';
  }

  /**
   * Check and expire all insights past their `expiresAt` date for a business.
   *
   * **Validates: Requirement 8.4**
   */
  async checkExpiration(businessId: string): Promise<void> {
    const now = new Date();

    for (const insight of this.insights.values()) {
      if (
        insight.businessId === businessId &&
        (insight.status === 'active' || insight.status === 'acknowledged') &&
        insight.expiresAt <= now
      ) {
        insight.status = 'expired';
      }
    }
  }

  // ─── Internal helpers ──────────────────────────────────────────────────

  /** Retrieve an insight by ID or throw. */
  getOrThrow(insightId: string): Insight {
    const insight = this.insights.get(insightId);
    if (!insight) {
      throw new InsightLifecycleError(INSIGHT_INVALID_TRANSITION, `Insight ${insightId} not found`);
    }
    return insight;
  }

  /** Retrieve an insight by ID (returns undefined if missing). */
  get(insightId: string): Insight | undefined {
    return this.insights.get(insightId);
  }

  /** Assert that transitioning to `target` is valid for the given insight. */
  private assertTransition(insight: Insight, target: InsightStatus): void {
    if (!isValidTransition(insight.status, target)) {
      throw new InsightLifecycleError(
        INSIGHT_INVALID_TRANSITION,
        `Cannot transition from '${insight.status}' to '${target}'`,
      );
    }
  }
}
