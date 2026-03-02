/**
 * Deduplication Service
 *
 * Prevents duplicate notifications from being sent to the same user within
 * a configurable time window (default 1 hour). Uses an in-memory Map with
 * SHA-256 hashing of userId + templateId + variables for dedup lookup.
 *
 * @module notifications/services/deduplication
 */

import { createHash } from 'node:crypto';

// ─── Constants ───────────────────────────────────────────────────────────────

const ONE_HOUR_MS = 60 * 60 * 1000;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DeduplicationService {
  /** Check if an identical notification was sent within the dedup window. */
  isDuplicate(userId: string, templateId: string, variables: Record<string, unknown>): boolean;
  /** Record that a notification was sent for dedup tracking. */
  recordSent(userId: string, templateId: string, variables: Record<string, unknown>): void;
  /** Clear all dedup records (for testing). */
  clear(): void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate a SHA-256 hash key from userId, templateId, and variables.
 * Deterministic: same inputs always produce the same hash.
 */
export function generateDedupKey(
  userId: string,
  templateId: string,
  variables: Record<string, unknown>,
): string {
  const raw = userId + templateId + JSON.stringify(variables);
  return createHash('sha256').update(raw).digest('hex');
}

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * Create a deduplication service with an in-memory Map-based store.
 *
 * Entries older than the configured window (default 1 hour) are lazily
 * evicted on each `isDuplicate` lookup.
 *
 * @param windowMs - Dedup window in milliseconds (default: 1 hour)
 */
export function createDeduplicationService(windowMs: number = ONE_HOUR_MS): DeduplicationService {
  const store = new Map<string, number>();

  function evictExpired(): void {
    const now = Date.now();
    for (const [key, timestamp] of store) {
      if (now - timestamp >= windowMs) {
        store.delete(key);
      }
    }
  }

  function isDuplicate(
    userId: string,
    templateId: string,
    variables: Record<string, unknown>,
  ): boolean {
    evictExpired();
    const key = generateDedupKey(userId, templateId, variables);
    return store.has(key);
  }

  function recordSent(
    userId: string,
    templateId: string,
    variables: Record<string, unknown>,
  ): void {
    const key = generateDedupKey(userId, templateId, variables);
    store.set(key, Date.now());
  }

  function clear(): void {
    store.clear();
  }

  return { isDuplicate, recordSent, clear };
}
