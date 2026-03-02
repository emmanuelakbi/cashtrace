// Gemini Integration - Circuit breaker state machine

import { CircuitOpenError } from '../types/errors.js';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerStatus {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: Date | null;
  lastSuccessTime: Date | null;
  nextRetryTime: Date | null;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxRequests: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenMaxRequests: 1,
};

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private halfOpenRequests = 0;
  private lastFailureTime: Date | null = null;
  private lastSuccessTime: Date | null = null;
  private openedAt: Date | null = null;
  private readonly config: CircuitBreakerConfig;
  private readonly nowFn: () => Date;

  constructor(config?: Partial<CircuitBreakerConfig>, nowFn?: () => Date) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.nowFn = nowFn ?? ((): Date => new Date());
  }

  canExecute(): boolean {
    const now = this.nowFn();

    if (this.state === 'CLOSED') {
      return true;
    }

    if (this.state === 'HALF_OPEN') {
      return this.halfOpenRequests < this.config.halfOpenMaxRequests;
    }

    // OPEN state — check if reset timeout has elapsed
    if (this.openedAt) {
      const elapsed = now.getTime() - this.openedAt.getTime();
      if (elapsed >= this.config.resetTimeoutMs) {
        this.transitionTo('HALF_OPEN');
        this.halfOpenRequests = 0;
        return true;
      }
    }

    return false;
  }

  recordSuccess(): void {
    this.lastSuccessTime = this.nowFn();
    this.successCount++;

    if (this.state === 'HALF_OPEN') {
      this.transitionTo('CLOSED');
      this.failureCount = 0;
      this.halfOpenRequests = 0;
      this.openedAt = null;
    } else if (this.state === 'CLOSED') {
      // Reset consecutive failure count on success
      this.failureCount = 0;
    }
  }

  recordFailure(_error: Error): void {
    this.lastFailureTime = this.nowFn();
    this.failureCount++;

    if (this.state === 'HALF_OPEN') {
      this.transitionTo('OPEN');
      this.openedAt = this.nowFn();
      this.halfOpenRequests = 0;
    } else if (this.state === 'CLOSED') {
      if (this.failureCount >= this.config.failureThreshold) {
        this.transitionTo('OPEN');
        this.openedAt = this.nowFn();
      }
    }
  }

  getState(): CircuitState {
    // Check for automatic OPEN → HALF_OPEN transition
    if (this.state === 'OPEN' && this.openedAt) {
      const now = this.nowFn();
      const elapsed = now.getTime() - this.openedAt.getTime();
      if (elapsed >= this.config.resetTimeoutMs) {
        this.transitionTo('HALF_OPEN');
        this.halfOpenRequests = 0;
      }
    }
    return this.state;
  }

  getStatus(): CircuitBreakerStatus {
    // Trigger any pending time-based transitions
    const currentState = this.getState();

    return {
      state: currentState,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      nextRetryTime: this.computeNextRetryTime(),
    };
  }

  forceState(state: CircuitState): void {
    this.state = state;
    if (state === 'OPEN') {
      this.openedAt = this.nowFn();
    } else if (state === 'CLOSED') {
      this.failureCount = 0;
      this.halfOpenRequests = 0;
      this.openedAt = null;
    } else if (state === 'HALF_OPEN') {
      this.halfOpenRequests = 0;
    }
  }

  getNextRetryTime(): Date | null {
    return this.computeNextRetryTime();
  }

  createCircuitOpenError(): CircuitOpenError {
    const nextRetry = this.computeNextRetryTime() ?? this.nowFn();
    return new CircuitOpenError(
      'Circuit breaker is open — service temporarily unavailable',
      nextRetry,
    );
  }

  private transitionTo(newState: CircuitState): void {
    this.state = newState;
  }

  private computeNextRetryTime(): Date | null {
    if (this.state !== 'OPEN' || !this.openedAt) {
      return null;
    }
    return new Date(this.openedAt.getTime() + this.config.resetTimeoutMs);
  }
}
