/**
 * Unit tests for KeyCache.
 *
 * Validates:
 *  - TTL-based expiration of cached data keys
 *  - LRU eviction when max size is reached
 *  - Explicit invalidation for key rotation/revocation
 *  - Configurable TTL and max size
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KeyCache } from './keyCache.js';

describe('KeyCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeKey = (byte: number) => Buffer.from([byte]);

  describe('get / set', () => {
    it('returns undefined for a missing key', () => {
      const cache = new KeyCache();
      expect(cache.get('missing')).toBeUndefined();
    });

    it('stores and retrieves a key', () => {
      const cache = new KeyCache();
      const buf = makeKey(0xaa);
      cache.set('k1', buf);
      expect(cache.get('k1')).toEqual(buf);
    });

    it('overwrites an existing entry on re-set', () => {
      const cache = new KeyCache();
      cache.set('k1', makeKey(0x01));
      cache.set('k1', makeKey(0x02));
      expect(cache.get('k1')).toEqual(makeKey(0x02));
    });
  });

  describe('TTL expiration', () => {
    it('returns the key before TTL expires', () => {
      const cache = new KeyCache({ ttlMs: 1000 });
      cache.set('k1', makeKey(0x01));

      vi.advanceTimersByTime(999);
      expect(cache.get('k1')).toEqual(makeKey(0x01));
    });

    it('returns undefined after TTL expires', () => {
      const cache = new KeyCache({ ttlMs: 1000 });
      cache.set('k1', makeKey(0x01));

      vi.advanceTimersByTime(1000);
      expect(cache.get('k1')).toBeUndefined();
    });

    it('evicts expired entries from size count', () => {
      const cache = new KeyCache({ ttlMs: 1000 });
      cache.set('k1', makeKey(0x01));
      cache.set('k2', makeKey(0x02));

      vi.advanceTimersByTime(1000);
      expect(cache.size).toBe(0);
    });

    it('re-setting a key resets its TTL', () => {
      const cache = new KeyCache({ ttlMs: 1000 });
      cache.set('k1', makeKey(0x01));

      vi.advanceTimersByTime(800);
      cache.set('k1', makeKey(0x01)); // reset TTL

      vi.advanceTimersByTime(800);
      // 800ms since re-set, should still be valid
      expect(cache.get('k1')).toEqual(makeKey(0x01));
    });
  });

  describe('max size and LRU eviction', () => {
    it('evicts the least-recently-accessed entry when at capacity', () => {
      const cache = new KeyCache({ maxSize: 2, ttlMs: 60_000 });
      cache.set('k1', makeKey(0x01));
      vi.advanceTimersByTime(1);
      cache.set('k2', makeKey(0x02));
      vi.advanceTimersByTime(1);

      // k1 was accessed least recently, adding k3 should evict k1
      cache.set('k3', makeKey(0x03));

      expect(cache.get('k1')).toBeUndefined();
      expect(cache.get('k2')).toEqual(makeKey(0x02));
      expect(cache.get('k3')).toEqual(makeKey(0x03));
    });

    it('accessing a key updates its last-accessed time', () => {
      const cache = new KeyCache({ maxSize: 2, ttlMs: 60_000 });
      cache.set('k1', makeKey(0x01));
      vi.advanceTimersByTime(1);
      cache.set('k2', makeKey(0x02));
      vi.advanceTimersByTime(1);

      // Access k1 so it's no longer the LRU
      cache.get('k1');
      vi.advanceTimersByTime(1);

      // Now k2 is the LRU, adding k3 should evict k2
      cache.set('k3', makeKey(0x03));

      expect(cache.get('k1')).toEqual(makeKey(0x01));
      expect(cache.get('k2')).toBeUndefined();
      expect(cache.get('k3')).toEqual(makeKey(0x03));
    });

    it('prefers evicting expired entries over LRU', () => {
      const cache = new KeyCache({ maxSize: 2, ttlMs: 500 });
      cache.set('k1', makeKey(0x01));
      vi.advanceTimersByTime(1);
      cache.set('k2', makeKey(0x02));

      // Expire k1
      vi.advanceTimersByTime(500);
      // Re-set k2 so it's fresh
      cache.set('k2', makeKey(0x02));

      // Adding k3 should evict expired k1, not k2
      cache.set('k3', makeKey(0x03));

      expect(cache.get('k2')).toEqual(makeKey(0x02));
      expect(cache.get('k3')).toEqual(makeKey(0x03));
    });
  });

  describe('invalidate', () => {
    it('removes a specific entry', () => {
      const cache = new KeyCache();
      cache.set('k1', makeKey(0x01));
      cache.set('k2', makeKey(0x02));

      cache.invalidate('k1');

      expect(cache.get('k1')).toBeUndefined();
      expect(cache.get('k2')).toEqual(makeKey(0x02));
    });

    it('is a no-op for a missing key', () => {
      const cache = new KeyCache();
      expect(() => cache.invalidate('missing')).not.toThrow();
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      const cache = new KeyCache();
      cache.set('k1', makeKey(0x01));
      cache.set('k2', makeKey(0x02));

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.get('k1')).toBeUndefined();
      expect(cache.get('k2')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('returns true for a cached, non-expired key', () => {
      const cache = new KeyCache();
      cache.set('k1', makeKey(0x01));
      expect(cache.has('k1')).toBe(true);
    });

    it('returns false for a missing key', () => {
      const cache = new KeyCache();
      expect(cache.has('missing')).toBe(false);
    });

    it('returns false for an expired key', () => {
      const cache = new KeyCache({ ttlMs: 100 });
      cache.set('k1', makeKey(0x01));
      vi.advanceTimersByTime(100);
      expect(cache.has('k1')).toBe(false);
    });
  });

  describe('defaults', () => {
    it('uses 5-minute TTL by default', () => {
      const cache = new KeyCache();
      cache.set('k1', makeKey(0x01));

      vi.advanceTimersByTime(5 * 60 * 1000 - 1);
      expect(cache.get('k1')).toEqual(makeKey(0x01));

      vi.advanceTimersByTime(1);
      expect(cache.get('k1')).toBeUndefined();
    });

    it('uses max size of 100 by default', () => {
      const cache = new KeyCache();
      for (let i = 0; i < 100; i++) {
        cache.set(`k${i}`, makeKey(i));
        vi.advanceTimersByTime(1);
      }
      expect(cache.size).toBe(100);

      // Adding one more should evict the oldest
      cache.set('overflow', makeKey(0xff));
      expect(cache.size).toBe(100);
      expect(cache.get('k0')).toBeUndefined(); // LRU evicted
    });
  });
});
