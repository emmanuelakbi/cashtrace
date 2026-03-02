'use client';

import { useCallback, useEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseKeyboardNavigationOptions {
  /** CSS selector for focusable items within the container. */
  itemSelector?: string;
  /** Orientation of the list — determines which arrow keys navigate. */
  orientation?: 'vertical' | 'horizontal';
  /** Whether navigation wraps from last to first and vice-versa. */
  wrap?: boolean;
  /** Callback fired when Escape is pressed. */
  onEscape?: () => void;
}

export interface UseKeyboardNavigationResult {
  /** Ref to attach to the container element. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Key-down handler to attach to the container. */
  handleKeyDown: (event: React.KeyboardEvent) => void;
}

export interface UseFocusTrapOptions {
  /** Whether the trap is currently active. */
  active: boolean;
  /** External ref to use instead of creating a new one. */
  containerRef?: React.RefObject<HTMLElement | null>;
  /** CSS selector for focusable elements inside the trap. */
  focusableSelector?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFocusableItems(
  container: HTMLElement | null,
  selector: string,
): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(selector));
}

function focusItem(items: HTMLElement[], index: number): void {
  const target = items[index];
  if (target) {
    target.focus();
  }
}

// ---------------------------------------------------------------------------
// Hook: useKeyboardNavigation
// ---------------------------------------------------------------------------

/**
 * Provides keyboard navigation utilities for lists, menus, and modals.
 *
 * Supports:
 * - Arrow key navigation (up/down or left/right based on orientation)
 * - Home / End to jump to first / last item
 * - Escape key callback (e.g. close modal / menu)
 *
 * Requirement: 13.1
 */
export function useKeyboardNavigation(
  options: UseKeyboardNavigationOptions = {},
): UseKeyboardNavigationResult {
  const {
    itemSelector = 'a, button, [tabindex="0"]',
    orientation = 'vertical',
    wrap = true,
    onEscape,
  } = options;

  const containerRef = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      const container = containerRef.current;
      if (!container) return;

      const items = getFocusableItems(container, itemSelector);
      if (items.length === 0) return;

      const activeElement = document.activeElement as HTMLElement | null;
      const currentIndex = activeElement ? items.indexOf(activeElement) : -1;

      const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
      const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';

      switch (event.key) {
        case nextKey: {
          event.preventDefault();
          if (currentIndex < items.length - 1) {
            focusItem(items, currentIndex + 1);
          } else if (wrap) {
            focusItem(items, 0);
          }
          break;
        }

        case prevKey: {
          event.preventDefault();
          if (currentIndex > 0) {
            focusItem(items, currentIndex - 1);
          } else if (wrap) {
            focusItem(items, items.length - 1);
          }
          break;
        }

        case 'Home': {
          event.preventDefault();
          focusItem(items, 0);
          break;
        }

        case 'End': {
          event.preventDefault();
          focusItem(items, items.length - 1);
          break;
        }

        case 'Escape': {
          event.preventDefault();
          onEscape?.();
          break;
        }

        default:
          break;
      }
    },
    [itemSelector, orientation, wrap, onEscape],
  );

  return { containerRef, handleKeyDown };
}

// ---------------------------------------------------------------------------
// Hook: useFocusTrap
// ---------------------------------------------------------------------------

/**
 * Traps Tab focus within a container while active.
 * Useful for modals and drawers.
 *
 * Accepts an optional external `containerRef` so the same ref can be shared
 * with `useKeyboardNavigation` without needing to merge refs.
 *
 * Requirement: 13.1
 */
export function useFocusTrap(options: UseFocusTrapOptions): React.RefObject<HTMLElement | null> {
  const {
    active,
    focusableSelector = 'a, button, input, select, textarea, [tabindex="0"]',
  } = options;
  const internalRef = useRef<HTMLElement | null>(null);
  const trapRef = options.containerRef ?? internalRef;

  useEffect(() => {
    if (!active) return;

    const container = trapRef.current;
    if (!container) return;

    const handleTrapKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;

      const focusable = getFocusableItems(container, focusableSelector);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleTrapKeyDown);

    // Focus the first focusable element on activation
    const focusable = getFocusableItems(container, focusableSelector);
    if (focusable.length > 0) {
      focusable[0].focus();
    }

    return () => {
      document.removeEventListener('keydown', handleTrapKeyDown);
    };
  }, [active, focusableSelector, trapRef]);

  return trapRef;
}
