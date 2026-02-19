/**
 * Redis-backed sliding window rate limiter.
 *
 * Uses a sorted set per key to track request timestamps within a
 * sliding window. Each request adds a member scored by its timestamp;
 * expired members are pruned on every check. This gives accurate
 * per-IP, per-endpoint rate limiting as required by Requirements 7.1
 * and 7.3.
 *
 * @module middleware/rateLimiter
 */

import type { Redis } from 'ioredis';
import type { RateLimitResult } from '../types/index.js';

// ─── Defaults ────────────────────────────────────────────────────────────────

/** Default maximum attempts within the window (Requirement 7.1). */
export const DEFAULT_MAX_ATTEMPTS = 5;

/** Default window size in seconds (15 minutes, Requirement 7.1). */
export const DEFAULT_WINDOW_SECONDS = 15 * 60;

/** Key prefix used in Redis to namespace rate-limit keys. */
export const RATE_LIMIT_PREFIX = 'rl:';

// ─── Endpoint-specific key builders (Requirement 7.3) ────────────────────────

/**
 * Build a rate-limit key for password login attempts from a given IP.
 */
export function passwordLoginKey(ip: string): string {
  return `${RATE_LIMIT_PREFIX}password:${ip}`;
}

/**
 * Build a rate-limit key for magic link requests from a given IP.
 */
export function magicLinkKey(ip: string): string {
  return `${RATE_LIMIT_PREFIX}magic:${ip}`;
}

// ─── Core rate-limit operations ──────────────────────────────────────────────

/**
 * Check whether a request identified by `key` is allowed under the
 * sliding window rate limit.
 *
 * Algorithm (executed atomically via Lua script):
 * 1. Remove all sorted-set members older than `now - windowSeconds`.
 * 2. Count remaining members.
 * 3. If count < limit, add a new member and allow the request.
 * 4. Set key TTL to auto-expire after the window.
 * 5. Return count of entries after the operation.
 */
export async function checkLimit(
  redis: Redis,
  key: string,
  limit: number = DEFAULT_MAX_ATTEMPTS,
  windowSeconds: number = DEFAULT_WINDOW_SECONDS,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;
  // Unique member value to avoid collisions on same-ms requests
  const member = `${now}:${Math.random().toString(36).slice(2)}`;

  // Lua script ensures atomicity: prune → count → conditionally add → expire
  const luaScript = `
    redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
    local count = redis.call('ZCARD', KEYS[1])
    if count < tonumber(ARGV[2]) then
      redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
      redis.call('EXPIRE', KEYS[1], ARGV[5])
      return count
    end
    redis.call('EXPIRE', KEYS[1], ARGV[5])
    return count
  `;

  const currentCount = (await redis.eval(
    luaScript,
    1,
    key,
    windowStart.toString(),
    limit.toString(),
    now.toString(),
    member,
    windowSeconds.toString(),
  )) as number;

  const allowed = currentCount < limit;
  const remaining = allowed ? limit - currentCount - 1 : 0;
  const resetAt = new Date(now + windowSeconds * 1000);

  return { allowed, remaining, resetAt };
}

/**
 * Get the number of remaining attempts for a given key within its
 * current window.
 */
export async function getRemainingAttempts(
  redis: Redis,
  key: string,
  limit: number = DEFAULT_MAX_ATTEMPTS,
  windowSeconds: number = DEFAULT_WINDOW_SECONDS,
): Promise<number> {
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  // Prune expired entries, then count
  await redis.zremrangebyscore(key, '-inf', windowStart);
  const count = await redis.zcard(key);

  return Math.max(0, limit - count);
}

/**
 * Reset (clear) the rate limit for a given key.
 * Intended for administrative use.
 */
export async function resetLimit(redis: Redis, key: string): Promise<void> {
  await redis.del(key);
}
