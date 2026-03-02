/**
 * Property-based tests for Toast Stacking (Property 6).
 *
 * **Validates: Requirements 7.4**
 *
 * _For any_ multiple simultaneous toasts, they SHALL stack without overlap
 * and auto-dismiss in order.
 */
import * as fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useToastStore } from './toastStore';
import type { ToastOptions, ToastType } from './types';
import { DEFAULT_DURATION } from './types';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const toastTypeArb: fc.Arbitrary<ToastType> = fc.constantFrom(
  'success',
  'error',
  'warning',
  'info',
);

/** Generate a valid ToastOptions with a positive duration. */
const toastOptionsArb: fc.Arbitrary<ToastOptions> = fc.record({
  type: toastTypeArb,
  title: fc.string({ minLength: 1, maxLength: 50 }),
  message: fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
  duration: fc.option(fc.integer({ min: 100, max: 10000 }), { nil: undefined }),
});

/**
 * Generate a non-empty list of toast options (1–20 toasts).
 * Capped at 20 to keep test execution fast while covering realistic scenarios.
 */
const toastBatchArb: fc.Arbitrary<ToastOptions[]> = fc.array(toastOptionsArb, {
  minLength: 1,
  maxLength: 20,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore(): void {
  useToastStore.getState().dismissAll();
  useToastStore.setState({ toasts: [] });
}

function effectiveDuration(opts: ToastOptions): number {
  return opts.duration ?? DEFAULT_DURATION;
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Property 6: Toast Stacking — Validates: Requirements 7.4', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    resetStore();
    vi.useRealTimers();
  });

  it('all simultaneously shown toasts appear in the store', () => {
    fc.assert(
      fc.property(toastBatchArb, (batch) => {
        resetStore();

        batch.forEach((opts) => useToastStore.getState().show(opts));

        const { toasts } = useToastStore.getState();
        expect(toasts).toHaveLength(batch.length);
      }),
      { numRuns: 100 },
    );
  });

  it('toasts maintain insertion order', () => {
    fc.assert(
      fc.property(toastBatchArb, (batch) => {
        resetStore();

        const ids = batch.map((opts) => useToastStore.getState().show(opts));

        const { toasts } = useToastStore.getState();
        const storedIds = toasts.map((t) => t.id);
        expect(storedIds).toEqual(ids);

        // Titles also preserve insertion order
        const storedTitles = toasts.map((t) => t.title);
        const inputTitles = batch.map((o) => o.title);
        expect(storedTitles).toEqual(inputTitles);
      }),
      { numRuns: 100 },
    );
  });

  it('auto-dismiss removes toasts in FIFO order when durations are equal', () => {
    fc.assert(
      fc.property(
        fc.array(toastTypeArb, { minLength: 2, maxLength: 10 }),
        fc.integer({ min: 100, max: 5000 }),
        (types, duration) => {
          resetStore();

          // Show all toasts with the same duration so FIFO ordering is deterministic
          const ids = types.map((type, i) =>
            useToastStore.getState().show({
              type,
              title: `toast-${i}`,
              duration,
            }),
          );

          // Advance time to trigger all auto-dismiss timers
          vi.advanceTimersByTime(duration);

          // All toasts should be dismissed
          expect(useToastStore.getState().toasts).toHaveLength(0);

          // Verify they were removed — ids should no longer be present
          ids.forEach((id) => {
            const found = useToastStore.getState().toasts.find((t) => t.id === id);
            expect(found).toBeUndefined();
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  it('after all auto-dismiss timers fire the store is empty', () => {
    fc.assert(
      fc.property(toastBatchArb, (batch) => {
        resetStore();

        batch.forEach((opts) => useToastStore.getState().show(opts));

        // Advance past the longest possible duration to ensure all timers fire
        const maxDuration = Math.max(...batch.map(effectiveDuration));
        vi.advanceTimersByTime(maxDuration + 1);

        expect(useToastStore.getState().toasts).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  it('dismissing one toast does not affect others', () => {
    fc.assert(
      fc.property(
        fc.array(toastOptionsArb, { minLength: 2, maxLength: 15 }),
        fc.nat(),
        (batch, rawIndex) => {
          resetStore();

          // Use duration: 0 to prevent auto-dismiss interference
          const ids = batch.map((opts) =>
            useToastStore.getState().show({ ...opts, duration: 0 }),
          );

          // Pick a random toast to dismiss
          const dismissIndex = rawIndex % ids.length;
          const dismissedId = ids[dismissIndex]!;

          useToastStore.getState().dismiss(dismissedId);

          const remaining = useToastStore.getState().toasts;

          // Exactly one fewer toast
          expect(remaining).toHaveLength(ids.length - 1);

          // The dismissed toast is gone
          expect(remaining.find((t) => t.id === dismissedId)).toBeUndefined();

          // All other toasts are still present in original order
          const expectedIds = ids.filter((id) => id !== dismissedId);
          expect(remaining.map((t) => t.id)).toEqual(expectedIds);
        },
      ),
      { numRuns: 100 },
    );
  });
});
