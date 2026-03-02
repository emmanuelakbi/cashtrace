/**
 * Dismissal Cooldown Tracker for the Insights Engine.
 *
 * Tracks dismissed insights and prevents regeneration of insights with the
 * same type for the same business within a 30-day cooldown period.
 *
 * **Validates: Requirement 8.6**
 *
 * @module insights/services/dismissalCooldown
 */

import type { InsightType } from '../types/index.js';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Cooldown period in milliseconds (30 days). */
export const COOLDOWN_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Types ─────────────────────────────────────────────────────────────────

/** Record of a dismissed insight for cooldown tracking. */
export interface DismissalRecord {
  businessId: string;
  insightType: InsightType;
  dismissedAt: Date;
}

// ─── DismissalCooldownTracker ──────────────────────────────────────────────

/**
 * Tracks dismissed insights and enforces a 30-day cooldown before the same
 * insight type can be regenerated for the same business.
 */
export class DismissalCooldownTracker {
  /** In-memory store of dismissal records. */
  private readonly records: DismissalRecord[] = [];

  /**
   * Record a dismissal event for cooldown tracking.
   *
   * @param businessId - The business that dismissed the insight
   * @param insightType - The type of insight that was dismissed
   * @param dismissedAt - When the dismissal occurred (defaults to now)
   */
  recordDismissal(
    businessId: string,
    insightType: InsightType,
    dismissedAt: Date = new Date(),
  ): void {
    this.records.push({ businessId, insightType, dismissedAt });
  }

  /**
   * Check whether a new insight of the given type should be suppressed
   * for the given business due to a recent dismissal.
   *
   * @param businessId - The business to check
   * @param insightType - The insight type to check
   * @param now - The current time (defaults to `new Date()`)
   * @returns `true` if the insight should be suppressed (within cooldown)
   */
  isSuppressed(businessId: string, insightType: InsightType, now: Date = new Date()): boolean {
    return this.records.some(
      (record) =>
        record.businessId === businessId &&
        record.insightType === insightType &&
        now.getTime() - record.dismissedAt.getTime() < COOLDOWN_PERIOD_MS,
    );
  }

  /**
   * Remove expired dismissal records (older than 30 days) to free memory.
   *
   * @param now - The current time (defaults to `new Date()`)
   * @returns The number of records purged
   */
  purgeExpired(now: Date = new Date()): number {
    const before = this.records.length;
    const cutoff = now.getTime() - COOLDOWN_PERIOD_MS;

    // Remove in-place by filtering
    let writeIdx = 0;
    for (let readIdx = 0; readIdx < this.records.length; readIdx++) {
      const record = this.records[readIdx];
      if (record !== undefined && record.dismissedAt.getTime() >= cutoff) {
        this.records[writeIdx] = record;
        writeIdx++;
      }
    }
    this.records.length = writeIdx;

    return before - this.records.length;
  }

  /**
   * Get all active (non-expired) dismissal records for a business.
   *
   * @param businessId - The business to query
   * @param now - The current time (defaults to `new Date()`)
   */
  getActiveRecords(businessId: string, now: Date = new Date()): readonly DismissalRecord[] {
    const cutoff = now.getTime() - COOLDOWN_PERIOD_MS;
    return this.records.filter(
      (record) => record.businessId === businessId && record.dismissedAt.getTime() >= cutoff,
    );
  }
}
