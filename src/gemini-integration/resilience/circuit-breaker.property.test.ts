// Gemini Integration - Property tests for circuit breaker state machine
// **Validates: Requirements 8.2, 8.3, 8.4, 8.5, 8.6**

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { CircuitOpenError } from '../types/errors.js';

import { CircuitBreaker } from './circuit-breaker.js';

/**
 * Helper: create a controllable clock for deterministic time-based transitions.
 */
function makeNowFn(startMs = 0): { now: () => Date; advance: (ms: number) => void } {
  let current = startMs;
  return {
    now: (): Date => new Date(current),
    advance: (ms: number): void => {
      current += ms;
    },
  };
}

/**
 * Property 16: Circuit Breaker State Transitions
 *
 * For any circuit breaker instance:
 * - CLOSED -> OPEN: after exactly failureThreshold consecutive failures
 * - OPEN -> HALF_OPEN: after resetTimeoutMs milliseconds
 * - HALF_OPEN -> CLOSED: on first successful request
 * - HALF_OPEN -> OPEN: on first failed request
 * - Success in CLOSED resets failure count to 0
 *
 * **Validates: Requirements 8.2, 8.4, 8.5, 8.6**
 */
describe('Property 16: Circuit Breaker State Transitions', () => {
  it('CLOSED -> OPEN after exactly failureThreshold consecutive failures', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1000, max: 60000 }),
        (failureThreshold, resetTimeoutMs) => {
          const cb = new CircuitBreaker({ failureThreshold, resetTimeoutMs });

          // Before reaching threshold, state stays CLOSED
          for (let i = 0; i < failureThreshold - 1; i++) {
            cb.recordFailure(new Error(`fail-${i}`));
            expect(cb.getState()).toBe('CLOSED');
          }

          // The threshold-th failure opens the circuit
          cb.recordFailure(new Error('final-fail'));
          expect(cb.getState()).toBe('OPEN');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('success in CLOSED resets failure count, preventing OPEN transition', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 15 }),
        fc.integer({ min: 1000, max: 60000 }),
        (failureThreshold, resetTimeoutMs) => {
          const cb = new CircuitBreaker({ failureThreshold, resetTimeoutMs });

          // Accumulate failures just below threshold
          for (let i = 0; i < failureThreshold - 1; i++) {
            cb.recordFailure(new Error(`fail-${i}`));
          }
          expect(cb.getState()).toBe('CLOSED');

          // A success resets the counter
          cb.recordSuccess();
          expect(cb.getState()).toBe('CLOSED');

          // Now failureThreshold - 1 more failures should NOT open (counter was reset)
          for (let i = 0; i < failureThreshold - 1; i++) {
            cb.recordFailure(new Error(`fail-after-reset-${i}`));
          }
          expect(cb.getState()).toBe('CLOSED');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('OPEN -> HALF_OPEN after resetTimeoutMs elapses', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1000, max: 60000 }),
        (failureThreshold, resetTimeoutMs) => {
          const clock = makeNowFn(0);
          const cb = new CircuitBreaker({ failureThreshold, resetTimeoutMs }, clock.now);

          // Drive to OPEN
          for (let i = 0; i < failureThreshold; i++) {
            cb.recordFailure(new Error(`fail-${i}`));
          }
          expect(cb.getState()).toBe('OPEN');

          // Just before timeout — still OPEN
          clock.advance(resetTimeoutMs - 1);
          expect(cb.getState()).toBe('OPEN');

          // At exactly resetTimeoutMs — transitions to HALF_OPEN
          clock.advance(1);
          expect(cb.getState()).toBe('HALF_OPEN');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('HALF_OPEN -> CLOSED on first success', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1000, max: 60000 }),
        (failureThreshold, resetTimeoutMs) => {
          const clock = makeNowFn(0);
          const cb = new CircuitBreaker({ failureThreshold, resetTimeoutMs }, clock.now);

          // Drive to OPEN then HALF_OPEN
          for (let i = 0; i < failureThreshold; i++) {
            cb.recordFailure(new Error(`fail-${i}`));
          }
          clock.advance(resetTimeoutMs);
          expect(cb.getState()).toBe('HALF_OPEN');

          // Success closes the circuit
          cb.recordSuccess();
          expect(cb.getState()).toBe('CLOSED');
          expect(cb.getStatus().failureCount).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('HALF_OPEN -> OPEN on first failure', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1000, max: 60000 }),
        (failureThreshold, resetTimeoutMs) => {
          const clock = makeNowFn(0);
          const cb = new CircuitBreaker({ failureThreshold, resetTimeoutMs }, clock.now);

          // Drive to OPEN then HALF_OPEN
          for (let i = 0; i < failureThreshold; i++) {
            cb.recordFailure(new Error(`fail-${i}`));
          }
          clock.advance(resetTimeoutMs);
          expect(cb.getState()).toBe('HALF_OPEN');

          // Failure re-opens the circuit
          cb.recordFailure(new Error('half-open-fail'));
          expect(cb.getState()).toBe('OPEN');

          // Must wait another full resetTimeoutMs before HALF_OPEN again
          clock.advance(resetTimeoutMs - 1);
          expect(cb.getState()).toBe('OPEN');
          clock.advance(1);
          expect(cb.getState()).toBe('HALF_OPEN');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('arbitrary success/failure sequences respect the state machine', () => {
    const eventArb = fc.constantFrom('success', 'failure') as fc.Arbitrary<'success' | 'failure'>;

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1000, max: 30000 }),
        fc.array(eventArb, { minLength: 1, maxLength: 50 }),
        (failureThreshold, resetTimeoutMs, events) => {
          const clock = makeNowFn(0);
          const cb = new CircuitBreaker({ failureThreshold, resetTimeoutMs }, clock.now);

          let consecutiveFailures = 0;

          for (const event of events) {
            const stateBefore = cb.getState();

            if (stateBefore === 'OPEN') {
              // Advance past timeout to allow transitions
              clock.advance(resetTimeoutMs);
              expect(cb.getState()).toBe('HALF_OPEN');
            }

            const currentState = cb.getState();

            if (event === 'success') {
              cb.recordSuccess();
              consecutiveFailures = 0;

              if (currentState === 'HALF_OPEN') {
                expect(cb.getState()).toBe('CLOSED');
              } else if (currentState === 'CLOSED') {
                expect(cb.getState()).toBe('CLOSED');
              }
            } else {
              cb.recordFailure(new Error('fail'));

              if (currentState === 'HALF_OPEN') {
                expect(cb.getState()).toBe('OPEN');
                consecutiveFailures = 0;
              } else if (currentState === 'CLOSED') {
                consecutiveFailures++;
                if (consecutiveFailures >= failureThreshold) {
                  expect(cb.getState()).toBe('OPEN');
                  consecutiveFailures = 0;
                } else {
                  expect(cb.getState()).toBe('CLOSED');
                }
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 17: Circuit Open Immediate Rejection
 *
 * While the circuit breaker is OPEN, all requests SHALL be immediately
 * rejected with CircuitOpenError without attempting the API call.
 *
 * **Validates: Requirements 8.3**
 */
describe('Property 17: Circuit Open Immediate Rejection', () => {
  it('canExecute returns false for all requests while OPEN', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1000, max: 60000 }),
        fc.integer({ min: 1, max: 20 }),
        (failureThreshold, resetTimeoutMs, requestCount) => {
          const clock = makeNowFn(0);
          const cb = new CircuitBreaker({ failureThreshold, resetTimeoutMs }, clock.now);

          // Drive to OPEN
          for (let i = 0; i < failureThreshold; i++) {
            cb.recordFailure(new Error(`fail-${i}`));
          }
          expect(cb.getState()).toBe('OPEN');

          // Every request attempt while OPEN is rejected
          for (let i = 0; i < requestCount; i++) {
            expect(cb.canExecute()).toBe(false);
            expect(cb.getState()).toBe('OPEN');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('createCircuitOpenError produces CircuitOpenError with valid nextRetryTime', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1000, max: 60000 }),
        fc.integer({ min: 0, max: 100000 }),
        (failureThreshold, resetTimeoutMs, startMs) => {
          const clock = makeNowFn(startMs);
          const cb = new CircuitBreaker({ failureThreshold, resetTimeoutMs }, clock.now);

          // Drive to OPEN
          for (let i = 0; i < failureThreshold; i++) {
            cb.recordFailure(new Error(`fail-${i}`));
          }
          expect(cb.getState()).toBe('OPEN');

          const err = cb.createCircuitOpenError();
          expect(err).toBeInstanceOf(CircuitOpenError);
          expect(err.code).toBe('CIRCUIT_OPEN');
          expect(err.retryable).toBe(false);
          expect(err.nextRetryTime.getTime()).toBe(startMs + resetTimeoutMs);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('OPEN state rejects until timeout elapses, then allows exactly one HALF_OPEN request', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1000, max: 60000 }),
        fc.integer({ min: 1, max: 10 }),
        (failureThreshold, resetTimeoutMs, checkCount) => {
          const clock = makeNowFn(0);
          const cb = new CircuitBreaker(
            { failureThreshold, resetTimeoutMs, halfOpenMaxRequests: 1 },
            clock.now,
          );

          // Drive to OPEN
          for (let i = 0; i < failureThreshold; i++) {
            cb.recordFailure(new Error(`fail-${i}`));
          }

          // All checks before timeout return false
          for (let i = 0; i < checkCount; i++) {
            expect(cb.canExecute()).toBe(false);
          }

          // After timeout, exactly one request is allowed (HALF_OPEN)
          clock.advance(resetTimeoutMs);
          expect(cb.canExecute()).toBe(true);
          expect(cb.getState()).toBe('HALF_OPEN');
        },
      ),
      { numRuns: 100 },
    );
  });
});
