/**
 * Unit tests for the Redis-backed sliding window rate limiter.
 *
 * Uses a mock Redis client to verify rate-limiting logic without
 * requiring a live Redis instance. Tests cover:
 * - Sliding window enforcement (Requirement 7.1)
 * - Separate endpoint tracking (Requirement 7.3)
 * - Key builders, remaining attempts, and reset
 *
 * @module middleware/rateLimiter.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkLimit,
  getRemainingAttempts,
  resetLimit,
  passwordLoginKey,
  magicLinkKey,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_WINDOW_SECONDS,
  RATE_LIMIT_PREFIX,
} from './rateLimiter.js';
import type Redis from 'ioredis';

// ─── Mock Redis ──────────────────────────────────────────────────────────────

function createMockRedis() {
  const mockEval = vi.fn();
  const mockZremrangebyscore = vi.fn();
  const mockZcard = vi.fn();
  const mockDel = vi.fn();

  const redis = {
    eval: mockEval,
    zremrangebyscore: mockZremrangebyscore,
    zcard: mockZcard,
    del: mockDel,
  } as unknown as Redis;

  return { redis, mockEval, mockZremrangebyscore, mockZcard, mockDel };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('rateLimiter', () => {
  let redis: Redis;
  let mockEval: ReturnType<typeof vi.fn>;
  let mockZremrangebyscore: ReturnType<typeof vi.fn>;
  let mockZcard: ReturnType<typeof vi.fn>;
  let mockDel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const mocks = createMockRedis();
    redis = mocks.redis;
    mockEval = mocks.mockEval;
    mockZremrangebyscore = mocks.mockZremrangebyscore;
    mockZcard = mocks.mockZcard;
    mockDel = mocks.mockDel;
  });

  // ── Key builders (Requirement 7.3) ─────────────────────────────────────

  describe('key builders', () => {
    it('passwordLoginKey should prefix with rl:password:', () => {
      expect(passwordLoginKey('192.168.1.1')).toBe(`${RATE_LIMIT_PREFIX}password:192.168.1.1`);
    });

    it('magicLinkKey should prefix with rl:magic:', () => {
      expect(magicLinkKey('10.0.0.1')).toBe(`${RATE_LIMIT_PREFIX}magic:10.0.0.1`);
    });

    it('password and magic link keys for the same IP should be different', () => {
      const ip = '172.16.0.1';
      expect(passwordLoginKey(ip)).not.toBe(magicLinkKey(ip));
    });
  });

  // ── checkLimit ─────────────────────────────────────────────────────────

  describe('checkLimit', () => {
    it('should allow the first request (count = 0)', async () => {
      mockEval.mockResolvedValueOnce(0); // Lua returns 0 existing entries

      const result = await checkLimit(redis, 'rl:password:1.2.3.4');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(DEFAULT_MAX_ATTEMPTS - 1); // 4
      expect(result.resetAt).toBeInstanceOf(Date);
    });

    it('should allow requests up to the limit', async () => {
      // 4 existing entries → still under limit of 5
      mockEval.mockResolvedValueOnce(4);

      const result = await checkLimit(redis, 'rl:password:1.2.3.4', 5);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);
    });

    it('should deny requests when limit is reached', async () => {
      // 5 existing entries → at limit
      mockEval.mockResolvedValueOnce(5);

      const result = await checkLimit(redis, 'rl:password:1.2.3.4', 5);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should deny requests when count exceeds limit', async () => {
      mockEval.mockResolvedValueOnce(10);

      const result = await checkLimit(redis, 'rl:password:1.2.3.4', 5);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should use default limit and window when not specified', async () => {
      mockEval.mockResolvedValueOnce(0);

      await checkLimit(redis, 'rl:password:1.2.3.4');

      // Verify the Lua script was called with correct args
      expect(mockEval).toHaveBeenCalledOnce();
      const args = mockEval.mock.calls[0]!;
      // args: [script, 1, key, windowStart, limit, now, member, windowSeconds]
      expect(args[2]).toBe('rl:password:1.2.3.4'); // key
      expect(args[4]).toBe(DEFAULT_MAX_ATTEMPTS.toString()); // limit
      expect(args[7]).toBe(DEFAULT_WINDOW_SECONDS.toString()); // windowSeconds
    });

    it('should accept custom limit and window', async () => {
      mockEval.mockResolvedValueOnce(0);

      await checkLimit(redis, 'rl:test:key', 10, 3600);

      const args = mockEval.mock.calls[0]!;
      expect(args[4]).toBe('10'); // limit
      expect(args[7]).toBe('3600'); // windowSeconds
    });

    it('should return a resetAt date in the future', async () => {
      mockEval.mockResolvedValueOnce(0);
      const before = Date.now();

      const result = await checkLimit(redis, 'rl:test:key', 5, 900);

      const after = Date.now();
      // resetAt should be approximately now + 900s
      expect(result.resetAt.getTime()).toBeGreaterThanOrEqual(before + 900 * 1000);
      expect(result.resetAt.getTime()).toBeLessThanOrEqual(after + 900 * 1000);
    });

    it('should pass the Lua script with correct number of keys', async () => {
      mockEval.mockResolvedValueOnce(0);

      await checkLimit(redis, 'rl:password:1.2.3.4');

      const args = mockEval.mock.calls[0]!;
      // Second arg is numkeys = 1
      expect(args[1]).toBe(1);
    });
  });

  // ── getRemainingAttempts ───────────────────────────────────────────────

  describe('getRemainingAttempts', () => {
    it('should return full limit when no attempts have been made', async () => {
      mockZremrangebyscore.mockResolvedValueOnce(0);
      mockZcard.mockResolvedValueOnce(0);

      const remaining = await getRemainingAttempts(redis, 'rl:password:1.2.3.4');

      expect(remaining).toBe(DEFAULT_MAX_ATTEMPTS);
    });

    it('should return correct remaining after some attempts', async () => {
      mockZremrangebyscore.mockResolvedValueOnce(0);
      mockZcard.mockResolvedValueOnce(3);

      const remaining = await getRemainingAttempts(redis, 'rl:password:1.2.3.4', 5);

      expect(remaining).toBe(2);
    });

    it('should return 0 when limit is exhausted', async () => {
      mockZremrangebyscore.mockResolvedValueOnce(0);
      mockZcard.mockResolvedValueOnce(5);

      const remaining = await getRemainingAttempts(redis, 'rl:password:1.2.3.4', 5);

      expect(remaining).toBe(0);
    });

    it('should return 0 when count exceeds limit (never negative)', async () => {
      mockZremrangebyscore.mockResolvedValueOnce(0);
      mockZcard.mockResolvedValueOnce(10);

      const remaining = await getRemainingAttempts(redis, 'rl:password:1.2.3.4', 5);

      expect(remaining).toBe(0);
    });

    it('should prune expired entries before counting', async () => {
      mockZremrangebyscore.mockResolvedValueOnce(3); // 3 expired entries removed
      mockZcard.mockResolvedValueOnce(2); // 2 remaining

      const remaining = await getRemainingAttempts(redis, 'rl:password:1.2.3.4', 5);

      expect(remaining).toBe(3);
      expect(mockZremrangebyscore).toHaveBeenCalledOnce();
    });

    it('should use the correct window for pruning', async () => {
      mockZremrangebyscore.mockResolvedValueOnce(0);
      mockZcard.mockResolvedValueOnce(0);

      const before = Date.now();
      await getRemainingAttempts(redis, 'rl:test:key', 5, 900);
      const after = Date.now();

      const args = mockZremrangebyscore.mock.calls[0]!;
      expect(args[0]).toBe('rl:test:key');
      expect(args[1]).toBe('-inf');
      // The windowStart should be approximately now - 900*1000
      const windowStart = Number(args[2]);
      expect(windowStart).toBeGreaterThanOrEqual(before - 900 * 1000);
      expect(windowStart).toBeLessThanOrEqual(after - 900 * 1000);
    });
  });

  // ── resetLimit ─────────────────────────────────────────────────────────

  describe('resetLimit', () => {
    it('should delete the key from Redis', async () => {
      mockDel.mockResolvedValueOnce(1);

      await resetLimit(redis, 'rl:password:1.2.3.4');

      expect(mockDel).toHaveBeenCalledOnce();
      expect(mockDel).toHaveBeenCalledWith('rl:password:1.2.3.4');
    });

    it('should not throw when key does not exist', async () => {
      mockDel.mockResolvedValueOnce(0);

      await expect(resetLimit(redis, 'rl:nonexistent')).resolves.toBeUndefined();
    });
  });

  // ── Defaults ───────────────────────────────────────────────────────────

  describe('defaults', () => {
    it('DEFAULT_MAX_ATTEMPTS should be 5 (Requirement 7.1)', () => {
      expect(DEFAULT_MAX_ATTEMPTS).toBe(5);
    });

    it('DEFAULT_WINDOW_SECONDS should be 900 (15 minutes, Requirement 7.1)', () => {
      expect(DEFAULT_WINDOW_SECONDS).toBe(900);
    });
  });

  // ── Endpoint independence (Requirement 7.3) ────────────────────────────

  describe('endpoint independence', () => {
    it('password and magic link keys use different namespaces', () => {
      const ip = '192.168.1.100';
      const pwKey = passwordLoginKey(ip);
      const mlKey = magicLinkKey(ip);

      expect(pwKey).toContain('password');
      expect(mlKey).toContain('magic');
      expect(pwKey).not.toBe(mlKey);
    });

    it('checkLimit on password key does not affect magic link key', async () => {
      // Exhaust password limit
      mockEval.mockResolvedValueOnce(5); // password: at limit
      const pwResult = await checkLimit(redis, passwordLoginKey('1.2.3.4'), 5);
      expect(pwResult.allowed).toBe(false);

      // Magic link should still be allowed (separate key, separate call)
      mockEval.mockResolvedValueOnce(0); // magic: fresh
      const mlResult = await checkLimit(redis, magicLinkKey('1.2.3.4'), 5);
      expect(mlResult.allowed).toBe(true);
    });
  });
});
