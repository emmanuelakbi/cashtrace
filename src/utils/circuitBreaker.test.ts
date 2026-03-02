import { describe, it, expect, beforeEach } from 'vitest';

import { CircuitBreaker, CircuitOpenError } from './circuitBreaker.js';

describe('CircuitBreaker', () => {
  const defaultConfig = {
    failureThreshold: 3,
    resetTimeout: 5000,
    halfOpenRequests: 2,
  };

  let currentTime: number;
  const now = (): number => currentTime;

  beforeEach(() => {
    currentTime = 1000;
  });

  function createBreaker(config = defaultConfig, service = 'test-service'): CircuitBreaker {
    return new CircuitBreaker(config, service, now);
  }

  const succeed = (): Promise<string> => Promise.resolve('ok');
  const fail = (): Promise<never> => Promise.reject(new Error('boom'));

  // ─── Initial State ───────────────────────────────────────────────────

  describe('initial state', () => {
    it('starts in closed state', () => {
      const cb = createBreaker();
      expect(cb.getState()).toBe('closed');
    });

    it('starts with zero stats', () => {
      const cb = createBreaker();
      const stats = cb.getStats();
      expect(stats.failureCount).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.lastFailureTime).toBeNull();
      expect(stats.state).toBe('closed');
    });
  });

  // ─── Closed State ──────────────────────────────────────────────────

  describe('closed state', () => {
    it('passes through successful calls', async () => {
      const cb = createBreaker();
      const result = await cb.execute(succeed);
      expect(result).toBe('ok');
      expect(cb.getStats().successCount).toBe(1);
    });

    it('passes through failures without opening below threshold', async () => {
      const cb = createBreaker();
      // 2 failures, threshold is 3
      await expect(cb.execute(fail)).rejects.toThrow('boom');
      await expect(cb.execute(fail)).rejects.toThrow('boom');
      expect(cb.getState()).toBe('closed');
      expect(cb.getStats().failureCount).toBe(2);
    });

    it('resets failure count on success', async () => {
      const cb = createBreaker();
      await expect(cb.execute(fail)).rejects.toThrow();
      await expect(cb.execute(fail)).rejects.toThrow();
      await cb.execute(succeed);
      expect(cb.getStats().failureCount).toBe(0);
    });
  });

  // ─── Closed → Open Transition ──────────────────────────────────────

  describe('closed → open transition', () => {
    it('opens after exactly failureThreshold consecutive failures', async () => {
      const cb = createBreaker();
      await expect(cb.execute(fail)).rejects.toThrow();
      await expect(cb.execute(fail)).rejects.toThrow();
      expect(cb.getState()).toBe('closed');
      await expect(cb.execute(fail)).rejects.toThrow();
      expect(cb.getState()).toBe('open');
    });

    it('does not open at threshold - 1 failures', async () => {
      const cb = createBreaker({ ...defaultConfig, failureThreshold: 5 });
      for (let i = 0; i < 4; i++) {
        await expect(cb.execute(fail)).rejects.toThrow();
      }
      expect(cb.getState()).toBe('closed');
    });

    it('records lastFailureTime', async () => {
      const cb = createBreaker();
      currentTime = 2000;
      await expect(cb.execute(fail)).rejects.toThrow();
      expect(cb.getStats().lastFailureTime).toBe(2000);
    });
  });

  // ─── Open State (Fail Fast) ────────────────────────────────────────

  describe('open state', () => {
    async function openBreaker(cb: CircuitBreaker): Promise<void> {
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await expect(cb.execute(fail)).rejects.toThrow('boom');
      }
    }

    it('rejects calls immediately with CircuitOpenError', async () => {
      const cb = createBreaker();
      await openBreaker(cb);
      await expect(cb.execute(succeed)).rejects.toThrow(CircuitOpenError);
    });

    it('includes GW_CIRCUIT_OPEN error code', async () => {
      const cb = createBreaker();
      await openBreaker(cb);
      try {
        await cb.execute(succeed);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CircuitOpenError);
        expect((err as CircuitOpenError).code).toBe('GW_CIRCUIT_OPEN');
        expect((err as CircuitOpenError).service).toBe('test-service');
      }
    });

    it('does not call the wrapped function when open', async () => {
      const cb = createBreaker();
      await openBreaker(cb);
      let called = false;
      await expect(
        cb.execute(() => {
          called = true;
          return Promise.resolve('nope');
        }),
      ).rejects.toThrow(CircuitOpenError);
      expect(called).toBe(false);
    });

    it('stays open before resetTimeout elapses', async () => {
      const cb = createBreaker();
      await openBreaker(cb);
      currentTime += defaultConfig.resetTimeout - 1;
      expect(cb.getState()).toBe('open');
    });
  });

  // ─── Open → Half-Open Transition ──────────────────────────────────

  describe('open → half_open transition', () => {
    async function openBreaker(cb: CircuitBreaker): Promise<void> {
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await expect(cb.execute(fail)).rejects.toThrow('boom');
      }
    }

    it('transitions to half_open after resetTimeout', async () => {
      const cb = createBreaker();
      await openBreaker(cb);
      currentTime += defaultConfig.resetTimeout;
      expect(cb.getState()).toBe('half_open');
    });

    it('transitions to half_open at exactly resetTimeout', async () => {
      const cb = createBreaker();
      await openBreaker(cb);
      currentTime += defaultConfig.resetTimeout;
      expect(cb.getState()).toBe('half_open');
    });
  });

  // ─── Half-Open State ───────────────────────────────────────────────

  describe('half_open state', () => {
    async function toHalfOpen(cb: CircuitBreaker): Promise<void> {
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await expect(cb.execute(fail)).rejects.toThrow('boom');
      }
      currentTime += defaultConfig.resetTimeout;
    }

    it('allows limited requests through', async () => {
      const cb = createBreaker();
      await toHalfOpen(cb);
      expect(cb.getState()).toBe('half_open');
      const result = await cb.execute(succeed);
      expect(result).toBe('ok');
    });

    it('transitions to closed after halfOpenRequests successes', async () => {
      const cb = createBreaker();
      await toHalfOpen(cb);
      // halfOpenRequests = 2
      await cb.execute(succeed);
      expect(cb.getState()).toBe('half_open');
      await cb.execute(succeed);
      expect(cb.getState()).toBe('closed');
    });

    it('transitions back to open on any failure', async () => {
      const cb = createBreaker();
      await toHalfOpen(cb);
      await cb.execute(succeed); // 1 success
      await expect(cb.execute(fail)).rejects.toThrow('boom');
      expect(cb.getState()).toBe('open');
    });

    it('resets failure count after transitioning to closed', async () => {
      const cb = createBreaker();
      await toHalfOpen(cb);
      await cb.execute(succeed);
      await cb.execute(succeed);
      expect(cb.getState()).toBe('closed');
      expect(cb.getStats().failureCount).toBe(0);
    });
  });

  // ─── Manual Reset ──────────────────────────────────────────────────

  describe('reset()', () => {
    it('resets from open to closed', async () => {
      const cb = createBreaker();
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await expect(cb.execute(fail)).rejects.toThrow();
      }
      expect(cb.getState()).toBe('open');
      cb.reset();
      expect(cb.getState()).toBe('closed');
    });

    it('clears all stats', async () => {
      const cb = createBreaker();
      await cb.execute(succeed);
      await expect(cb.execute(fail)).rejects.toThrow();
      cb.reset();
      const stats = cb.getStats();
      expect(stats.failureCount).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.lastFailureTime).toBeNull();
    });

    it('allows calls again after reset from open', async () => {
      const cb = createBreaker();
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await expect(cb.execute(fail)).rejects.toThrow();
      }
      cb.reset();
      const result = await cb.execute(succeed);
      expect(result).toBe('ok');
    });
  });

  // ─── Stats Tracking ────────────────────────────────────────────────

  describe('stats tracking', () => {
    it('tracks success count', async () => {
      const cb = createBreaker();
      await cb.execute(succeed);
      await cb.execute(succeed);
      await cb.execute(succeed);
      expect(cb.getStats().successCount).toBe(3);
    });

    it('tracks failure count', async () => {
      const cb = createBreaker();
      await expect(cb.execute(fail)).rejects.toThrow();
      await expect(cb.execute(fail)).rejects.toThrow();
      expect(cb.getStats().failureCount).toBe(2);
    });

    it('tracks lastFailureTime across multiple failures', async () => {
      const cb = createBreaker();
      currentTime = 1000;
      await expect(cb.execute(fail)).rejects.toThrow();
      expect(cb.getStats().lastFailureTime).toBe(1000);
      currentTime = 2000;
      await expect(cb.execute(fail)).rejects.toThrow();
      expect(cb.getStats().lastFailureTime).toBe(2000);
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('works with failureThreshold of 1', async () => {
      const cb = createBreaker({ ...defaultConfig, failureThreshold: 1 });
      await expect(cb.execute(fail)).rejects.toThrow('boom');
      expect(cb.getState()).toBe('open');
    });

    it('works with halfOpenRequests of 1', async () => {
      const cb = createBreaker({ ...defaultConfig, halfOpenRequests: 1 });
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await expect(cb.execute(fail)).rejects.toThrow();
      }
      currentTime += defaultConfig.resetTimeout;
      await cb.execute(succeed);
      expect(cb.getState()).toBe('closed');
    });

    it('full cycle: closed → open → half_open → closed', async () => {
      const cb = createBreaker();

      // closed → open
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await expect(cb.execute(fail)).rejects.toThrow();
      }
      expect(cb.getState()).toBe('open');

      // open → half_open
      currentTime += defaultConfig.resetTimeout;
      expect(cb.getState()).toBe('half_open');

      // half_open → closed
      for (let i = 0; i < defaultConfig.halfOpenRequests; i++) {
        await cb.execute(succeed);
      }
      expect(cb.getState()).toBe('closed');

      // verify it works normally again
      const result = await cb.execute(succeed);
      expect(result).toBe('ok');
    });

    it('full cycle: closed → open → half_open → open', async () => {
      const cb = createBreaker();

      // closed → open
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await expect(cb.execute(fail)).rejects.toThrow();
      }
      expect(cb.getState()).toBe('open');

      // open → half_open
      currentTime += defaultConfig.resetTimeout;
      expect(cb.getState()).toBe('half_open');

      // half_open → open (failure during trial)
      await expect(cb.execute(fail)).rejects.toThrow('boom');
      expect(cb.getState()).toBe('open');
    });
  });
});
