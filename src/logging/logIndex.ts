/**
 * Log Index
 *
 * In-memory inverted index for fast log entry searching.
 * Supports indexing by correlation_id, user_id, time range, log level, and service.
 *
 * Requirements: 8.3 (index logs for fast searching), 8.4 (query by correlation_id, user_id, time range)
 *
 * @module logging/logIndex
 */

import type { LogEntry, LogLevel } from './logger.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LogQuery {
  correlationId?: string;
  userId?: string;
  level?: LogLevel;
  service?: string;
  startTime?: string;
  endTime?: string;
}

export interface LogIndex {
  /** Add a log entry to the index. */
  add(entry: LogEntry): void;
  /** Query log entries matching all provided criteria. */
  query(q: LogQuery): LogEntry[];
  /** Return total number of indexed entries. */
  size(): number;
  /** Clear all indexed data. */
  clear(): void;
}

// ─── Implementation ──────────────────────────────────────────────────────────

export function createLogIndex(): LogIndex {
  const entries: LogEntry[] = [];
  const byCorrelationId = new Map<string, Set<number>>();
  const byUserId = new Map<string, Set<number>>();
  const byLevel = new Map<LogLevel, Set<number>>();
  const byService = new Map<string, Set<number>>();

  function addToMap<K>(map: Map<K, Set<number>>, key: K, idx: number): void {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(idx);
  }

  function add(entry: LogEntry): void {
    const idx = entries.length;
    entries.push(entry);

    addToMap(byCorrelationId, entry.correlationId, idx);
    if (entry.userId) addToMap(byUserId, entry.userId, idx);
    addToMap(byLevel, entry.level, idx);
    addToMap(byService, entry.service, idx);
  }

  function intersect(sets: Set<number>[]): Set<number> {
    if (sets.length === 0) return new Set();
    // Start with the smallest set for efficiency
    const sorted = [...sets].sort((a, b) => a.size - b.size);
    const result = new Set(sorted[0]);
    for (let i = 1; i < sorted.length; i++) {
      for (const val of result) {
        if (!sorted[i]!.has(val)) result.delete(val);
      }
    }
    return result;
  }

  function query(q: LogQuery): LogEntry[] {
    const candidateSets: Set<number>[] = [];

    if (q.correlationId !== undefined) {
      candidateSets.push(byCorrelationId.get(q.correlationId) ?? new Set());
    }
    if (q.userId !== undefined) {
      candidateSets.push(byUserId.get(q.userId) ?? new Set());
    }
    if (q.level !== undefined) {
      candidateSets.push(byLevel.get(q.level) ?? new Set());
    }
    if (q.service !== undefined) {
      candidateSets.push(byService.get(q.service) ?? new Set());
    }

    let indices: Set<number>;
    if (candidateSets.length > 0) {
      indices = intersect(candidateSets);
    } else {
      // No field filters — all entries are candidates (time range only)
      indices = new Set(entries.map((_, i) => i));
    }

    // Apply time range filter
    const startMs = q.startTime ? new Date(q.startTime).getTime() : -Infinity;
    const endMs = q.endTime ? new Date(q.endTime).getTime() : Infinity;

    const results: LogEntry[] = [];
    for (const idx of indices) {
      const entry = entries[idx]!;
      const ts = new Date(entry.timestamp).getTime();
      if (ts >= startMs && ts <= endMs) {
        results.push(entry);
      }
    }

    return results;
  }

  function size(): number {
    return entries.length;
  }

  function clear(): void {
    entries.length = 0;
    byCorrelationId.clear();
    byUserId.clear();
    byLevel.clear();
    byService.clear();
  }

  return { add, query, size, clear };
}
