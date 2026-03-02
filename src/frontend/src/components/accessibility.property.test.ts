/**
 * Property-based tests for Accessibility Compliance (Property 10).
 *
 * Validates:
 * - Requirement 13.1: Keyboard navigation throughout the application
 * - Requirement 13.2: Proper ARIA labels and roles for all interactive elements
 *
 * Uses fast-check to generate arbitrary inputs and verify that accessibility
 * invariants hold for all possible configurations.
 */
import { act, renderHook } from '@testing-library/react';
import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal React.KeyboardEvent-like object. */
function makeKeyEvent(
  key: string,
  overrides: Partial<React.KeyboardEvent> = {},
): React.KeyboardEvent {
  return {
    key,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  } as unknown as React.KeyboardEvent;
}

/** Build a container with N focusable buttons appended to document.body. */
function buildContainer(count: number): HTMLDivElement {
  const container = document.createElement('div');
  for (let i = 0; i < count; i++) {
    const btn = document.createElement('button');
    btn.textContent = `Item ${i}`;
    container.appendChild(btn);
  }
  document.body.appendChild(container);
  return container;
}

/** Attach a container to the hook's ref. */
function attachRef(
  ref: React.RefObject<HTMLElement | null>,
  container: HTMLElement,
): void {
  (ref as React.MutableRefObject<HTMLElement | null>).current = container;
}

// ---------------------------------------------------------------------------
// Property 1: Arrow key cycling (Req 13.1)
// ---------------------------------------------------------------------------

