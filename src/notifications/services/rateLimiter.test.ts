import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter, type RateLimiter } from './rateLimiter.js';

// ─── Mock Redis ──────────────────────────────────────────────────────────────

interface MockRedis {
  get: ReturnType<typeof vi.fn>;
  incr: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  exists: ReturnType<typeof vi.fn>;
}

function createMockRedis(): MockRedis {
  return {
    get: vi.fn().mockResolvedValue(null),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    exists: vi.fn().mockResolvedValue(0),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const USER_ID = '00000000-0000-0000-0000-000000000001';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RateLimiter', () => {
  let redis: MockRedis;
  let limiter: RateLimiter;

  beforeEach(() => {
    redis = createMockRedis();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    limiter = createRateLimiter(redis as any);
  });

  describe('checkLimit', () => {
    it('allows email when under limit of 10', async () => {
      redis.get.mockResolvedValueOnce('5');

      const result = await limiter.checkLimit(USER_ID, 'email', 'transactions');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5);
      expect(result.resetAt).toBeInstanceOf(Date);
    });

    it('blocks email when limit of 10 is reached', async () => {
      redis.get.mockResolvedValueOnce('10');

      const result = await limiter.checkLimit(USER_ID, 'email', 'transactions');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('allows push when under limit of 5', async () => {
      redis.get.mockResolvedValueOnce('3');

      const result = await limiter.checkLimit(USER_ID, 'push', 'transactions');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });

    it('blocks push when limit of 5 is reached', async () => {
      redis.get.mockResolvedValueOnce('5');

      const result = await limiter.checkLimit(USER_ID, 'push', 'transactions');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('always allows in-app notifications (no limit)', async () => {
      const result = await limiter.checkLimit(USER_ID, 'in_app', 'transactions');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(Infinity);
    });

    it('allows security notifications even when email limit is reached', async () => {
      redis.get.mockResolvedValueOnce('10');

      const result = await limiter.checkLimit(USER_ID, 'email', 'security');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(Infinity);
    });

    it('allows security notifications even when push limit is reached', async () => {
      redis.get.mockResolvedValueOnce('5');

      const result = await limiter.checkLimit(USER_ID, 'push', 'security');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(Infinity);
    });

    it('allows email when no deliveries have been made yet', async () => {
      redis.get.mockResolvedValueOnce(null);

      const result = await limiter.checkLimit(USER_ID, 'email', 'transactions');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(10);
    });

    it('returns a resetAt date in the future', async () => {
      const result = await limiter.checkLimit(USER_ID, 'email', 'transactions');

      expect(result.resetAt.getTime()).toBeGreaterThan(Date.now() - 1000);
    });
  });

  describe('recordDelivery', () => {
    it('increments the counter and sets TTL for new key', async () => {
      redis.exists.mockResolvedValueOnce(0);

      await limiter.recordDelivery(USER_ID, 'email');

      expect(redis.incr).toHaveBeenCalledTimes(1);
      expect(redis.expire).toHaveBeenCalledTimes(1);
      const expireCall = redis.expire.mock.calls[0];
      expect(expireCall[1]).toBe(86400);
    });

    it('increments the counter without resetting TTL for existing key', async () => {
      redis.exists.mockResolvedValueOnce(1);

      await limiter.recordDelivery(USER_ID, 'email');

      expect(redis.incr).toHaveBeenCalledTimes(1);
      expect(redis.expire).not.toHaveBeenCalled();
    });
  });

  describe('getRemainingQuota', () => {
    it('returns full quota when no deliveries made for email', async () => {
      redis.get.mockResolvedValueOnce(null);

      const remaining = await limiter.getRemainingQuota(USER_ID, 'email');

      expect(remaining).toBe(10);
    });

    it('returns correct remaining for email', async () => {
      redis.get.mockResolvedValueOnce('7');

      const remaining = await limiter.getRemainingQuota(USER_ID, 'email');

      expect(remaining).toBe(3);
    });

    it('returns 0 when email limit is exceeded', async () => {
      redis.get.mockResolvedValueOnce('15');

      const remaining = await limiter.getRemainingQuota(USER_ID, 'email');

      expect(remaining).toBe(0);
    });

    it('returns full quota when no deliveries made for push', async () => {
      redis.get.mockResolvedValueOnce(null);

      const remaining = await limiter.getRemainingQuota(USER_ID, 'push');

      expect(remaining).toBe(5);
    });

    it('returns Infinity for in-app channel', async () => {
      const remaining = await limiter.getRemainingQuota(USER_ID, 'in_app');

      expect(remaining).toBe(Infinity);
    });
  });
});
