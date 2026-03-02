import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

let mockPathname = '/dashboard';

vi.mock('next/navigation', () => ({
  usePathname: (): string => mockPathname,
}));

// Import after mock so the module picks up the mock.
// eslint-disable-next-line import/first
import { useFocusOnRouteChange } from './useFocusOnRouteChange';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMainContent(id = 'main-content'): HTMLElement {
  const el = document.createElement('main');
  el.id = id;
  document.body.appendChild(el);
  return el;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFocusOnRouteChange', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockPathname = '/dashboard';
  });

  it('does not focus on initial mount', () => {
    const main = createMainContent();
    const focusSpy = vi.spyOn(main, 'focus');

    renderHook(() => useFocusOnRouteChange());

    expect(focusSpy).not.toHaveBeenCalled();
  });

  it('focuses main content after a route change', () => {
    const main = createMainContent();
    const focusSpy = vi.spyOn(main, 'focus');

    const { rerender } = renderHook(() => useFocusOnRouteChange());

    // Simulate navigation
    mockPathname = '/transactions';
    rerender();

    expect(focusSpy).toHaveBeenCalledOnce();
  });

  it('sets tabindex=-1 on the target if not already present', () => {
    const main = createMainContent();

    const { rerender } = renderHook(() => useFocusOnRouteChange());

    mockPathname = '/settings';
    rerender();

    expect(main.getAttribute('tabindex')).toBe('-1');
  });

  it('does not overwrite an existing tabindex', () => {
    const main = createMainContent();
    main.setAttribute('tabindex', '0');

    const { rerender } = renderHook(() => useFocusOnRouteChange());

    mockPathname = '/insights';
    rerender();

    expect(main.getAttribute('tabindex')).toBe('0');
  });

  it('supports a custom target id', () => {
    const custom = document.createElement('div');
    custom.id = 'custom-target';
    document.body.appendChild(custom);
    const focusSpy = vi.spyOn(custom, 'focus');

    const { rerender } = renderHook(() => useFocusOnRouteChange('custom-target'));

    mockPathname = '/documents';
    rerender();

    expect(focusSpy).toHaveBeenCalledOnce();
  });

  it('does nothing when the target element does not exist', () => {
    // No element in the DOM — should not throw.
    const { rerender } = renderHook(() => useFocusOnRouteChange());

    mockPathname = '/transactions';
    expect(() => rerender()).not.toThrow();
  });
});
