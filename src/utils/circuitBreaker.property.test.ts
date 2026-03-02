/**
 * Property-based tests for Circuit Breaker
 *
 * **Property 4: Circuit Breaker Behavior**
 * For any service with consecutive failures exceeding threshold,
 * subsequent requests SHALL fail fast until reset timeout.
 *
 * **Validates: Requirements 4.6**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import type { CircuitBreakerConfig } from '../gateway/types.js';

import { CircuitBreaker, CircuitOpenError } from './circuitBreaker.js';

// ─── Generators ──────────────────────────────────────────────────────────────

const configArb: fc.Arbitrary<CircuitBreakerConfig> = fc.record({
  failureThreshold: fc.integer({ min: 1, max: 20 }),
  resetTimeout: fc.integer({ min: 100, max: 60_000 }),
  halfOpenRequests: fc.integer({ min: 1, max: 10 }),
});

const serviceNameArb = fc.stringMatching(/^[a-z][a-z0-9-]{1,20}$/);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a controllable clock for deterministic time. */
function makeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

/** Drive the breaker into the open state by injecting consecutive failures. */
async function driveToOpen(breaker: CircuitBreaker, failureThreshold: number): Promise<void> {
  for (let i = 0; i < failureThreshold; i++) {
    try {
      await breaker.execute(() => Promise.reject(new Error('fail')));
    } catch {
      // expected
    }
  }
}

/** Drive an open breaker into half-open by advancing past resetTimeout. */
function driveToHalfOpen(
  breaker: CircuitBreaker,
  clock: { advance: (ms: number) => void },
  resetTimeout: number,
): void {
  clock.advance(resetTimeout);
  // Trigger the state transition check
  breaker.getState();
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Circuit Breaker Behavior (Property 4)', () => {
  /**
   * For any valid config (failureThreshold 1–20), exactly failureThreshold
   * consecutive failures should transition the circuit from closed to open.
   * Fewer failures must keep the circuit closed.
   */
  it('consecutive failures open the circuit at exactly the threshold', async () => {
    await fc.assert(
      fc.asyncProperty(configArb, serviceNameArb, async (config, name) => {
        const clock = makeClock();
        const breaker = new CircuitBreaker(config, name, clock.now);

        // One fewer failure than the threshold — circuit stays closed
        for (let i = 0; i < config.failureThreshold - 1; i++) {
          try {
            await breaker.execute(() => Promise.reject(new Error('fail')));
          } catch {
            // expected
          }
        }
        expect(breaker.getState()).toBe('closed');

        // The threshold-th failure trips the circuit open
        try {
          await breaker.execute(() => Promise.reject(new Error('fail')));
        } catch {
          // expected
        }
        expect(breaker.getState()).toBe('open');
        expect(breaker.getStats().failureCount).toBe(config.failureThreshold);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any open circuit, execute() should throw CircuitOpenError without
   * invoking the wrapped function.
   */
  it('open circuit rejects immediately without calling the wrapped function', async () => {
    await fc.assert(
      fc.asyncProperty(
        configArb,
        serviceNameArb,
        fc.integer({ min: 1, max: 50 }),
        async (config, name, extraCalls) => {
          const clock = makeClock();
          const breaker = new CircuitBreaker(config, name, clock.now);

          await driveToOpen(breaker, config.failureThreshold);
          expect(breaker.getState()).toBe('open');

          // Every subsequent call should fail fast
          let callCount = 0;
          for (let i = 0; i < extraCalls; i++) {
            try {
              await breaker.execute(() => {
                callCount++;
                return Promise.resolve('should not reach');
              });
            } catch (err: unknown) {
              expect(err).toBeInstanceOf(CircuitOpenError);
              expect((err as CircuitOpenError).code).toBe('GW_CIRCUIT_OPEN');
              expect((err as CircuitOpenError).service).toBe(name);
            }
          }

          // The wrapped function was never invoked
          expect(callCount).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * For any open circuit, advancing time by >= resetTimeout should
   * transition the state to half_open.
   */
  it('reset timeout transitions open circuit to half-open', async () => {
    await fc.assert(
      fc.asyncProperty(
        configArb,
        serviceNameArb,
        fc.integer({ min: 0, max: 60_000 }),
        async (config, name, extraMs) => {
          const clock = makeClock();
          const breaker = new CircuitBreaker(config, name, clock.now);

          await driveToOpen(breaker, config.failureThreshold);
          expect(breaker.getState()).toBe('open');

          // Advance exactly resetTimeout + some extra
          clock.advance(config.resetTimeout + extraMs);
          expect(breaker.getState()).toBe('half_open');
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * For any half-open circuit, halfOpenRequests consecutive successes
   * should transition the circuit back to closed.
   */
  it('half-open success transitions to closed after halfOpenRequests successes', async () => {
    await fc.assert(
      fc.asyncProperty(configArb, serviceNameArb, async (config, name) => {
        const clock = makeClock();
        const breaker = new CircuitBreaker(config, name, clock.now);

        // Drive to open, then to half-open
        await driveToOpen(breaker, config.failureThreshold);
        driveToHalfOpen(breaker, clock, config.resetTimeout);
        expect(breaker.getState()).toBe('half_open');

        // Succeed halfOpenRequests - 1 times — still half-open
        for (let i = 0; i < config.halfOpenRequests - 1; i++) {
          await breaker.execute(() => Promise.resolve('ok'));
        }
        if (config.halfOpenRequests > 1) {
          expect(breaker.getState()).toBe('half_open');
        }

        // The final success closes the circuit
        await breaker.execute(() => Promise.resolve('ok'));
        expect(breaker.getState()).toBe('closed');
        expect(breaker.getStats().failureCount).toBe(0);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any half-open circuit, a single failure should transition the
   * circuit back to open immediately.
   */
  it('half-open failure transitions back to open', async () => {
    await fc.assert(
      fc.asyncProperty(configArb, serviceNameArb, async (config, name) => {
        const clock = makeClock();
        const breaker = new CircuitBreaker(config, name, clock.now);

        // Drive to open, then to half-open
        await driveToOpen(breaker, config.failureThreshold);
        driveToHalfOpen(breaker, clock, config.resetTimeout);
        expect(breaker.getState()).toBe('half_open');

        // A single failure re-opens the circuit
        try {
          await breaker.execute(() => Promise.reject(new Error('fail')));
        } catch {
          // expected
        }

        expect(breaker.getState()).toBe('open');
      }),
      { numRuns: 200 },
    );
  });
});
