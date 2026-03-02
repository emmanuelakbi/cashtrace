/**
 * Circuit breaker implementation for failing backend services.
 *
 * State machine:
 *   closed → open       (after failureThreshold consecutive failures)
 *   open → half_open    (after resetTimeout elapses)
 *   half_open → closed  (all trial requests succeed)
 *   half_open → open    (any trial request fails)
 *
 * When the circuit is open, calls fail fast with GW_CIRCUIT_OPEN.
 *
 * @module utils/circuitBreaker
 * @see Requirements 4.6
 */

import type { CircuitBreakerConfig, CircuitState } from '../gateway/types.js';
import { GATEWAY_ERROR_CODES } from '../gateway/types.js';

/** Statistics tracked by the circuit breaker. */
export interface CircuitBreakerStats {
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  state: CircuitState;
}

/** Error thrown when the circuit is open and calls are rejected. */
export class CircuitOpenError extends Error {
  public readonly code: string;
  public readonly service: string;

  constructor(service: string) {
    super(`Circuit breaker is open for service: ${service}`);
    this.name = 'CircuitOpenError';
    this.code = GATEWAY_ERROR_CODES.CIRCUIT_OPEN;
    this.service = service;
  }
}

/** Optional clock function for testability. */
export type NowFn = () => number;

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private halfOpenSuccesses = 0;
  private lastFailureTime: number | null = null;
  private openedAt: number | null = null;
  private readonly now: NowFn;

  constructor(
    private readonly config: CircuitBreakerConfig,
    private readonly serviceName: string,
    now?: NowFn,
  ) {
    this.now = now ?? Date.now;
  }

  /** Execute a function through the circuit breaker. */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.checkStateTransition();

    if (this.state === 'open') {
      throw new CircuitOpenError(this.serviceName);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error: unknown) {
      this.onFailure();
      throw error;
    }
  }

  /** Return the current circuit state. */
  getState(): CircuitState {
    this.checkStateTransition();
    return this.state;
  }

  /** Manually reset the circuit breaker to closed. */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenSuccesses = 0;
    this.lastFailureTime = null;
    this.openedAt = null;
  }

  /** Return current statistics. */
  getStats(): CircuitBreakerStats {
    this.checkStateTransition();
    return {
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      state: this.state,
    };
  }

  // ─── Internal ────────────────────────────────────────────────────────

  /** Transition open → half_open when resetTimeout has elapsed. */
  private checkStateTransition(): void {
    if (this.state === 'open' && this.openedAt !== null) {
      const elapsed = this.now() - this.openedAt;
      if (elapsed >= this.config.resetTimeout) {
        this.state = 'half_open';
        this.halfOpenSuccesses = 0;
      }
    }
  }

  private onSuccess(): void {
    if (this.state === 'half_open') {
      this.halfOpenSuccesses++;
      this.successCount++;
      if (this.halfOpenSuccesses >= this.config.halfOpenRequests) {
        this.state = 'closed';
        this.failureCount = 0;
        this.halfOpenSuccesses = 0;
      }
    } else {
      // closed state — reset consecutive failure count on success
      this.successCount++;
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = this.now();

    if (this.state === 'half_open') {
      this.tripOpen();
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.tripOpen();
    }
  }

  private tripOpen(): void {
    this.state = 'open';
    this.openedAt = this.now();
    this.halfOpenSuccesses = 0;
  }
}
