/**
 * Digest Builder Service
 *
 * Generates consolidated notification summaries (daily/weekly digests).
 * Daily digests are sent at 8:00 AM WAT (07:00 UTC).
 * Weekly digests are sent on Monday at 8:00 AM WAT (07:00 UTC).
 *
 * @module notifications/services/digestBuilder
 */

import type { NotificationCategory, NotificationPriority } from '../types/index.js';

// ─── WAT Constants ───

/** WAT is UTC+1, so 8:00 AM WAT = 7:00 AM UTC */
const WAT_OFFSET_HOURS = 1;
const DIGEST_HOUR_WAT = 8;
const _DIGEST_HOUR_UTC = DIGEST_HOUR_WAT - WAT_OFFSET_HOURS; // 7
const MONDAY = 1;
const MS_PER_HOUR = 60 * 60 * 1000;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;

// ─── Interfaces ───

export interface DigestEntry {
  notificationId: string;
  userId: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  body: string;
  createdAt: Date;
}

export interface CategorySummary {
  category: NotificationCategory;
  count: number;
  label: string;
}

export interface DigestResult {
  userId: string;
  entries: DigestEntry[];
  topEntries: DigestEntry[];
  groupedByCategory: Record<string, DigestEntry[]>;
  summaryStatistics: CategorySummary[];
  totalCount: number;
  periodStart: Date;
  periodEnd: Date;
  generatedAt: Date;
}

export interface DigestBuilder {
  addEntry(entry: DigestEntry): void;
  buildDailyDigest(userId: string, now?: Date): DigestResult;
  buildWeeklyDigest(userId: string, now?: Date): DigestResult;
  isDailyDigestTime(now?: Date): boolean;
  isWeeklyDigestTime(now?: Date): boolean;
  getEntries(userId: string): DigestEntry[];
  clearEntries(userId: string): void;
}

// ─── Priority & Limits ───

const MAX_TOP_ENTRIES = 10;

const PRIORITY_WEIGHT: Record<NotificationPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  security: 'security alert',
  transactions: 'transaction',
  insights: 'insight',
  compliance: 'compliance update',
  system: 'system notification',
  marketing: 'marketing message',
};

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function buildCategorySummary(
  grouped: Record<string, DigestEntry[]>,
  periodLabel: string,
): CategorySummary[] {
  return Object.entries(grouped).map(([category, entries]) => {
    const cat = category as NotificationCategory;
    const count = entries.length;
    const label = `${count} new ${pluralize(count, CATEGORY_LABELS[cat])} ${periodLabel}`;
    return { category: cat, count, label };
  });
}

function sortByPriority(entries: DigestEntry[]): DigestEntry[] {
  return [...entries].sort((a, b) => {
    const pDiff = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
    if (pDiff !== 0) return pDiff;
    // Within same priority, newer first
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

// ─── Helpers ───

function getWatHour(date: Date): number {
  return (date.getUTCHours() + WAT_OFFSET_HOURS) % 24;
}

function getWatDay(date: Date): number {
  // Adjust for WAT: if adding offset crosses midnight, day shifts
  const watHour = date.getUTCHours() + WAT_OFFSET_HOURS;
  const dayShift = watHour >= 24 ? 1 : 0;
  return (date.getUTCDay() + dayShift) % 7;
}

function getWatMinutes(date: Date): number {
  return date.getUTCMinutes();
}

function groupByCategory(entries: DigestEntry[]): Record<string, DigestEntry[]> {
  const grouped: Record<string, DigestEntry[]> = {};
  for (const entry of entries) {
    if (!grouped[entry.category]) {
      grouped[entry.category] = [];
    }
    grouped[entry.category].push(entry);
  }
  return grouped;
}

// ─── Factory ───

export function createDigestBuilder(): DigestBuilder {
  const store = new Map<string, DigestEntry[]>();

  function getOrCreateEntries(userId: string): DigestEntry[] {
    let entries = store.get(userId);
    if (!entries) {
      entries = [];
      store.set(userId, entries);
    }
    return entries;
  }

  function addEntry(entry: DigestEntry): void {
    const entries = getOrCreateEntries(entry.userId);
    entries.push(entry);
  }

  function buildDailyDigest(userId: string, now?: Date): DigestResult {
    const currentTime = now ?? new Date();
    const periodEnd = currentTime;
    const periodStart = new Date(currentTime.getTime() - HOURS_PER_DAY * MS_PER_HOUR);

    const allEntries = store.get(userId) ?? [];
    const entries = allEntries.filter(
      (e) => e.createdAt >= periodStart && e.createdAt <= periodEnd,
    );

    const sorted = sortByPriority(entries);
    const topEntries = sorted.slice(0, MAX_TOP_ENTRIES);
    const grouped = groupByCategory(entries);
    const summaryStatistics = buildCategorySummary(grouped, 'today');

    return {
      userId,
      entries,
      topEntries,
      groupedByCategory: grouped,
      summaryStatistics,
      totalCount: entries.length,
      periodStart,
      periodEnd,
      generatedAt: currentTime,
    };
  }

  function buildWeeklyDigest(userId: string, now?: Date): DigestResult {
    const currentTime = now ?? new Date();
    const periodEnd = currentTime;
    const periodStart = new Date(
      currentTime.getTime() - DAYS_PER_WEEK * HOURS_PER_DAY * MS_PER_HOUR,
    );

    const allEntries = store.get(userId) ?? [];
    const entries = allEntries.filter(
      (e) => e.createdAt >= periodStart && e.createdAt <= periodEnd,
    );

    const sorted = sortByPriority(entries);
    const topEntries = sorted.slice(0, MAX_TOP_ENTRIES);
    const grouped = groupByCategory(entries);
    const summaryStatistics = buildCategorySummary(grouped, 'this week');

    return {
      userId,
      entries,
      topEntries,
      groupedByCategory: grouped,
      summaryStatistics,
      totalCount: entries.length,
      periodStart,
      periodEnd,
      generatedAt: currentTime,
    };
  }

  function isDailyDigestTime(now?: Date): boolean {
    const currentTime = now ?? new Date();
    return getWatHour(currentTime) === DIGEST_HOUR_WAT && getWatMinutes(currentTime) === 0;
  }

  function isWeeklyDigestTime(now?: Date): boolean {
    const currentTime = now ?? new Date();
    return (
      getWatDay(currentTime) === MONDAY &&
      getWatHour(currentTime) === DIGEST_HOUR_WAT &&
      getWatMinutes(currentTime) === 0
    );
  }

  function getEntries(userId: string): DigestEntry[] {
    return store.get(userId) ?? [];
  }

  function clearEntries(userId: string): void {
    store.delete(userId);
  }

  return {
    addEntry,
    buildDailyDigest,
    buildWeeklyDigest,
    isDailyDigestTime,
    isWeeklyDigestTime,
    getEntries,
    clearEntries,
  };
}
