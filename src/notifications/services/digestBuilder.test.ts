import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { DigestBuilder, DigestEntry } from './digestBuilder.js';
import { createDigestBuilder } from './digestBuilder.js';

function makeEntry(overrides: Partial<DigestEntry> = {}): DigestEntry {
  return {
    notificationId: 'notif-1',
    userId: 'user-1',
    category: 'transactions',
    priority: 'normal',
    title: 'Payment received',
    body: 'You received ₦50,000',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('DigestBuilder', () => {
  let builder: DigestBuilder;

  beforeEach(() => {
    vi.useFakeTimers();
    builder = createDigestBuilder();
  });

  describe('addEntry / getEntries', () => {
    it('should store and retrieve entries for a user', () => {
      const entry = makeEntry();
      builder.addEntry(entry);

      const entries = builder.getEntries('user-1');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(entry);
    });

    it('should return empty array for unknown user', () => {
      expect(builder.getEntries('unknown')).toEqual([]);
    });

    it('should store entries per user independently', () => {
      builder.addEntry(makeEntry({ userId: 'user-1' }));
      builder.addEntry(makeEntry({ userId: 'user-2' }));

      expect(builder.getEntries('user-1')).toHaveLength(1);
      expect(builder.getEntries('user-2')).toHaveLength(1);
    });
  });

  describe('clearEntries', () => {
    it('should remove all entries for a user', () => {
      builder.addEntry(makeEntry({ userId: 'user-1' }));
      builder.addEntry(makeEntry({ userId: 'user-1', notificationId: 'notif-2' }));
      builder.clearEntries('user-1');

      expect(builder.getEntries('user-1')).toEqual([]);
    });

    it('should not affect other users', () => {
      builder.addEntry(makeEntry({ userId: 'user-1' }));
      builder.addEntry(makeEntry({ userId: 'user-2' }));
      builder.clearEntries('user-1');

      expect(builder.getEntries('user-2')).toHaveLength(1);
    });
  });

  describe('buildDailyDigest', () => {
    it('should include entries from the last 24 hours', () => {
      const now = new Date('2024-06-10T07:00:00.000Z'); // 8 AM WAT
      const recent = makeEntry({ createdAt: new Date('2024-06-09T10:00:00.000Z') });
      const old = makeEntry({
        notificationId: 'old',
        createdAt: new Date('2024-06-08T06:00:00.000Z'),
      });

      builder.addEntry(recent);
      builder.addEntry(old);

      const digest = builder.buildDailyDigest('user-1', now);
      expect(digest.entries).toHaveLength(1);
      expect(digest.entries[0]).toEqual(recent);
    });

    it('should set correct period boundaries', () => {
      const now = new Date('2024-06-10T07:00:00.000Z');
      const digest = builder.buildDailyDigest('user-1', now);

      expect(digest.periodEnd).toEqual(now);
      expect(digest.periodStart).toEqual(new Date('2024-06-09T07:00:00.000Z'));
    });

    it('should group entries by category', () => {
      const now = new Date('2024-06-10T07:00:00.000Z');
      builder.addEntry(
        makeEntry({
          category: 'transactions',
          createdAt: new Date('2024-06-10T05:00:00.000Z'),
        }),
      );
      builder.addEntry(
        makeEntry({
          notificationId: 'notif-2',
          category: 'security',
          createdAt: new Date('2024-06-10T06:00:00.000Z'),
        }),
      );
      builder.addEntry(
        makeEntry({
          notificationId: 'notif-3',
          category: 'transactions',
          createdAt: new Date('2024-06-10T06:30:00.000Z'),
        }),
      );

      const digest = builder.buildDailyDigest('user-1', now);
      expect(digest.groupedByCategory['transactions']).toHaveLength(2);
      expect(digest.groupedByCategory['security']).toHaveLength(1);
      expect(digest.totalCount).toBe(3);
    });

    it('should return empty digest when no entries exist', () => {
      const now = new Date('2024-06-10T07:00:00.000Z');
      const digest = builder.buildDailyDigest('user-1', now);

      expect(digest.entries).toEqual([]);
      expect(digest.totalCount).toBe(0);
      expect(digest.groupedByCategory).toEqual({});
    });

    it('should set generatedAt to current time', () => {
      const now = new Date('2024-06-10T07:00:00.000Z');
      const digest = builder.buildDailyDigest('user-1', now);
      expect(digest.generatedAt).toEqual(now);
    });
  });

  describe('buildWeeklyDigest', () => {
    it('should include entries from the last 7 days', () => {
      const now = new Date('2024-06-10T07:00:00.000Z'); // Monday 8 AM WAT
      const recent = makeEntry({ createdAt: new Date('2024-06-05T10:00:00.000Z') });
      const old = makeEntry({
        notificationId: 'old',
        createdAt: new Date('2024-06-01T06:00:00.000Z'),
      });

      builder.addEntry(recent);
      builder.addEntry(old);

      const digest = builder.buildWeeklyDigest('user-1', now);
      expect(digest.entries).toHaveLength(1);
      expect(digest.entries[0]).toEqual(recent);
    });

    it('should set correct 7-day period boundaries', () => {
      const now = new Date('2024-06-10T07:00:00.000Z');
      const digest = builder.buildWeeklyDigest('user-1', now);

      expect(digest.periodEnd).toEqual(now);
      expect(digest.periodStart).toEqual(new Date('2024-06-03T07:00:00.000Z'));
    });
  });

  describe('topEntries (priority limiting)', () => {
    it('should limit topEntries to 10 items', () => {
      const now = new Date('2024-06-10T07:00:00.000Z');
      for (let i = 0; i < 15; i++) {
        builder.addEntry(
          makeEntry({
            notificationId: `notif-${i}`,
            createdAt: new Date('2024-06-10T05:00:00.000Z'),
          }),
        );
      }

      const digest = builder.buildDailyDigest('user-1', now);
      expect(digest.entries).toHaveLength(15);
      expect(digest.topEntries).toHaveLength(10);
      expect(digest.totalCount).toBe(15);
    });

    it('should return all entries as topEntries when fewer than 10', () => {
      const now = new Date('2024-06-10T07:00:00.000Z');
      for (let i = 0; i < 3; i++) {
        builder.addEntry(
          makeEntry({
            notificationId: `notif-${i}`,
            createdAt: new Date('2024-06-10T05:00:00.000Z'),
          }),
        );
      }

      const digest = builder.buildDailyDigest('user-1', now);
      expect(digest.topEntries).toHaveLength(3);
    });

    it('should sort topEntries by priority (critical first)', () => {
      const now = new Date('2024-06-10T07:00:00.000Z');
      const baseTime = new Date('2024-06-10T05:00:00.000Z');

      builder.addEntry(
        makeEntry({
          notificationId: 'low-1',
          priority: 'low',
          createdAt: baseTime,
        }),
      );
      builder.addEntry(
        makeEntry({
          notificationId: 'critical-1',
          priority: 'critical',
          createdAt: baseTime,
        }),
      );
      builder.addEntry(
        makeEntry({
          notificationId: 'high-1',
          priority: 'high',
          createdAt: baseTime,
        }),
      );
      builder.addEntry(
        makeEntry({
          notificationId: 'normal-1',
          priority: 'normal',
          createdAt: baseTime,
        }),
      );

      const digest = builder.buildDailyDigest('user-1', now);
      expect(digest.topEntries[0]?.notificationId).toBe('critical-1');
      expect(digest.topEntries[1]?.notificationId).toBe('high-1');
      expect(digest.topEntries[2]?.notificationId).toBe('normal-1');
      expect(digest.topEntries[3]?.notificationId).toBe('low-1');
    });

    it('should prefer newer entries within same priority', () => {
      const now = new Date('2024-06-10T07:00:00.000Z');

      builder.addEntry(
        makeEntry({
          notificationId: 'older',
          priority: 'high',
          createdAt: new Date('2024-06-10T03:00:00.000Z'),
        }),
      );
      builder.addEntry(
        makeEntry({
          notificationId: 'newer',
          priority: 'high',
          createdAt: new Date('2024-06-10T06:00:00.000Z'),
        }),
      );

      const digest = builder.buildDailyDigest('user-1', now);
      expect(digest.topEntries[0]?.notificationId).toBe('newer');
      expect(digest.topEntries[1]?.notificationId).toBe('older');
    });

    it('should keep high-priority items when limiting to 10', () => {
      const now = new Date('2024-06-10T07:00:00.000Z');
      const baseTime = new Date('2024-06-10T05:00:00.000Z');

      // Add 1 critical entry
      builder.addEntry(
        makeEntry({
          notificationId: 'critical-0',
          priority: 'critical',
          createdAt: baseTime,
        }),
      );

      // Add 12 low-priority entries
      for (let i = 0; i < 12; i++) {
        builder.addEntry(
          makeEntry({
            notificationId: `low-${i}`,
            priority: 'low',
            createdAt: baseTime,
          }),
        );
      }

      const digest = builder.buildDailyDigest('user-1', now);
      expect(digest.topEntries).toHaveLength(10);
      expect(digest.topEntries[0]?.notificationId).toBe('critical-0');
    });

    it('should work for weekly digest too', () => {
      const now = new Date('2024-06-10T07:00:00.000Z');
      for (let i = 0; i < 15; i++) {
        builder.addEntry(
          makeEntry({
            notificationId: `notif-${i}`,
            createdAt: new Date('2024-06-08T05:00:00.000Z'),
          }),
        );
      }

      const digest = builder.buildWeeklyDigest('user-1', now);
      expect(digest.entries).toHaveLength(15);
      expect(digest.topEntries).toHaveLength(10);
    });

    it('should return empty topEntries when no entries exist', () => {
      const now = new Date('2024-06-10T07:00:00.000Z');
      const digest = builder.buildDailyDigest('user-1', now);
      expect(digest.topEntries).toEqual([]);
    });
  });

  describe('summaryStatistics', () => {
    it('should generate per-category summary labels for daily digest', () => {
      const now = new Date('2024-06-10T07:00:00.000Z');
      builder.addEntry(
        makeEntry({
          category: 'insights',
          createdAt: new Date('2024-06-10T05:00:00.000Z'),
        }),
      );
      builder.addEntry(
        makeEntry({
          notificationId: 'notif-2',
          category: 'insights',
          createdAt: new Date('2024-06-10T05:30:00.000Z'),
        }),
      );
      builder.addEntry(
        makeEntry({
          notificationId: 'notif-3',
          category: 'transactions',
          createdAt: new Date('2024-06-10T06:00:00.000Z'),
        }),
      );

      const digest = builder.buildDailyDigest('user-1', now);
      expect(digest.summaryStatistics).toHaveLength(2);

      const insightsStat = digest.summaryStatistics.find((s) => s.category === 'insights');
      expect(insightsStat?.count).toBe(2);
      expect(insightsStat?.label).toBe('2 new insights today');

      const txStat = digest.summaryStatistics.find((s) => s.category === 'transactions');
      expect(txStat?.count).toBe(1);
      expect(txStat?.label).toBe('1 new transaction today');
    });

    it('should use "this week" label for weekly digest', () => {
      const now = new Date('2024-06-10T07:00:00.000Z');
      builder.addEntry(
        makeEntry({
          category: 'security',
          createdAt: new Date('2024-06-08T05:00:00.000Z'),
        }),
      );

      const digest = builder.buildWeeklyDigest('user-1', now);
      const stat = digest.summaryStatistics.find((s) => s.category === 'security');
      expect(stat?.label).toBe('1 new security alert this week');
    });

    it('should handle singular vs plural correctly', () => {
      const now = new Date('2024-06-10T07:00:00.000Z');
      builder.addEntry(
        makeEntry({
          category: 'compliance',
          createdAt: new Date('2024-06-10T05:00:00.000Z'),
        }),
      );
      builder.addEntry(
        makeEntry({
          notificationId: 'notif-2',
          category: 'compliance',
          createdAt: new Date('2024-06-10T05:30:00.000Z'),
        }),
      );
      builder.addEntry(
        makeEntry({
          notificationId: 'notif-3',
          category: 'compliance',
          createdAt: new Date('2024-06-10T06:00:00.000Z'),
        }),
      );

      const digest = builder.buildDailyDigest('user-1', now);
      const stat = digest.summaryStatistics.find((s) => s.category === 'compliance');
      expect(stat?.label).toBe('3 new compliance updates today');
    });

    it('should return empty summaryStatistics when no entries exist', () => {
      const now = new Date('2024-06-10T07:00:00.000Z');
      const digest = builder.buildDailyDigest('user-1', now);
      expect(digest.summaryStatistics).toEqual([]);
    });

    it('should cover all category label types', () => {
      const now = new Date('2024-06-10T07:00:00.000Z');
      const categories = [
        'security',
        'transactions',
        'insights',
        'compliance',
        'system',
        'marketing',
      ] as const;

      categories.forEach((cat, i) => {
        builder.addEntry(
          makeEntry({
            notificationId: `notif-${i}`,
            category: cat,
            createdAt: new Date('2024-06-10T05:00:00.000Z'),
          }),
        );
      });

      const digest = builder.buildDailyDigest('user-1', now);
      expect(digest.summaryStatistics).toHaveLength(6);

      const labels = digest.summaryStatistics.map((s) => s.label);
      expect(labels).toContain('1 new security alert today');
      expect(labels).toContain('1 new transaction today');
      expect(labels).toContain('1 new insight today');
      expect(labels).toContain('1 new compliance update today');
      expect(labels).toContain('1 new system notification today');
      expect(labels).toContain('1 new marketing message today');
    });
  });

  describe('isDailyDigestTime', () => {
    it('should return true at 8:00 AM WAT (07:00 UTC)', () => {
      const time = new Date('2024-06-10T07:00:00.000Z');
      expect(builder.isDailyDigestTime(time)).toBe(true);
    });

    it('should return false at 8:01 AM WAT', () => {
      const time = new Date('2024-06-10T07:01:00.000Z');
      expect(builder.isDailyDigestTime(time)).toBe(false);
    });

    it('should return false at 7:59 AM WAT', () => {
      const time = new Date('2024-06-10T06:59:00.000Z');
      expect(builder.isDailyDigestTime(time)).toBe(false);
    });

    it('should return false at 9:00 AM WAT', () => {
      const time = new Date('2024-06-10T08:00:00.000Z');
      expect(builder.isDailyDigestTime(time)).toBe(false);
    });

    it('should return true on any day of the week at 8:00 AM WAT', () => {
      // Wednesday
      expect(builder.isDailyDigestTime(new Date('2024-06-12T07:00:00.000Z'))).toBe(true);
      // Saturday
      expect(builder.isDailyDigestTime(new Date('2024-06-15T07:00:00.000Z'))).toBe(true);
    });
  });

  describe('isWeeklyDigestTime', () => {
    it('should return true on Monday at 8:00 AM WAT (07:00 UTC)', () => {
      // 2024-06-10 is a Monday
      const time = new Date('2024-06-10T07:00:00.000Z');
      expect(builder.isWeeklyDigestTime(time)).toBe(true);
    });

    it('should return false on Monday at wrong time', () => {
      const time = new Date('2024-06-10T08:00:00.000Z');
      expect(builder.isWeeklyDigestTime(time)).toBe(false);
    });

    it('should return false on non-Monday at 8:00 AM WAT', () => {
      // 2024-06-11 is a Tuesday
      const time = new Date('2024-06-11T07:00:00.000Z');
      expect(builder.isWeeklyDigestTime(time)).toBe(false);
    });

    it('should return false on Sunday at 8:00 AM WAT', () => {
      // 2024-06-09 is a Sunday
      const time = new Date('2024-06-09T07:00:00.000Z');
      expect(builder.isWeeklyDigestTime(time)).toBe(false);
    });

    it('should handle WAT day boundary correctly (Sunday 23:00 UTC = Monday 00:00 WAT)', () => {
      // Sunday 23:00 UTC = Monday 00:00 WAT — not 8 AM WAT, so false
      const time = new Date('2024-06-09T23:00:00.000Z');
      expect(builder.isWeeklyDigestTime(time)).toBe(false);
    });
  });
});
