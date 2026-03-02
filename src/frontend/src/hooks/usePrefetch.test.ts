import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

const mockPrefetch = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch: mockPrefetch }),
}));

// Import after mock so the module picks up the mock.
// eslint-disable-next-line import/first
import { usePrefetch } from './usePrefetch';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePrefetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockPrefetch.mockClear();

    // Default: online, no data-saver
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    Object.defineProperty(navigator, 'connection', {
      value: { saveData: false },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prefetches paths after the default delay', () => {
    const paths = ['/dashboard', '/transactions'];
    renderHook(() => usePrefetch(paths));

    // Nothing prefetched yet
    expect(mockPrefetch).not.toHaveBeenCalled();

    // Advance past the 2 s default delay
    vi.advanceTimersByTime(2_000);

    expect(mockPrefetch).toHaveBeenCalledTimes(2);
    expect(mockPrefetch).toHaveBeenCalledWith('/dashboard');
    expect(mockPrefetch).toHaveBeenCalledWith('/transactions');
  });

  it('respects a custom delay', () => {
    renderHook(() => usePrefetch(['/settings'], 500));

    vi.advanceTimersByTime(499);
    expect(mockPrefetch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(mockPrefetch).toHaveBeenCalledWith('/settings');
  });

  it('skips prefetching when the browser is offline', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    renderHook(() => usePrefetch(['/dashboard']));
    vi.advanceTimersByTime(2_000);

    expect(mockPrefetch).not.toHaveBeenCalled();
  });

  it('skips prefetching when data-saver mode is active', () => {
    Object.defineProperty(navigator, 'connection', {
      value: { saveData: true },
      configurable: true,
    });

    renderHook(() => usePrefetch(['/dashboard']));
    vi.advanceTimersByTime(2_000);

    expect(mockPrefetch).not.toHaveBeenCalled();
  });

  it('handles missing navigator.connection gracefully', () => {
    Object.defineProperty(navigator, 'connection', {
      value: undefined,
      configurable: true,
    });

    renderHook(() => usePrefetch(['/insights']));
    vi.advanceTimersByTime(2_000);

    expect(mockPrefetch).toHaveBeenCalledWith('/insights');
  });

  it('clears the timer on unmount', () => {
    const { unmount } = renderHook(() => usePrefetch(['/dashboard']));

    unmount();
    vi.advanceTimersByTime(2_000);

    expect(mockPrefetch).not.toHaveBeenCalled();
  });

  it('does nothing for an empty paths array', () => {
    renderHook(() => usePrefetch([]));
    vi.advanceTimersByTime(2_000);

    expect(mockPrefetch).not.toHaveBeenCalled();
  });
});
