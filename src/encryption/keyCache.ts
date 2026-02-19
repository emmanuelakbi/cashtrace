/**
 * In-memory cache for decrypted data keys.
 *
 * Provides TTL-based expiration, configurable max size with LRU eviction,
 * and explicit invalidation for key rotation/revocation scenarios.
 *
 * Requirements:
 *  Performance — avoid repeated KMS calls for recently used data keys
 *  3.4 — invalidate cache entries when keys are revoked
 *  3.2 — invalidate cache entries when keys are rotated
 */

export interface KeyCacheConfig {
  /** Time-to-live for cache entries in milliseconds. Defaults to 5 minutes. */
  ttlMs?: number;
  /** Maximum number of entries in the cache. Defaults to 100. */
  maxSize?: number;
}

interface CacheEntry {
  plaintextKey: Buffer;
  createdAt: number;
  lastAccessedAt: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_SIZE = 100;

export class KeyCache {
  private readonly ttlMs: number;
  private readonly maxSize: number;
  private readonly entries = new Map<string, CacheEntry>();

  constructor(config: KeyCacheConfig = {}) {
    this.ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
    this.maxSize = config.maxSize ?? DEFAULT_MAX_SIZE;
  }

  /**
   * Retrieve a cached plaintext key by its key ID.
   * Returns `undefined` if the entry is missing or expired.
   */
  get(keyId: string): Buffer | undefined {
    const entry = this.entries.get(keyId);
    if (!entry) {
      return undefined;
    }
    if (this.isExpired(entry)) {
      this.entries.delete(keyId);
      return undefined;
    }
    entry.lastAccessedAt = Date.now();
    return entry.plaintextKey;
  }

  /**
   * Store a plaintext key in the cache.
   * If the cache is at capacity, the least-recently-accessed entry is evicted.
   */
  set(keyId: string, plaintextKey: Buffer): void {
    // If key already exists, update it
    if (this.entries.has(keyId)) {
      const existing = this.entries.get(keyId)!;
      existing.plaintextKey = plaintextKey;
      existing.createdAt = Date.now();
      existing.lastAccessedAt = Date.now();
      return;
    }

    // Evict expired entries first
    this.evictExpired();

    // If still at capacity, evict the least-recently-accessed entry
    if (this.entries.size >= this.maxSize) {
      this.evictLRU();
    }

    this.entries.set(keyId, {
      plaintextKey,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    });
  }

  /**
   * Invalidate (remove) a specific cache entry.
   * Used when a key is rotated or revoked.
   */
  invalidate(keyId: string): void {
    this.entries.delete(keyId);
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Return the current number of (non-expired) entries in the cache.
   */
  get size(): number {
    this.evictExpired();
    return this.entries.size;
  }

  /**
   * Check whether a key ID is present and not expired.
   */
  has(keyId: string): boolean {
    return this.get(keyId) !== undefined;
  }

  // --- Internal helpers ---

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.createdAt >= this.ttlMs;
  }

  private evictExpired(): void {
    for (const [keyId, entry] of this.entries) {
      if (this.isExpired(entry)) {
        this.entries.delete(keyId);
      }
    }
  }

  private evictLRU(): void {
    let oldestKey: string | undefined;
    let oldestAccess = Infinity;

    for (const [keyId, entry] of this.entries) {
      if (entry.lastAccessedAt < oldestAccess) {
        oldestAccess = entry.lastAccessedAt;
        oldestKey = keyId;
      }
    }

    if (oldestKey !== undefined) {
      this.entries.delete(oldestKey);
    }
  }
}
