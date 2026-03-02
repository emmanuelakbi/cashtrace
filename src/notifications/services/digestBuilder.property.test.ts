/**
 * Property-based tests for Digest Aggregation.
 *
 * **Property 9: Digest Aggregation**
 * For any digest period, all eligible notifications SHALL be included
 * in the digest, grouped by category.
 *
 * **Validates: Requirements 7.3, 7.4**
 *
 * Tag: Feature: notification-system, Property 9: Digest Aggregation
 *
 * @module notifications/services/digestBuilder.property.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';

import { createDigestBuilder, type DigestBuilder, type DigestEntry } from './digestBuilder.js';
import type { NotificationCategory, NotificationPriority } from '../types/index.js';

// ─── Constants ───

const MS_PER_HOUR = 60 * 60 * 1000;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;

const CATEGORIES: NotificationCategory[] = [
  'security',
  'transactions',
  'insights',
  'compliance',
  'system',
  'marketing',
];

const PRIORITIES: NotificationPriority[] = ['critical', 'high', 'normal', 'low'];

// ─── Arbitraries ───

const categoryArb: fc.Arbitrary<NotificationCategory> = fc.constantFrom(...CATEGORIES);
const priorityArb: fc.Arbitrary<NotificationPriority> = fc.constantFrom(...PRIORITIES);

/**
 * Generate a DigestEntry with a createdAt relative to a reference time.
 * offsetMs is the offset in milliseconds from the reference time (negative = before).
 */
function digestEntryArb(
  userId: string,
  referenceTime: Date,
  minOffsetMs: number,
  maxOffsetMs: number,
): fc.Arbitrary<DigestEntry> {
  return fc.record({
    notificationId: fc.uuid(),
    userId: fc.constant(userId),
    category: categoryArb,
    priority: priorityArb,
    title: fc.string({ minLength: 1, maxLength: 50 }),
    body: fc.string({ minLength: 1, maxLength: 200 }),
    createdAt: fc
      .integer({ min: minOffsetMs, max: maxOffsetMs })
      .map((offset) => new Date(referenceTime.getTime() + offset)),
  });
}

// ─── Test Suite ───

