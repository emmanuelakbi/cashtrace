/**
 * Unit tests for DismissalCooldownTracker.
 *
 * **Validates: Requirement 8.6** — THE Insights_Engine SHALL NOT regenerate
 * dismissed insights for the same condition within 30 days.
 *
 * @module insights/services/dismissalCooldown.test
 */

import { describe, it, expect, beforeEach } from 'vitest';

import type { InsightType } from '../types/index.js';

import { COOLDOWN_PERIOD_MS, DismissalCooldownTracker } from './dismissalCooldown.js';

describe('DismissalCooldownTracker', () => {
  let tracker: DismissalCooldownTracker;
  const businessId = 'biz-001';
  const insightType: InsightType = 'vat_liability';

  beforeEach(() => {
    tracker = new DismissalCooldownTracker();
  });

  describe('recordDismissal', () => {
    it('should record a dismissal with explicit date', () => {
      const dismissedAt = new Date('2024-06-01T10:00:00Z');
      tracker.recordDismissal(businessId, insightType, dismissedAt);

      const records = tracker.getActiveRecords(businessId, dismissedAt);
      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({
        businessId,
        insightType,
        dismissedAt,
      });
    });

    it('should record multiple dismissals for different types', () => {
      const now = new Date();
      tracker.recordDismissal(businessId, 'vat_liability', now);
      tracker.recordDismissal(businessId, 'cashflow_risk', now);

      const records = tracker.getActiveRecords(businessId, now);
      expect(records).toHaveLength(2);
    });

    it('should record multiple dismissals for different businesses', () => {
      const now = new Date();
      tracker.recordDismissal('biz-001', insightType, now);
      tracker.recordDismissal('biz-002', insightType, now);

      expect(tracker.getActiveRecords('biz-001', now)).toHaveLength(1);
      expect(tracker.getActiveRecords('biz-002', now)).toHaveLength(1);
    });
  });

  describe('isSuppressed', () => {
    it('should suppress insight within 30-day cooldown', () => {
      const dismissedAt = new Date('2024-06-01T10:00:00Z');
      tracker.recordDismissal(businessId, insightType, dismissedAt);

      // 15 days later — still within cooldown
      const fifteenDaysLater = new Date(dismissedAt.getTime() + 15 * 24 * 60 * 60 * 1000);
      expect(tracker.isSuppressed(businessId, insightType, fifteenDaysLater)).toBe(true);
    });

    it('should suppress insight at 29 days 23 hours (just before expiry)', () => {
      const dismissedAt = new Date('2024-06-01T10:00:00Z');
      tracker.recordDismissal(businessId, insightType, dismissedAt);

      const justBeforeExpiry = new Date(dismissedAt.getTime() + COOLDOWN_PERIOD_MS - 1);
      expect(tracker.isSuppressed(businessId, insightType, justBeforeExpiry)).toBe(true);
    });

    it('should not suppress insight after 30-day cooldown expires', () => {
      const dismissedAt = new Date('2024-06-01T10:00:00Z');
      tracker.recordDismissal(businessId, insightType, dismissedAt);

      const thirtyOneDaysLater = new Date(dismissedAt.getTime() + 31 * 24 * 60 * 60 * 1000);
      expect(tracker.isSuppressed(businessId, insightType, thirtyOneDaysLater)).toBe(false);
    });

    it('should not suppress insight at exactly 30 days', () => {
      const dismissedAt = new Date('2024-06-01T10:00:00Z');
      tracker.recordDismissal(businessId, insightType, dismissedAt);

      const exactlyThirtyDays = new Date(dismissedAt.getTime() + COOLDOWN_PERIOD_MS);
      expect(tracker.isSuppressed(businessId, insightType, exactlyThirtyDays)).toBe(false);
    });

    it('should not suppress a different insight type', () => {
      const now = new Date();
      tracker.recordDismissal(businessId, 'vat_liability', now);

      expect(tracker.isSuppressed(businessId, 'cashflow_risk', now)).toBe(false);
    });

    it('should not suppress for a different business', () => {
      const now = new Date();
      tracker.recordDismissal('biz-001', insightType, now);

      expect(tracker.isSuppressed('biz-002', insightType, now)).toBe(false);
    });

    it('should return false when no dismissals exist', () => {
      expect(tracker.isSuppressed(businessId, insightType)).toBe(false);
    });

    it('should suppress immediately after dismissal', () => {
      const now = new Date();
      tracker.recordDismissal(businessId, insightType, now);

      expect(tracker.isSuppressed(businessId, insightType, now)).toBe(true);
    });
  });

  describe('purgeExpired', () => {
    it('should remove records older than 30 days', () => {
      const oldDate = new Date('2024-01-01T10:00:00Z');
      const recentDate = new Date('2024-06-15T10:00:00Z');

      tracker.recordDismissal(businessId, 'vat_liability', oldDate);
      tracker.recordDismissal(businessId, 'cashflow_risk', recentDate);

      const now = new Date(recentDate.getTime() + 1 * 24 * 60 * 60 * 1000);
      const purged = tracker.purgeExpired(now);

      expect(purged).toBe(1);
      expect(tracker.getActiveRecords(businessId, now)).toHaveLength(1);
    });

    it('should return 0 when nothing to purge', () => {
      const now = new Date();
      tracker.recordDismissal(businessId, insightType, now);

      expect(tracker.purgeExpired(now)).toBe(0);
    });

    it('should purge all records when all are expired', () => {
      const oldDate = new Date('2024-01-01T10:00:00Z');
      tracker.recordDismissal(businessId, 'vat_liability', oldDate);
      tracker.recordDismissal(businessId, 'cashflow_risk', oldDate);

      const now = new Date('2024-06-01T10:00:00Z');
      const purged = tracker.purgeExpired(now);

      expect(purged).toBe(2);
      expect(tracker.getActiveRecords(businessId, now)).toHaveLength(0);
    });
  });

  describe('getActiveRecords', () => {
    it('should return only non-expired records for the given business', () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);

      tracker.recordDismissal(businessId, 'vat_liability', oldDate);
      tracker.recordDismissal(businessId, 'cashflow_risk', now);
      tracker.recordDismissal('other-biz', 'vat_liability', now);

      const records = tracker.getActiveRecords(businessId, now);
      expect(records).toHaveLength(1);
      expect(records[0]?.insightType).toBe('cashflow_risk');
    });

    it('should return empty array for unknown business', () => {
      expect(tracker.getActiveRecords('unknown-biz')).toHaveLength(0);
    });
  });
});
