import { describe, expect, it } from 'vitest';

import { CircuitOpenError } from '../types/errors.js';

import { CircuitBreaker } from './circuit-breaker.js';

function makeNowFn(startMs = 0): { now: () => Date; advance: (ms: number) => void } {
  let current = startMs;
  return {
    now: (): Date => new Date(current),
    advance: (ms: number): void => {
      current += ms;
    },
  };
}

describe('CircuitBreaker', () => {
  describe('initial state', () => {
    it('starts in CLOSED state', () => {
      const cb = new CircuitBreaker();
      expect(cb.getState()).toBe('CLOSED');
    });

    it('reports zero counts initially', () => {
      const cb = new CircuitBreaker();
      const status = cb.getStatus();
      expect(status.failureCount).toBe(0);
      expect(status.successCount).toBe(0);
      expect(status.lastFailureTime).toBeNull();
      expect(status.lastSuccessTime).toBeNull();
      expect(status.nextRetryTime).toBeNull();
    });

    it('allows execution when CLOSED', () => {
      const cb = new CircuitBreaker();
      expect(cb.canExecute()).toBe(true);
    });
  });

  describe('CLOSED state', () => {
    it('stays CLOSED on success', () => {
      const cb = new CircuitBreaker();
      cb.recordSuccess();
      expect(cb.getState()).toBe('CLOSED');
    });

    it('stays CLOSED when failures are below threshold', () => {
      const cb = new CircuitBreaker({ failureThreshold: 5 });
      for (let i = 0; i < 4; i++) {
        cb.recordFailure(new Error('fail'));
      }
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.getStatus().failureCount).toBe(4);
    });

    it('resets failure count on success', () => {
      const cb = new CircuitBreaker({ failureThreshold: 5 });
      cb.recordFailure(new Error('fail'));
      cb.recordFailure(new Error('fail'));
      cb.recordSuccess();
      expect(cb.getStatus().failureCount).toBe(0);
    });
  });

  describe('CLOSED → OPEN transition', () => {
    it('opens after exactly failureThreshold consecutive failures', () => {
      const cb = new CircuitBreaker({ failureThreshold: 5 });
      for (let i = 0; i < 5; i++) {
        cb.recordFailure(new Error('fail'));
      }
      expect(cb.getState()).toBe('OPEN');
    });

    it('rejects execution when OPEN', () => {
      const clock = makeNowFn(1000);
      const cb = new CircuitBreaker({ failureThreshold: 3 }, clock.now);
      for (let i = 0; i < 3; i++) {
        cb.recordFailure(new Error('fail'));
      }
      expect(cb.canExecute()).toBe(false);
    });

    it('reports nextRetryTime when OPEN', () => {
      const clock = makeNowFn(10000);
      const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30000 }, clock.now);
      for (let i = 0; i < 3; i++) {
        cb.recordFailure(new Error('fail'));
      }
      const status = cb.getStatus();
      expect(status.nextRetryTime).toEqual(new Date(10000 + 30000));
    });

    it('uses custom failure threshold', () => {
      const cb = new CircuitBreaker({ failureThreshold: 2 });
      cb.recordFailure(new Error('fail'));
      expect(cb.getState()).toBe('CLOSED');
      cb.recordFailure(new Error('fail'));
      expect(cb.getState()).toBe('OPEN');
    });
  });

  describe('OPEN → HALF_OPEN transition', () => {
    it('transitions to HALF_OPEN after resetTimeout elapses', () => {
      const clock = makeNowFn(0);
      const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5000 }, clock.now);
      cb.recordFailure(new Error('fail'));
      cb.recordFailure(new Error('fail'));
      expect(cb.getState()).toBe('OPEN');

      clock.advance(5000);
      expect(cb.getState()).toBe('HALF_OPEN');
    });

    it('stays OPEN before resetTimeout elapses', () => {
      const clock = makeNowFn(0);
      const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5000 }, clock.now);
      cb.recordFailure(new Error('fail'));
      cb.recordFailure(new Error('fail'));

      clock.advance(4999);
      expect(cb.getState()).toBe('OPEN');
    });

    it('allows one request in HALF_OPEN state', () => {
      const clock = makeNowFn(0);
      const cb = new CircuitBreaker(
        { failureThreshold: 2, resetTimeoutMs: 5000, halfOpenMaxRequests: 1 },
        clock.now,
      );
      cb.recordFailure(new Error('fail'));
      cb.recordFailure(new Error('fail'));

      clock.advance(5000);
      expect(cb.canExecute()).toBe(true);
    });
  });

  describe('HALF_OPEN → CLOSED transition', () => {
    it('closes on first success in HALF_OPEN', () => {
      const clock = makeNowFn(0);
      const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5000 }, clock.now);
      cb.recordFailure(new Error('fail'));
      cb.recordFailure(new Error('fail'));

      clock.advance(5000);
      // Trigger transition via getState
      expect(cb.getState()).toBe('HALF_OPEN');

      cb.recordSuccess();
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.getStatus().failureCount).toBe(0);
    });
  });

  describe('HALF_OPEN → OPEN transition', () => {
    it('reopens on first failure in HALF_OPEN', () => {
      const clock = makeNowFn(0);
      const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5000 }, clock.now);
      cb.recordFailure(new Error('fail'));
      cb.recordFailure(new Error('fail'));

      clock.advance(5000);
      expect(cb.getState()).toBe('HALF_OPEN');

      cb.recordFailure(new Error('fail again'));
      expect(cb.getState()).toBe('OPEN');
    });

    it('resets the timeout window on HALF_OPEN → OPEN', () => {
      const clock = makeNowFn(0);
      const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5000 }, clock.now);
      cb.recordFailure(new Error('fail'));
      cb.recordFailure(new Error('fail'));

      clock.advance(5000);
      expect(cb.getState()).toBe('HALF_OPEN');

      cb.recordFailure(new Error('fail again'));
      expect(cb.getState()).toBe('OPEN');

      // Should need another full timeout before HALF_OPEN again
      clock.advance(4999);
      expect(cb.getState()).toBe('OPEN');
      clock.advance(1);
      expect(cb.getState()).toBe('HALF_OPEN');
    });
  });

  describe('forceState', () => {
    it('forces to OPEN state', () => {
      const cb = new CircuitBreaker();
      cb.forceState('OPEN');
      expect(cb.getState()).toBe('OPEN');
      expect(cb.canExecute()).toBe(false);
    });

    it('forces to CLOSED state and resets failure count', () => {
      const cb = new CircuitBreaker({ failureThreshold: 2 });
      cb.recordFailure(new Error('fail'));
      cb.recordFailure(new Error('fail'));
      expect(cb.getState()).toBe('OPEN');

      cb.forceState('CLOSED');
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.getStatus().failureCount).toBe(0);
      expect(cb.canExecute()).toBe(true);
    });

    it('forces to HALF_OPEN state', () => {
      const cb = new CircuitBreaker();
      cb.forceState('HALF_OPEN');
      expect(cb.getState()).toBe('HALF_OPEN');
      expect(cb.canExecute()).toBe(true);
    });

    it('forced OPEN sets openedAt for timeout tracking', () => {
      const clock = makeNowFn(1000);
      const cb = new CircuitBreaker({ resetTimeoutMs: 5000 }, clock.now);
      cb.forceState('OPEN');
      expect(cb.getState()).toBe('OPEN');
      expect(cb.getStatus().nextRetryTime).toEqual(new Date(1000 + 5000));
    });
  });

  describe('createCircuitOpenError', () => {
    it('returns a CircuitOpenError with nextRetryTime', () => {
      const clock = makeNowFn(10000);
      const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5000 }, clock.now);
      cb.recordFailure(new Error('fail'));
      cb.recordFailure(new Error('fail'));

      const err = cb.createCircuitOpenError();
      expect(err).toBeInstanceOf(CircuitOpenError);
      expect(err.code).toBe('CIRCUIT_OPEN');
      expect(err.retryable).toBe(false);
      expect(err.nextRetryTime).toEqual(new Date(10000 + 5000));
    });

    it('uses current time as fallback when not OPEN', () => {
      const clock = makeNowFn(5000);
      const cb = new CircuitBreaker({}, clock.now);
      const err = cb.createCircuitOpenError();
      expect(err).toBeInstanceOf(CircuitOpenError);
      // When CLOSED, nextRetryTime is null so it falls back to nowFn()
      expect(err.nextRetryTime).toEqual(new Date(5000));
    });
  });

  describe('getNextRetryTime', () => {
    it('returns null when CLOSED', () => {
      const cb = new CircuitBreaker();
      expect(cb.getNextRetryTime()).toBeNull();
    });

    it('returns the computed retry time when OPEN', () => {
      const clock = makeNowFn(2000);
      const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 10000 }, clock.now);
      cb.recordFailure(new Error('fail'));
      cb.recordFailure(new Error('fail'));
      expect(cb.getNextRetryTime()).toEqual(new Date(2000 + 10000));
    });
  });
});
