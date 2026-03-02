/**
 * Notification Rate Limiter
 *
 * Enforces per-user daily rate limits on notification channels using Redis.
 * Security notifications bypass all rate limits.
 *
 * Limits:
 * - Email: 10 per user per day
 * - Push: 5 per user per day
 * - In-app: unlimited
 *
 * @module notifications/services/rateLimiter
 */

import type { Redis } from 'ioredis';

import type { NotificationCategory, NotificationChannel, RateLimitResult } from '../types/index.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const CHANNEL_LIMITS: Record<string, number> = {
  email: 10,
  push: 5,
};

const TTL_SECONDS = 86400; // 24 hours

// ─── Interface ───────────────────────────────────────────────────────────────

export interface RateLimiter {
  checkLimit(
    userId: string,
    channel: NotificationChannel,
    category: NotificationCategory,
  ): Promise<RateLimitResult>;
  recordDelivery(userId: string, channel: NotificationChannel): Promise<void>;
  getRemainingQuota(userId: string, channel: NotificationChannel): Promise<number>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTodayDateString(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getRedisKey(userId: string, channel: NotificationChannel): string {
  return `ratelimit:${userId}:${channel}:${getTodayDateString()}`;
}

function getEndOfDayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createRateLimiter(redis: Redis): RateLimiter {
  async function checkLimit(
    userId: string,
    channel: NotificationChannel,
    category: NotificationCategory,
  ): Promise<RateLimitResult> {
    // Security notifications always bypass rate limits
    if (category === 'security') {
      return { allowed: true, remaining: Infinity, resetAt: getEndOfDayUTC() };
    }

    // In-app has no limit
    const limit = CHANNEL_LIMITS[channel];
    if (limit === undefined) {
      return { allowed: true, remaining: Infinity, resetAt: getEndOfDayUTC() };
    }

    const key = getRedisKey(userId, channel);
    const countStr = await redis.get(key);
    const count = countStr !== null ? parseInt(countStr, 10) : 0;
    const remaining = Math.max(0, limit - count);

    return {
      allowed: count < limit,
      remaining,
      resetAt: getEndOfDayUTC(),
    };
  }

  async function recordDelivery(userId: string, channel: NotificationChannel): Promise<void> {
    const key = getRedisKey(userId, channel);
    const exists = await redis.exists(key);

    await redis.incr(key);

    if (!exists) {
      await redis.expire(key, TTL_SECONDS);
    }
  }

  async function getRemainingQuota(userId: string, channel: NotificationChannel): Promise<number> {
    const limit = CHANNEL_LIMITS[channel];
    if (limit === undefined) {
      return Infinity;
    }

    const key = getRedisKey(userId, channel);
    const countStr = await redis.get(key);
    const count = countStr !== null ? parseInt(countStr, 10) : 0;

    return Math.max(0, limit - count);
  }

  return { checkLimit, recordDelivery, getRemainingQuota };
}
