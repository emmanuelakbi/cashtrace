/**
 * Insight Scheduler — Scheduled and manual insight generation.
 *
 * Manages daily, weekly, and monthly insight generation schedules
 * for all active businesses. All schedule checks use WAT (UTC+1)
 * as the reference timezone.
 *
 * Schedule:
 * - Daily:   Every day at 6:00 AM WAT
 * - Weekly:  Every Monday at 6:00 AM WAT
 * - Monthly: 1st of each month at 6:00 AM WAT
 *
 * @module insights/services/scheduler
 * @see Requirements 10.1, 10.2, 10.3, 10.5
 */

import { v4 as uuidv4 } from 'uuid';

import { getWATDayOfWeek, toWAT } from '../../utils/timezone.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** The WAT hour at which all scheduled runs trigger (6:00 AM). */
export const WAT_SCHEDULE_HOUR = 6;

/** WAT offset from UTC in hours. */
export const WAT_OFFSET_HOURS = 1;

/** Monday as day-of-week index (0 = Sunday). */
const MONDAY = 1;

/** First day of the month. */
const FIRST_OF_MONTH = 1;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Automated schedule cadences. */
export type ScheduleType = 'daily' | 'weekly' | 'monthly';

/** A record tracking a single generation run (scheduled or manual). */
export interface ScheduleRun {
  id: string;
  type: ScheduleType | 'manual';
  businessIds: string[];
  startedAt: Date;
  status: 'pending' | 'running' | 'completed' | 'failed';
  requestedBy?: string;
}

/** Outcome metrics for a completed run. */
export interface ScheduleRunResult {
  insightsGenerated: number;
  businessesProcessed: number;
  errors: Array<{ businessId: string; error: string }>;
  durationMs: number;
}

/** A run that has finished (successfully or with failure). */
export interface CompletedScheduleRun extends ScheduleRun {
  completedAt: Date;
  status: 'completed' | 'failed';
  result: ScheduleRunResult;
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

/**
 * Determines when scheduled insight generation should run and
 * creates / completes run records for tracking.
 */
export class InsightScheduler {
  /**
   * Check whether the daily schedule is due at the given time.
   *
   * True when the WAT hour is 6 and the WAT minute is 0.
   *
   * @param now - Reference point (UTC)
   * @returns Whether the daily schedule should fire
   */
  isDailyScheduleDue(now: Date): boolean {
    const wat = toWAT(now);
    return wat.getUTCHours() === WAT_SCHEDULE_HOUR && wat.getUTCMinutes() === 0;
  }

  /**
   * Check whether the weekly schedule is due at the given time.
   *
   * True when it is Monday at 6:00 AM WAT.
   *
   * @param now - Reference point (UTC)
   * @returns Whether the weekly schedule should fire
   */
  isWeeklyScheduleDue(now: Date): boolean {
    return this.isDailyScheduleDue(now) && getWATDayOfWeek(now) === MONDAY;
  }

  /**
   * Check whether the monthly summary schedule is due at the given time.
   *
   * True when it is the 1st of the month at 6:00 AM WAT.
   *
   * @param now - Reference point (UTC)
   * @returns Whether the monthly schedule should fire
   */
  isMonthlySummaryDue(now: Date): boolean {
    const wat = toWAT(now);
    return this.isDailyScheduleDue(now) && wat.getUTCDate() === FIRST_OF_MONTH;
  }

  /**
   * Return all schedule types that are due at the given time.
   *
   * A single point in time can match multiple schedules (e.g. a Monday
   * that is also the 1st of the month triggers daily + weekly + monthly).
   *
   * @param now - Reference point (UTC)
   * @returns Array of due schedule types (may be empty)
   */
  getSchedulesDue(now: Date): ScheduleType[] {
    const due: ScheduleType[] = [];

    if (this.isDailyScheduleDue(now)) {
      due.push('daily');
    }
    if (this.isWeeklyScheduleDue(now)) {
      due.push('weekly');
    }
    if (this.isMonthlySummaryDue(now)) {
      due.push('monthly');
    }

    return due;
  }

  /**
   * Create a new schedule run record in `pending` state.
   *
   * @param type - The schedule cadence that triggered this run
   * @param businessIds - IDs of businesses to process
   * @returns A new ScheduleRun
   */
  createScheduleRun(type: ScheduleType, businessIds: string[]): ScheduleRun {
    return {
      id: uuidv4(),
      type,
      businessIds,
      startedAt: new Date(),
      status: 'pending',
    };
  }

  /**
   * Mark an existing run as complete (or failed) with its results.
   *
   * @param run - The run to complete
   * @param results - Outcome metrics
   * @returns A CompletedScheduleRun with status derived from errors
   */
  markRunComplete(run: ScheduleRun, results: ScheduleRunResult): CompletedScheduleRun {
    const hasErrors = results.errors.length > 0 && results.businessesProcessed === 0;

    return {
      ...run,
      completedAt: new Date(),
      status: hasErrors ? 'failed' : 'completed',
      result: results,
    };
  }

  /**
   * Create a manual refresh run for a single business.
   *
   * Supports Requirement 10.5 — on-demand insight refresh.
   *
   * @param businessId - The business requesting a refresh
   * @param requestedBy - User or system identifier that triggered the refresh
   * @returns A new ScheduleRun of type `manual`
   */
  createManualRefresh(businessId: string, requestedBy: string): ScheduleRun {
    return {
      id: uuidv4(),
      type: 'manual',
      businessIds: [businessId],
      startedAt: new Date(),
      status: 'pending',
      requestedBy,
    };
  }
}
