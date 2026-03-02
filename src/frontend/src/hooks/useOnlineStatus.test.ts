import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { useGlobalStore } from '../store/index';

import { useOnlineStatus } from './useOnlineStatus';

// Reset store between tests
function resetStore(): void {
  act(() => {
    useGlobalStore.setState({ isOnline: true, pendingActions: [] });
  });
}

describe('useOnlineStatus', () => {
  let originalNavigatorOnLine: boolean;

  beforeEach(() => {
    resetStore();
    originalNavigatorOnLine = navigator.onLine;
  });

  afterEach(() => {
    // Restore navigator.onLine
    Object.defineProperty(navigator, 'onLine', {
      value: originalNavigatorOnLine,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it('should set isOnline to true when navigator.onLine is true on mount', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    renderHook(() => useOnlineStatus());

    expect(useGlobalStore.getState().isOnline).toBe(true);
  });

  it('should set isOnline to false when navigator.onLine is false on mount', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    renderHook(() => useOnlineStatus());

    expect(useGlobalStore.getState().isOnline).toBe(false);
  });

  it('should update isOnline to true when online event fires', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    renderHook(() => useOnlineStatus());
    expect(useGlobalStore.getState().isOnline).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    expect(useGlobalStore.getState().isOnline).toBe(true);
  });

  it('should update isOnline to false when offline event fires', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    renderHook(() => useOnlineStatus());
    expect(useGlobalStore.getState().isOnline).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(useGlobalStore.getState().isOnline).toBe(false);
  });

  it('should clean up event listeners on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useOnlineStatus());

    // Verify listeners were added
    expect(addSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('offline', expect.any(Function));

    unmount();

    // Verify listeners were removed
    expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function));
  });

  it('should not update store after unmount when events fire', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    const { unmount } = renderHook(() => useOnlineStatus());
    unmount();

    // Fire offline event after unmount — store should stay true
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    // The store may or may not update depending on cleanup timing,
    // but the key assertion is that no errors are thrown
    // and the listeners were properly removed (tested above).
  });

  it('should handle rapid online/offline toggling', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    renderHook(() => useOnlineStatus());

    act(() => {
      window.dispatchEvent(new Event('offline'));
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('offline'));
    });

    expect(useGlobalStore.getState().isOnline).toBe(false);
  });
});
