/**
 * Property-based tests for Dismissal Cooldown.
 *
 * **Property 4: Dismissal Cooldown**
 * For any dismissed insight, an insight with the same type and similar conditions
 * SHALL NOT be regenerated for 30 days.
 *
 * **Validates: Requirements 8.6**
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';

import type { InsightType } from '../types/index.js';

import { COOLDOWN_PERIOD_MS, DismissalCooldownTracker } from './dismissalCooldown.js';

// ─── Generators ──────────────────────────────────────────────────────────────

const allInsightTypes: InsightType[] = [
  'vat_liability',
  'negative_projection',
  'personal_spending',
  'cost_optimization',
  'revenue_opportunity',
  'compliance_deadline',
  'tax_filing_reminder',
  'cashflow_risk',
  'duplicate_subscription',
  'seasonal_pattern',
  'customer_retention',
  'sector_compliance',
  'withholding_tax',
  'vat_registration',
  'expense_spike',
  'high_value_customer',
];

const insightTypeArb = fc.constantFrom<InsightType>(...allInsightTypes);
const businessIdArb = fc.stringMatching(/^biz-[a-z0-9]{1,12}$/);

/** A base timestamp in a reasonable range (2024–2025). */
const baseDateArb = fc.date({
  min: new Date('2024-01-01T00:00:00Z'),
  max: new Date('2025-12-31T23:59:59Z'),
});

/** Offset in ms strictly within the 30-day cooldown (0 to just under 30 days). */
const withinCooldownOffsetArb = fc.integer({ min: 0, max: COOLDOWN_PERIOD_MS - 1 });

/** Offset in ms at or beyond the 30-day cooldown. */
const beyondCooldownOffsetArb = fc.integer({
  min: COOLDOWN_PERIOD_MS,
  max: COOLDOWN_PERIOD_MS + 90 * 24 * 60 * 60 * 1000,
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Dismissal Cooldown (Property 4)', () => {
  let tracker: DismissalCooldownTracker;

  beforeEach(() => {
    tracker = new DismissalCooldownTracker();
  });

  /**
   * For any dismissal, isSuppressed returns true for any time within 30 days
   * of the dismissal.
   *
   * **Validates: Requirements 8.6**
   */
  it('isSuppressed returns true within 30-day cooldown', () => {
    fc.assert(
      fc.property(
        businessIdArb,
        insightTypeArb,
        baseDateArb,
        withinCooldownOffsetArb,
        (businessId, insightType, dismissedAt, offset) => {
          tracker = new DismissalCooldownTracker();
          tracker.recordDismissal(businessId, insightType, dismissedAt);

          const checkTime = new Date(dismissedAt.getTime() + offset);
          expect(tracker.isSuppressed(businessId, insightType, checkTime)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * For any dismissal, isSuppressed returns false for any time >= 30 days
   * after the dismissal.
   *
   * **Validates: Requirements 8.6**
   */
  it('isSuppressed returns false after 30-day cooldown expires', () => {
    fc.assert(
      fc.property(
        businessIdArb,
        insightTypeArb,
        baseDateArb,
        beyondCooldownOffsetArb,
        (businessId, insightType, dismissedAt, offset) => {
          tracker = new DismissalCooldownTracker();
          tracker.recordDismissal(businessId, insightType, dismissedAt);

          const checkTime = new Date(dismissedAt.getTime() + offset);
          expect(tracker.isSuppressed(businessId, insightType, checkTime)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Suppression is scoped: a dismissal for one (businessId, insightType) pair
   * does NOT suppress a different businessId or different insightType.
   *
   * **Validates: Requirements 8.6**
   */
  it('suppression is scoped to exact businessId and insightType', () => {
    fc.assert(
      fc.property(
        businessIdArb,
        businessIdArb,
        insightTypeArb,
        insightTypeArb,
        baseDateArb,
        (bizA, bizB, typeA, typeB, dismissedAt) => {
          // Only test when at least one dimension differs
          fc.pre(bizA !== bizB || typeA !== typeB);

          tracker = new DismissalCooldownTracker();
          tracker.recordDismissal(bizA, typeA, dismissedAt);

          // The other combination should not be suppressed
          expect(tracker.isSuppressed(bizB, typeB, dismissedAt)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * purgeExpired removes exactly the records older than 30 days and keeps
   * the rest.
   *
   * **Validates: Requirements 8.6**
   */
  it('purgeExpired removes exactly records older than 30 days', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(businessIdArb, insightTypeArb, baseDateArb), {
          minLength: 1,
          maxLength: 20,
        }),
        baseDateArb,
        (records, purgeDate) => {
          tracker = new DismissalCooldownTracker();

          for (const [bizId, type, date] of records) {
            tracker.recordDismissal(bizId, type, date);
          }

          const cutoff = purgeDate.getTime() - COOLDOWN_PERIOD_MS;
          const expectedExpired = records.filter(
            ([_biz, _type, date]) => date.getTime() < cutoff,
          ).length;
          const expectedKept = records.length - expectedExpired;

          const purged = tracker.purgeExpired(purgeDate);
          expect(purged).toBe(expectedExpired);

          // Verify remaining count by checking all unique businesses
          const uniqueBizIds = [...new Set(records.map(([bizId]) => bizId))];
          let totalActive = 0;
          for (const bizId of uniqueBizIds) {
            totalActive += tracker.getActiveRecords(bizId, purgeDate).length;
          }
          expect(totalActive).toBe(expectedKept);
        },
      ),
      { numRuns: 150 },
    );
  });

  /**
   * After purge, previously suppressed items that are still within cooldown
   * remain suppressed.
   *
   * **Validates: Requirements 8.6**
   */
  it('after purge, items within cooldown remain suppressed', () => {
    fc.assert(
      fc.property(
        businessIdArb,
        insightTypeArb,
        baseDateArb,
        withinCooldownOffsetArb,
        (businessId, insightType, dismissedAt, offset) => {
          tracker = new DismissalCooldownTracker();

          // Add an old record that should be purged
          const oldDate = new Date(dismissedAt.getTime() - COOLDOWN_PERIOD_MS - 1);
          tracker.recordDismissal(businessId, 'vat_liability', oldDate);

          // Add the recent record that should survive
          tracker.recordDismissal(businessId, insightType, dismissedAt);

          const checkTime = new Date(dismissedAt.getTime() + offset);

          // Purge expired records
          tracker.purgeExpired(checkTime);

          // The recent dismissal should still suppress
          expect(tracker.isSuppressed(businessId, insightType, checkTime)).toBe(true);
        },
      ),
      { numRuns: 150 },
    );
  });
});