describe('Property 9: Digest Aggregation', () => {
  let builder: DigestBuilder;

  beforeEach(() => {
    builder = createDigestBuilder();
  });

  /**
   * **Completeness**: For any set of entries within the digest period,
   * all entries appear in the digest result.
   *
   * **Validates: Requirements 7.3, 7.4**
   */
  it('should include all entries within the daily digest period', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.array(categoryArb, { minLength: 1, maxLength: 20 }),
        (userId, categories) => {
          const builder = createDigestBuilder();
          const now = new Date('2025-01-15T10:00:00Z');
          const periodStart = new Date(now.getTime() - HOURS_PER_DAY * MS_PER_HOUR);

          // Create entries that are all within the daily window
          const entries: DigestEntry[] = categories.map((cat, i) => ({
            notificationId: `notif-${i}`,
            userId,
            category: cat,
            priority: PRIORITIES[i % PRIORITIES.length]!,
            title: `Title ${i}`,
            body: `Body ${i}`,
            // Spread entries evenly within the period
            createdAt: new Date(
              periodStart.getTime() +
                ((i + 1) / (categories.length + 1)) * (now.getTime() - periodStart.getTime()),
            ),
          }));

          for (const entry of entries) {
            builder.addEntry(entry);
          }

          const result = builder.buildDailyDigest(userId, now);

          // Every entry we added must appear in the result
          expect(result.entries.length).toBe(entries.length);
          for (const entry of entries) {
            expect(result.entries.some((e) => e.notificationId === entry.notificationId)).toBe(
              true,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Completeness (weekly)**: For any set of entries within the weekly digest
   * period, all entries appear in the weekly digest result.
   *
   * **Validates: Requirements 7.3, 7.4**
   */
  it('should include all entries within the weekly digest period', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.array(categoryArb, { minLength: 1, maxLength: 20 }),
        (userId, categories) => {
          const builder = createDigestBuilder();
          const now = new Date('2025-01-20T10:00:00Z');
          const periodStart = new Date(now.getTime() - DAYS_PER_WEEK * HOURS_PER_DAY * MS_PER_HOUR);

          const entries: DigestEntry[] = categories.map((cat, i) => ({
            notificationId: `notif-w-${i}`,
            userId,
            category: cat,
            priority: PRIORITIES[i % PRIORITIES.length]!,
            title: `Weekly Title ${i}`,
            body: `Weekly Body ${i}`,
            createdAt: new Date(
              periodStart.getTime() +
                ((i + 1) / (categories.length + 1)) * (now.getTime() - periodStart.getTime()),
            ),
          }));

          for (const entry of entries) {
            builder.addEntry(entry);
          }

          const result = builder.buildWeeklyDigest(userId, now);

          expect(result.entries.length).toBe(entries.length);
          for (const entry of entries) {
            expect(result.entries.some((e) => e.notificationId === entry.notificationId)).toBe(
              true,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Exclusion**: Entries outside the digest period are never included.
   *
   * **Validates: Requirements 7.3, 7.4**
   */
  it('should exclude entries outside the daily digest period', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 10 }),
        (userId, insideCount, outsideCount) => {
          const builder = createDigestBuilder();
          const now = new Date('2025-01-15T10:00:00Z');
          const periodStart = new Date(now.getTime() - HOURS_PER_DAY * MS_PER_HOUR);

          // Entries inside the window
          for (let i = 0; i < insideCount; i++) {
            builder.addEntry({
              notificationId: `inside-${i}`,
              userId,
              category: CATEGORIES[i % CATEGORIES.length]!,
              priority: 'normal',
              title: `Inside ${i}`,
              body: `Body ${i}`,
              createdAt: new Date(
                periodStart.getTime() +
                  ((i + 1) / (insideCount + 1)) * (now.getTime() - periodStart.getTime()),
              ),
            });
          }

          // Entries outside the window (before periodStart)
          for (let i = 0; i < outsideCount; i++) {
            builder.addEntry({
              notificationId: `outside-${i}`,
              userId,
              category: CATEGORIES[i % CATEGORIES.length]!,
              priority: 'normal',
              title: `Outside ${i}`,
              body: `Body ${i}`,
              // 1 to 48 hours before the period start
              createdAt: new Date(periodStart.getTime() - (i + 1) * MS_PER_HOUR),
            });
          }

          const result = builder.buildDailyDigest(userId, now);

          // Only inside entries should be present
          expect(result.entries.length).toBe(insideCount);
          for (const entry of result.entries) {
            expect(entry.notificationId).toMatch(/^inside-/);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Category grouping**: The sum of entries across all category groups
   * equals totalCount.
   *
   * **Validates: Requirements 7.3, 7.4**
   */
  it('should have grouped entry count equal to totalCount', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.array(categoryArb, { minLength: 0, maxLength: 30 }),
        (userId, categories) => {
          const builder = createDigestBuilder();
          const now = new Date('2025-01-15T10:00:00Z');
          const periodStart = new Date(now.getTime() - HOURS_PER_DAY * MS_PER_HOUR);

          categories.forEach((cat, i) => {
            builder.addEntry({
              notificationId: `grp-${i}`,
              userId,
              category: cat,
              priority: 'normal',
              title: `Title ${i}`,
              body: `Body ${i}`,
              createdAt: new Date(
                periodStart.getTime() +
                  ((i + 1) / (categories.length + 1)) * (now.getTime() - periodStart.getTime()),
              ),
            });
          });

          const result = builder.buildDailyDigest(userId, now);

          // Sum of all category group lengths must equal totalCount
          const groupedSum = Object.values(result.groupedByCategory).reduce(
            (sum, entries) => sum + entries.length,
            0,
          );

          expect(groupedSum).toBe(result.totalCount);
          expect(result.totalCount).toBe(result.entries.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Category correctness**: Each entry in a category group has the
   * correct category value.
   *
   * **Validates: Requirements 7.3, 7.4**
   */
  it('should group entries by their correct category', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.array(categoryArb, { minLength: 1, maxLength: 30 }),
        (userId, categories) => {
          const builder = createDigestBuilder();
          const now = new Date('2025-01-15T10:00:00Z');
          const periodStart = new Date(now.getTime() - HOURS_PER_DAY * MS_PER_HOUR);

          categories.forEach((cat, i) => {
            builder.addEntry({
              notificationId: `cat-${i}`,
              userId,
              category: cat,
              priority: 'normal',
              title: `Title ${i}`,
              body: `Body ${i}`,
              createdAt: new Date(
                periodStart.getTime() +
                  ((i + 1) / (categories.length + 1)) * (now.getTime() - periodStart.getTime()),
              ),
            });
          });

          const result = builder.buildDailyDigest(userId, now);

          // Every entry in each category group must have that category
          for (const [category, entries] of Object.entries(result.groupedByCategory)) {
            for (const entry of entries) {
              expect(entry.category).toBe(category);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Period boundaries**: periodStart and periodEnd correctly define
   * the window (24h for daily, 7d for weekly).
   *
   * **Validates: Requirements 7.3, 7.4**
   */
  it('should define a 24-hour window for daily digest', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.date({
          min: new Date('2024-01-01T00:00:00Z'),
          max: new Date('2026-01-01T00:00:00Z'),
        }),
        (userId, now) => {
          const builder = createDigestBuilder();
          const result = builder.buildDailyDigest(userId, now);

          const windowMs = result.periodEnd.getTime() - result.periodStart.getTime();
          expect(windowMs).toBe(HOURS_PER_DAY * MS_PER_HOUR);
          expect(result.periodEnd.getTime()).toBe(now.getTime());
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Period boundaries (weekly)**: periodStart and periodEnd correctly
   * define a 7-day window for weekly digest.
   *
   * **Validates: Requirements 7.3, 7.4**
   */
  it('should define a 7-day window for weekly digest', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.date({
          min: new Date('2024-01-01T00:00:00Z'),
          max: new Date('2026-01-01T00:00:00Z'),
        }),
        (userId, now) => {
          const builder = createDigestBuilder();
          const result = builder.buildWeeklyDigest(userId, now);

          const windowMs = result.periodEnd.getTime() - result.periodStart.getTime();
          expect(windowMs).toBe(DAYS_PER_WEEK * HOURS_PER_DAY * MS_PER_HOUR);
          expect(result.periodEnd.getTime()).toBe(now.getTime());
        },
      ),
      { numRuns: 100 },
    );
  });
});