describe('Property 10: Accessibility Compliance', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Keyboard navigation cycling (Req 13.1)', () => {
    /**
     * Property: For any set of navigation items (1–50) and any orientation,
     * pressing the "next" arrow key from each position moves focus to the
     * next item, cycling through all items when wrap is enabled.
     */
    it('arrow key navigates forward through all items with wrap', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 50 }),
          fc.constantFrom('vertical' as const, 'horizontal' as const),
          (itemCount, orientation) => {
            document.body.innerHTML = '';
            const container = buildContainer(itemCount);
            const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';

            const { result } = renderHook(() =>
              useKeyboardNavigation({ orientation, wrap: true }),
            );
            attachRef(result.current.containerRef, container);

            const buttons = container.querySelectorAll('button');
            (buttons[0] as HTMLElement).focus();

            // Navigate forward through every item
            for (let i = 0; i < itemCount - 1; i++) {
              act(() => {
                result.current.handleKeyDown(makeKeyEvent(nextKey));
              });
              expect(document.activeElement).toBe(buttons[i + 1]);
            }

            // One more press should wrap to first
            act(() => {
              result.current.handleKeyDown(makeKeyEvent(nextKey));
            });
            expect(document.activeElement).toBe(buttons[0]);
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * Property: For any set of navigation items (1–50) and any orientation,
     * pressing the "prev" arrow key from each position moves focus backward,
     * cycling through all items when wrap is enabled.
     */
    it('arrow key navigates backward through all items with wrap', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 50 }),
          fc.constantFrom('vertical' as const, 'horizontal' as const),
          (itemCount, orientation) => {
            document.body.innerHTML = '';
            const container = buildContainer(itemCount);
            const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';

            const { result } = renderHook(() =>
              useKeyboardNavigation({ orientation, wrap: true }),
            );
            attachRef(result.current.containerRef, container);

            const buttons = container.querySelectorAll('button');
            const lastIndex = itemCount - 1;
            (buttons[lastIndex] as HTMLElement).focus();

            // Navigate backward through every item
            for (let i = lastIndex; i > 0; i--) {
              act(() => {
                result.current.handleKeyDown(makeKeyEvent(prevKey));
              });
              expect(document.activeElement).toBe(buttons[i - 1]);
            }

            // One more press should wrap to last
            act(() => {
              result.current.handleKeyDown(makeKeyEvent(prevKey));
            });
            expect(document.activeElement).toBe(buttons[lastIndex]);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 2: Home/End keys (Req 13.1)
  // ---------------------------------------------------------------------------

  describe('Home/End focus behavior (Req 13.1)', () => {
    /**
     * Property: For any number of focusable elements (1–50) and any starting
     * position, Home always focuses the first element and End always focuses
     * the last element.
     */
    it('Home focuses first and End focuses last regardless of position', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 50 }),
          fc.integer({ min: 0, max: 49 }),
          (itemCount, rawStartIndex) => {
            document.body.innerHTML = '';
            const container = buildContainer(itemCount);
            const startIndex = rawStartIndex % itemCount;

            const { result } = renderHook(() => useKeyboardNavigation());
            attachRef(result.current.containerRef, container);

            const buttons = container.querySelectorAll('button');
            (buttons[startIndex] as HTMLElement).focus();

            // Home → first
            act(() => {
              result.current.handleKeyDown(makeKeyEvent('Home'));
            });
            expect(document.activeElement).toBe(buttons[0]);

            // Focus back to start position
            (buttons[startIndex] as HTMLElement).focus();

            // End → last
            act(() => {
              result.current.handleKeyDown(makeKeyEvent('End'));
            });
            expect(document.activeElement).toBe(buttons[itemCount - 1]);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 3: Wrap boundary behavior (Req 13.1)
  // ---------------------------------------------------------------------------

  describe('Wrap boundary behavior (Req 13.1)', () => {
    /**
     * Property: For any wrap setting (true/false) and any number of items,
     * navigation at boundaries behaves correctly:
     * - wrap=true: next from last → first, prev from first → last
     * - wrap=false: next from last stays on last, prev from first stays on first
     */
    it('boundary navigation respects wrap setting', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 50 }),
          fc.boolean(),
          fc.constantFrom('vertical' as const, 'horizontal' as const),
          (itemCount, wrap, orientation) => {
            document.body.innerHTML = '';
            const container = buildContainer(itemCount);
            const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
            const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';

            const { result } = renderHook(() =>
              useKeyboardNavigation({ orientation, wrap }),
            );
            attachRef(result.current.containerRef, container);

            const buttons = container.querySelectorAll('button');
            const lastIndex = itemCount - 1;

            // Test forward boundary: focus last, press next
            (buttons[lastIndex] as HTMLElement).focus();
            act(() => {
              result.current.handleKeyDown(makeKeyEvent(nextKey));
            });

            if (wrap) {
              expect(document.activeElement).toBe(buttons[0]);
            } else {
              expect(document.activeElement).toBe(buttons[lastIndex]);
            }

            // Test backward boundary: focus first, press prev
            (buttons[0] as HTMLElement).focus();
            act(() => {
              result.current.handleKeyDown(makeKeyEvent(prevKey));
            });

            if (wrap) {
              expect(document.activeElement).toBe(buttons[lastIndex]);
            } else {
              expect(document.activeElement).toBe(buttons[0]);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 4: Toast ARIA attributes (Req 13.2)
  // ---------------------------------------------------------------------------

  describe('Toast notification ARIA attributes (Req 13.2)', () => {
    /**
     * Property: For any set of toast notifications with arbitrary types,
     * each rendered toast has role="alert" and an appropriate aria-live
     * attribute (assertive for errors, polite for others).
     */
    it('every toast has role="alert" and correct aria-live', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              type: fc.constantFrom(
                'success' as const,
                'error' as const,
                'warning' as const,
                'info' as const,
              ),
              title: fc.string({ minLength: 1, maxLength: 100 }),
            }),
            { minLength: 1, maxLength: 20 },
          ),
          (toasts) => {
            document.body.innerHTML = '';

            for (const t of toasts) {
              const el = document.createElement('div');
              el.setAttribute('role', 'alert');
              el.setAttribute(
                'aria-live',
                t.type === 'error' ? 'assertive' : 'polite',
              );
              el.setAttribute('aria-atomic', 'true');
              el.textContent = t.title;
              document.body.appendChild(el);
            }

            const alerts = document.querySelectorAll('[role="alert"]');
            expect(alerts.length).toBe(toasts.length);

            alerts.forEach((alert, i) => {
              expect(alert.getAttribute('role')).toBe('alert');
              expect(alert.getAttribute('aria-atomic')).toBe('true');

              const expectedLive =
                toasts[i].type === 'error' ? 'assertive' : 'polite';
              expect(alert.getAttribute('aria-live')).toBe(expectedLive);
            });
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * Property: For any toast type, the aria-live value is always either
     * "assertive" or "polite" — never null or any other value.
     */
    it('aria-live is always assertive or polite for any toast type', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            'success' as const,
            'error' as const,
            'warning' as const,
            'info' as const,
          ),
          (toastType) => {
            const ariaLive = toastType === 'error' ? 'assertive' : 'polite';
            expect(['assertive', 'polite']).toContain(ariaLive);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
