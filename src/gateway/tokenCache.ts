/**
 * In-memory token validation cache with TTL support.
 *
 * Caches JWT validation results to avoid repeated cryptographic
 * verification for the same token within a short window.
 * Uses a simple Map with expiry timestamps and lazy cleanup.
 *
 * @module gateway/tokenCache
 * @see Requirement 3.6
 */

import type { JWTPayload } from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default cache TTL in milliseconds (60 seconds per Req 3.6). */
export const DEFAULT_CACHE_TTL_MS = 60_000;

/** Maximum number of entries before forced eviction of oldest entries. */
const MAX_CACHE_SIZE = 10_000;

// ─── Types ───────────────────────────────────────────────────────────────────

interface CacheEntry {
  payload: JWTPayload;
  expiresAt: number;
}

// ─── Cache State ─────────────────────────────────────────────────────────────

const cache = new Map<string, CacheEntry>();

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Store a validated JWT payload in the cache.
 *
 * If the cache exceeds MAX_CACHE_SIZE, the oldest entries are evicted.
 * The TTL is capped so the cached entry never outlives the token's own
 * expiration.
 */
export function cacheToken(
  token: string,
  payload: JWTPayload,
  ttlMs: number = DEFAULT_CACHE_TTL_MS,
): void {
  // Cap TTL so we never serve a cached result past the token's exp
  const tokenExpiresInMs = payload.exp * 1000 - Date.now();
  const effectiveTtl = Math.min(ttlMs, Math.max(0, tokenExpiresInMs));

  if (effectiveTtl <= 0) {
    return; // Token already expired — don't cache
  }

  // Evict oldest entries if at capacity
  if (cache.size >= MAX_CACHE_SIZE && !cache.has(token)) {
    const firstKey = cache.keys().next().value as string;
    cache.delete(firstKey);
  }

  cache.set(token, {
    payload,
    expiresAt: Date.now() + effectiveTtl,
  });
}

/**
 * Retrieve a cached JWT payload for the given token.
 *
 * Returns `null` on cache miss or if the entry has expired.
 * Expired entries are lazily removed on access.
 */
export function getCachedToken(token: string): JWTPayload | null {
  const entry = cache.get(token);
  if (!entry) {
    return null;
  }

  if (Date.now() >= entry.expiresAt) {
    cache.delete(token);
    return null;
  }

  return entry.payload;
}

/**
 * Remove all entries from the token cache.
 */
export function clearTokenCache(): void {
  cache.clear();
}

/**
 * Return the current number of entries in the cache (including expired).
 * Useful for monitoring / testing.
 */
export function tokenCacheSize(): number {
  return cache.size;
}
