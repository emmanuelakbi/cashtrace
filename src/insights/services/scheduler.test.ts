import { describe, expect, it } from 'vitest';

import { createWATDate } from '../../utils/timezone.js';

import { InsightScheduler, WAT_OFFSET_HOURS, WAT_SCHEDULE_HOUR } from './scheduler.js';
import type { ScheduleRun, ScheduleRunResult } from './scheduler.js';

describe('InsightScheduler', () => {
  const scheduler = new InsightScheduler();

  // Helper: create a UTC Date that corresponds to a specific WAT time.
  // createWATDate(year, month, day, hour, min, sec) returns the UTC instant
  // for the given WAT local time.
  const watDate = (year: number, month: number, day: number, hour: number, minute = 0): Date =>
    createWATDate(year, month, day, hour, minute);

  // ── isDailyScheduleDue ─────────────────────────────────────────────────

  describe('isDailyScheduleDue', () => {
    it('returns true at exactly 6:00 AM WAT', () => {
      // Tuesday 2025-01-14 06:00 WAT
      const date = watDate(2025, 1, 14, 6);
      expect(scheduler.isDailyScheduleDue(date)).toBe(true);
    });

    it('returns false at 5:59 AM WAT', () => {
      const date = watDate(2025, 1, 14, 5, 59);
      expect(scheduler.isDailyScheduleDue(date)).toBe(false);
    });

    it('returns false at 6:01 AM WAT', () => {
      const date = watDate(2025, 1, 14, 6, 1);
      expect(scheduler.isDailyScheduleDue(date)).toBe(false);
    });

    it('returns false at noon WAT', () => {
      const date = watDate(2025, 1, 14, 12);
      expect(scheduler.isDailyScheduleDue(date)).toBe(false);
    });

    it('returns false at midnight WAT', () => {
      const date = watDate(2025, 1, 14, 0);
      expect(scheduler.isDailyScheduleDue(date)).toBe(false);
    });
  });

  // ── isWeeklyScheduleDue ────────────────────────────────────────────────

  describe('isWeeklyScheduleDue', () => {
    it('returns true on Monday at 6:00 AM WAT', () => {
      // 2025-01-13 is a Monday
      const date = watDate(2025, 1, 13, 6);
      expect(scheduler.isWeeklyScheduleDue(date)).toBe(true);
    });

    it('returns false on Tuesday at 6:00 AM WAT', () => {
      const date = watDate(2025, 1, 14, 6);
      expect(scheduler.isWeeklyScheduleDue(date)).toBe(false);
    });

    it('returns false on Monday at 7:00 AM WAT', () => {
      const date = watDate(2025, 1, 13, 7);
      expect(scheduler.isWeeklyScheduleDue(date)).toBe(false);
    });

    it('returns false on Sunday at 6:00 AM WAT', () => {
      // 2025-01-12 is a Sunday
      const date = watDate(2025, 1, 12, 6);
      expect(scheduler.isWeeklyScheduleDue(date)).toBe(false);
    });
  });

  // ── isMonthlySummaryDue ────────────────────────────────────────────────

  describe('isMonthlySummaryDue', () => {
    it('returns true on the 1st at 6:00 AM WAT', () => {
      const date = watDate(2025, 2, 1, 6);
      expect(scheduler.isMonthlySummaryDue(date)).toBe(true);
    });

    it('returns false on the 2nd at 6:00 AM WAT', () => {
      const date = watDate(2025, 2, 2, 6);
      expect(scheduler.isMonthlySummaryDue(date)).toBe(false);
    });

    it('returns false on the 1st at 7:00 AM WAT', () => {
      const date = watDate(2025, 2, 1, 7);
      expect(scheduler.isMonthlySummaryDue(date)).toBe(false);
    });

    it('returns false on the 15th at 6:00 AM WAT', () => {
      const date = watDate(2025, 2, 15, 6);
      expect(scheduler.isMonthlySummaryDue(date)).toBe(false);
    });
  });

  // ── getSchedulesDue ────────────────────────────────────────────────────

  describe('getSchedulesDue', () => {
    it('returns only daily on a regular weekday at 6:00 AM WAT', () => {
      // 2025-01-14 is a Tuesday, not the 1st
      const date = watDate(2025, 1, 14, 6);
      expect(scheduler.getSchedulesDue(date)).toEqual(['daily']);
    });

    it('returns daily + weekly on a Monday at 6:00 AM WAT', () => {
      // 2025-01-13 is a Monday, not the 1st
      const date = watDate(2025, 1, 13, 6);
      expect(scheduler.getSchedulesDue(date)).toEqual(['daily', 'weekly']);
    });

    it('returns daily + monthly on the 1st (non-Monday) at 6:00 AM WAT', () => {
      // 2025-02-01 is a Saturday
      const date = watDate(2025, 2, 1, 6);
      expect(scheduler.getSchedulesDue(date)).toEqual(['daily', 'monthly']);
    });

    it('returns daily + weekly + monthly when 1st falls on a Monday', () => {
      // 2025-09-01 is a Monday
      const date = watDate(2025, 9, 1, 6);
      expect(scheduler.getSchedulesDue(date)).toEqual(['daily', 'weekly', 'monthly']);
    });

    it('returns empty array at non-schedule time', () => {
      const date = watDate(2025, 1, 14, 10);
      expect(scheduler.getSchedulesDue(date)).toEqual([]);
    });
  });

  // ── createScheduleRun ──────────────────────────────────────────────────

  describe('createScheduleRun', () => {
    it('creates a run with correct type and business IDs', () => {
      const ids = ['biz-1', 'biz-2'];
      const run = scheduler.createScheduleRun('daily', ids);

      expect(run.id).toBeDefined();
      expect(run.type).toBe('daily');
      expect(run.businessIds).toEqual(ids);
      expect(run.status).toBe('pending');
      expect(run.startedAt).toBeInstanceOf(Date);
      expect(run.requestedBy).toBeUndefined();
    });

    it('generates unique IDs for each run', () => {
      const a = scheduler.createScheduleRun('weekly', ['biz-1']);
      const b = scheduler.createScheduleRun('weekly', ['biz-1']);
      expect(a.id).not.toBe(b.id);
    });
  });

  // ── markRunComplete ────────────────────────────────────────────────────

  describe('markRunComplete', () => {
    const basePendingRun: ScheduleRun = {
      id: 'run-1',
      type: 'daily',
      businessIds: ['biz-1', 'biz-2'],
      startedAt: new Date('2025-01-14T05:00:00Z'),
      status: 'running',
    };

    it('marks a successful run as completed', () => {
      const result: ScheduleRunResult = {
        insightsGenerated: 5,
        businessesProcessed: 2,
        errors: [],
        durationMs: 1200,
      };

      const completed = scheduler.markRunComplete(basePendingRun, result);

      expect(completed.status).toBe('completed');
      expect(completed.completedAt).toBeInstanceOf(Date);
      expect(completed.result).toEqual(result);
      expect(completed.id).toBe(basePendingRun.id);
    });

    it('marks a run as failed when all businesses errored', () => {
      const result: ScheduleRunResult = {
        insightsGenerated: 0,
        businessesProcessed: 0,
        errors: [{ businessId: 'biz-1', error: 'timeout' }],
        durationMs: 5000,
      };

      const completed = scheduler.markRunComplete(basePendingRun, result);
      expect(completed.status).toBe('failed');
    });

    it('marks as completed when some businesses succeeded despite errors', () => {
      const result: ScheduleRunResult = {
        insightsGenerated: 3,
        businessesProcessed: 1,
        errors: [{ businessId: 'biz-2', error: 'timeout' }],
        durationMs: 3000,
      };

      const completed = scheduler.markRunComplete(basePendingRun, result);
      expect(completed.status).toBe('completed');
    });
  });

  // ── createManualRefresh ────────────────────────────────────────────────

  describe('createManualRefresh', () => {
    it('creates a manual refresh run for a single business', () => {
      const run = scheduler.createManualRefresh('biz-42', 'user-7');

      expect(run.id).toBeDefined();
      expect(run.type).toBe('manual');
      expect(run.businessIds).toEqual(['biz-42']);
      expect(run.status).toBe('pending');
      expect(run.requestedBy).toBe('user-7');
      expect(run.startedAt).toBeInstanceOf(Date);
    });
  });

  // ── WAT timezone correctness ──────────────────────────────────────────

  describe('WAT timezone correctness', () => {
    it('WAT_OFFSET_HOURS is 1 (UTC+1)', () => {
      expect(WAT_OFFSET_HOURS).toBe(1);
    });

    it('WAT_SCHEDULE_HOUR is 6', () => {
      expect(WAT_SCHEDULE_HOUR).toBe(6);
    });

    it('6:00 AM WAT equals 5:00 AM UTC', () => {
      // 6:00 AM WAT = 5:00 AM UTC
      const utcDate = new Date('2025-01-14T05:00:00.000Z');
      expect(scheduler.isDailyScheduleDue(utcDate)).toBe(true);
    });

    it('6:00 AM UTC is NOT 6:00 AM WAT (it is 7:00 AM WAT)', () => {
      const utcDate = new Date('2025-01-14T06:00:00.000Z');
      expect(scheduler.isDailyScheduleDue(utcDate)).toBe(false);
    });

    it('handles day boundary: 11:00 PM UTC Dec 31 is midnight WAT Jan 1', () => {
      // 23:00 UTC Dec 31 = 00:00 WAT Jan 1 — not schedule time
      const utcDate = new Date('2024-12-31T23:00:00.000Z');
      expect(scheduler.isDailyScheduleDue(utcDate)).toBe(false);
    });

    it('handles month boundary: 5:00 AM UTC on 1st triggers monthly', () => {
      // 5:00 AM UTC March 1 = 6:00 AM WAT March 1
      const utcDate = new Date('2025-03-01T05:00:00.000Z');
      expect(scheduler.isMonthlySummaryDue(utcDate)).toBe(true);
    });

    it('WAT day-of-week boundary: Sunday 11 PM UTC is Monday WAT', () => {
      // 2025-01-12 (Sunday) 23:00 UTC = 2025-01-13 (Monday) 00:00 WAT
      // Not schedule hour though
      const utcDate = new Date('2025-01-12T23:00:00.000Z');
      expect(scheduler.isWeeklyScheduleDue(utcDate)).toBe(false);
      // But 5:00 AM UTC Monday = 6:00 AM WAT Monday
      const mondaySchedule = new Date('2025-01-13T05:00:00.000Z');
      expect(scheduler.isWeeklyScheduleDue(mondaySchedule)).toBe(true);
    });
  });
});
