/**
 * Unit tests for the in-memory token validation cache.
 *
 * @module gateway/tokenCache.test
 * @see Requirement 3.6
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { makeJWTPayload } from './testHelpers.js';
import {
  cacheToken,
  getCachedToken,
  clearTokenCache,
  tokenCacheSize,
  DEFAULT_CACHE_TTL_MS,
} from './tokenCache.js';

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearTokenCache();
  vi.useRealTimers();
});

// ─── cacheToken / getCachedToken ─────────────────────────────────────────────

describe('cacheToken and getCachedToken', () => {
  it('stores and retrieves a token payload', () => {
    const payload = makeJWTPayload();
    const token = 'jwt-token-abc';

    cacheToken(token, payload);

    const cached = getCachedToken(token);
    expect(cached).not.toBeNull();
    expect(cached?.userId).toBe(payload.userId);
    expect(cached?.email).toBe(payload.email);
    expect(cached?.businessId).toBe(payload.businessId);
    expect(cached?.permissions).toEqual(payload.permissions);
  });

  it('returns null for an unknown token', () => {
    expect(getCachedToken('nonexistent-token')).toBeNull();
  });

  it('returns null after TTL expires', () => {
    vi.useFakeTimers();

    const payload = makeJWTPayload();
    const token = 'jwt-token-ttl';
    const ttlMs = 5_000;

    cacheToken(token, payload, ttlMs);
    expect(getCachedToken(token)).not.toBeNull();

    // Advance time past TTL
    vi.advanceTimersByTime(ttlMs + 1);
    expect(getCachedToken(token)).toBeNull();
  });

  it('uses default TTL of 60 seconds', () => {
    expect(DEFAULT_CACHE_TTL_MS).toBe(60_000);
  });

  it('does not cache a token that is already expired', () => {
    const expiredPayload = makeJWTPayload({
      exp: Math.floor(Date.now() / 1000) - 10, // expired 10s ago
    });

    cacheToken('expired-token', expiredPayload);
    expect(getCachedToken('expired-token')).toBeNull();
    expect(tokenCacheSize()).toBe(0);
  });

  it('caps TTL to token expiration time', () => {
    vi.useFakeTimers();

    // Token expires in 2 seconds, but we request 60s TTL
    const payload = makeJWTPayload({
      exp: Math.floor(Date.now() / 1000) + 2,
    });

    cacheToken('short-lived-token', payload, 60_000);
    expect(getCachedToken('short-lived-token')).not.toBeNull();

    // After 2 seconds the cache entry should be gone (capped to token exp)
    vi.advanceTimersByTime(2_001);
    expect(getCachedToken('short-lived-token')).toBeNull();
  });

  it('overwrites an existing entry for the same token', () => {
    const payload1 = makeJWTPayload({ email: 'first@example.com' });
    const payload2 = makeJWTPayload({ email: 'second@example.com' });

    cacheToken('same-token', payload1);
    cacheToken('same-token', payload2);

    expect(getCachedToken('same-token')?.email).toBe('second@example.com');
    expect(tokenCacheSize()).toBe(1);
  });
});

// ─── clearTokenCache ─────────────────────────────────────────────────────────

describe('clearTokenCache', () => {
  it('removes all cached entries', () => {
    cacheToken('token-a', makeJWTPayload());
    cacheToken('token-b', makeJWTPayload());
    expect(tokenCacheSize()).toBe(2);

    clearTokenCache();
    expect(tokenCacheSize()).toBe(0);
    expect(getCachedToken('token-a')).toBeNull();
    expect(getCachedToken('token-b')).toBeNull();
  });
});

// ─── tokenCacheSize ──────────────────────────────────────────────────────────

describe('tokenCacheSize', () => {
  it('returns 0 for an empty cache', () => {
    expect(tokenCacheSize()).toBe(0);
  });

  it('reflects the number of cached entries', () => {
    cacheToken('t1', makeJWTPayload());
    cacheToken('t2', makeJWTPayload());
    cacheToken('t3', makeJWTPayload());
    expect(tokenCacheSize()).toBe(3);
  });
});
