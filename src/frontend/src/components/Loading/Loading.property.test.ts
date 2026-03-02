/**
 * Property-based tests for loading state timeout.
 *
 * **Property 7: Loading State Timeout**
 * _For any_ loading state exceeding 30 seconds, an error state SHALL be
 * displayed with retry option.
 *
 * **Validates: Requirements 8.5**
 *
 * Tag: Feature: frontend-shell, Property 7: Loading State Timeout
 *
 * @module components/Loading/Loading.property.test
 */

import { renderHook, act } from '@testing-library/react';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LOADING_TIMEOUT } from './types';
import { useLoadingTimeout } from './useLoadingTimeout';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Positive timeout durations between 1ms and 120s. */
const timeoutArb = fc.integer({ min: 1, max: 120_000 });

/**
 * Fraction in [0, 1) used to pick a point strictly before the timeout.
 * Multiplied by (timeout - 1) and floored to guarantee elapsed < timeout.
 */
const fractionBeforeArb = fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true });

// ─── Test Setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 7: Loading State Timeout', () => {
  /**
   * **Validates: Requirements 8.5**
   *
   * For any timeout duration and any elapsed time strictly less than that
   * duration, the hook SHALL NOT report a timed-out state.
   */
  it('should NOT time out before the threshold for any timeout duration', () => {
    fc.assert(
      fc.property(timeoutArb, fractionBeforeArb, (timeout, fraction) => {
        const elapsed = Math.floor(fraction * (timeout - 1));

        const { result, unmount } = renderHook(() =>
          useLoadingTimeout({ timeout }),
        );

        act(() => {
          result.current.start();
        });
        act(() => {
          vi.advanceTimersByTime(elapsed);
        });

        expect(result.current.timedOut).toBe(false);
        unmount();
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 8.5**
   *
   * For any timeout duration, the hook SHALL report timed-out state at
   * exactly the threshold.
   */
  it('should time out at exactly the threshold for any timeout duration', () => {
    fc.assert(
      fc.property(timeoutArb, (timeout) => {
        const { result, unmount } = renderHook(() =>
          useLoadingTimeout({ timeout }),
        );

        act(() => {
          result.current.start();
        });
        act(() => {
          vi.advanceTimersByTime(timeout);
        });

        expect(result.current.timedOut).toBe(true);
        unmount();
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 8.5**
   *
   * For any timeout duration, calling reset after a timeout SHALL clear
   * the timed-out state.
   */
  it('should clear timed-out state on reset for any duration', () => {
    fc.assert(
      fc.property(timeoutArb, (timeout) => {
        const { result, unmount } = renderHook(() =>
          useLoadingTimeout({ timeout }),
        );

        // Trigger timeout
        act(() => {
          result.current.start();
        });
        act(() => {
          vi.advanceTimersByTime(timeout);
        });
        expect(result.current.timedOut).toBe(true);

        // Reset should clear it
        act(() => {
          result.current.reset();
        });
        expect(result.current.timedOut).toBe(false);

        unmount();
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 8.5**
   *
   * For any timeout duration, restarting the timer SHALL reset the
   * countdown so the previous elapsed time no longer counts.
   */
  it('should reset the countdown when start is called again for any duration', () => {
    // Use timeouts >= 4 so we can meaningfully split into partial + remaining.
    const restartTimeoutArb = fc.integer({ min: 4, max: 120_000 });

    fc.assert(
      fc.property(restartTimeoutArb, fractionBeforeArb, (timeout, fraction) => {
        // Pick a partial elapsed time that is at least 1 and strictly less than timeout.
        const partialElapsed = 1 + Math.floor(fraction * (timeout - 2));

        const { result, unmount } = renderHook(() =>
          useLoadingTimeout({ timeout }),
        );

        act(() => {
          result.current.start();
        });
        act(() => {
          vi.advanceTimersByTime(partialElapsed);
        });
        expect(result.current.timedOut).toBe(false);

        // Restart the timer — countdown resets to zero.
        act(() => {
          result.current.start();
        });

        // Advance by the same partial amount — should still not be timed out
        // because the countdown was reset.
        act(() => {
          vi.advanceTimersByTime(partialElapsed);
        });
        expect(result.current.timedOut).toBe(false);

        // Advance the remaining time to reach the full timeout from restart.
        act(() => {
          vi.advanceTimersByTime(timeout - partialElapsed);
        });
        expect(result.current.timedOut).toBe(true);

        unmount();
      }),
      { numRuns: 100, verbose: true },
    );
  });

  /**
   * **Validates: Requirements 8.5**
   *
   * The default timeout SHALL be exactly 30 000 ms (30 seconds).
   */
  it('should use 30 000 ms as the default timeout', () => {
    expect(DEFAULT_LOADING_TIMEOUT).toBe(30_000);

    const { result, unmount } = renderHook(() => useLoadingTimeout());

    act(() => {
      result.current.start();
    });

    // 1ms before default — not timed out
    act(() => {
      vi.advanceTimersByTime(29_999);
    });
    expect(result.current.timedOut).toBe(false);

    // At exactly 30s — timed out
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.timedOut).toBe(true);

    unmount();
  });
});
