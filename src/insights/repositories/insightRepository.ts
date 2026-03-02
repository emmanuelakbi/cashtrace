/**
 * Insight Repository — functional data access layer for insights.
 *
 * Uses an in-memory Map-based store that can be swapped for PostgreSQL later.
 * All functions are pure (aside from store mutation) and follow the project's
 * functional repository pattern (exported functions, not a class).
 *
 * @module insights/repositories/insightRepository
 */

import type { Insight, InsightCategory, InsightStatus } from '../types/index.js';

// ─── Store ─────────────────────────────────────────────────────────────────

export interface InsightStore {
  insights: Map<string, Insight>;
}

/** Create a fresh, empty insight store. */
export function createInsightStore(): InsightStore {
  return { insights: new Map() };
}

// ─── CRUD ──────────────────────────────────────────────────────────────────

/** Persist an insight and return it. Overwrites if the ID already exists. */
export function saveInsight(store: InsightStore, insight: Insight): Insight {
  store.insights.set(insight.id, { ...insight });
  return { ...insight };
}

/** Retrieve an insight by ID, or `undefined` if not found. */
export function getInsightById(store: InsightStore, id: string): Insight | undefined {
  const insight = store.insights.get(id);
  return insight ? { ...insight } : undefined;
}

/** Apply partial updates to an existing insight. Returns the updated insight or `undefined`. */
export function updateInsight(
  store: InsightStore,
  id: string,
  updates: Partial<Insight>,
): Insight | undefined {
  const existing = store.insights.get(id);
  if (!existing) {
    return undefined;
  }
  const updated: Insight = { ...existing, ...updates, id };
  store.insights.set(id, updated);
  return { ...updated };
}

/** Delete an insight by ID. Returns `true` if it existed, `false` otherwise. */
export function deleteInsight(store: InsightStore, id: string): boolean {
  return store.insights.delete(id);
}

// ─── Query ─────────────────────────────────────────────────────────────────

/** Return all insights belonging to a business. */
export function getInsightsByBusiness(store: InsightStore, businessId: string): Insight[] {
  return [...store.insights.values()].filter((i) => i.businessId === businessId);
}

/** Return insights for a business filtered by status. */
export function getInsightsByStatus(
  store: InsightStore,
  businessId: string,
  status: InsightStatus,
): Insight[] {
  return [...store.insights.values()].filter(
    (i) => i.businessId === businessId && i.status === status,
  );
}

/** Return insights for a business filtered by category. */
export function getInsightsByCategory(
  store: InsightStore,
  businessId: string,
  category: InsightCategory,
): Insight[] {
  return [...store.insights.values()].filter(
    (i) => i.businessId === businessId && i.category === category,
  );
}

/** Return only active insights for a business. */
export function getActiveInsights(store: InsightStore, businessId: string): Insight[] {
  return getInsightsByStatus(store, businessId, 'active');
}

/** Count active insights for a business. */
export function countActiveInsights(store: InsightStore, businessId: string): number {
  return getActiveInsights(store, businessId).length;
}

// ─── Bulk ──────────────────────────────────────────────────────────────────

/** Return all insights whose `expiresAt` is before the given date. */
export function getExpiredInsights(store: InsightStore, now: Date): Insight[] {
  return [...store.insights.values()].filter((i) => i.expiresAt < now);
}

/** Update the status of multiple insights by ID. Returns the count of actually updated records. */
export function bulkUpdateStatus(
  store: InsightStore,
  ids: string[],
  status: InsightStatus,
): number {
  let count = 0;
  for (const id of ids) {
    const existing = store.insights.get(id);
    if (existing) {
      store.insights.set(id, { ...existing, status });
      count++;
    }
  }
  return count;
}
