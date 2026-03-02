/**
 * Property-Based Tests for ThemeProvider
 *
 * **Property 4: Theme Persistence**
 * **Validates: Requirements 12.3**
 *
 * For any theme preference change, it SHALL be persisted to localStorage
 * and applied on subsequent visits.
 */
import { act, renderHook } from '@testing-library/react';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider, useTheme } from './ThemeProvider';
import type { Theme } from './ThemeProvider';

const STORAGE_KEY = 'cashtrace-theme';

/** Arbitrary that generates valid theme values. */
const themeArb = fc.constantFrom<Theme>('light', 'dark', 'system');

// Mock localStorage with a real backing store
function createLocalStorageMock(): Storage & { store: Record<string, string> } {
  const store: Record<string, string> = {};
  return {
    store,
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      for (const key of Object.keys(store)) {
        delete store[key];
      }
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
}

function createMatchMediaMock(prefersDark: boolean): (query: string) => MediaQueryList {
  return (query: string): MediaQueryList => ({
    matches: query === '(prefers-color-scheme: dark)' ? prefersDark : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
}

describe('ThemeProvider Property Tests', () => {
  let storageMock: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    storageMock = createLocalStorageMock();
    Object.defineProperty(window, 'localStorage', { value: storageMock, writable: true });
    document.documentElement.classList.remove('dark');
    vi.stubGlobal('matchMedia', createMatchMediaMock(false));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Property 4.1: Any theme set via setTheme is persisted to localStorage.
   * **Validates: Requirements 12.3**
   */
  it('persists any theme preference to localStorage', () => {
    fc.assert(
      fc.property(themeArb, (theme) => {
        // Reset state between iterations
        storageMock.clear();
        document.documentElement.classList.remove('dark');

        const { result, unmount } = renderHook(() => useTheme(), {
          wrapper: ThemeProvider,
        });

        act(() => {
          result.current.setTheme(theme);
        });

        expect(storageMock.store[STORAGE_KEY]).toBe(theme);

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 4.2: When ThemeProvider remounts, it reads the persisted value.
   * **Validates: Requirements 12.3**
   */
  it('restores persisted theme on remount', () => {
    fc.assert(
      fc.property(themeArb, (theme) => {
        // Reset state between iterations
        storageMock.clear();
        document.documentElement.classList.remove('dark');

        // First mount: set the theme
        const first = renderHook(() => useTheme(), { wrapper: ThemeProvider });
        act(() => {
          first.result.current.setTheme(theme);
        });
        first.unmount();

        // Second mount: should read persisted value
        const second = renderHook(() => useTheme(), { wrapper: ThemeProvider });
        expect(second.result.current.theme).toBe(theme);
        second.unmount();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 4.3: The resolved theme correctly maps to DOM state.
   * For 'light' → no dark class, for 'dark' → dark class present,
   * for 'system' → depends on OS preference (mocked as light here).
   * **Validates: Requirements 12.3**
   */
  it('applies correct DOM class based on resolved theme', () => {
    fc.assert(
      fc.property(themeArb, fc.boolean(), (theme, systemPrefersDark) => {
        // Reset state between iterations
        storageMock.clear();
        document.documentElement.classList.remove('dark');
        vi.stubGlobal('matchMedia', createMatchMediaMock(systemPrefersDark));

        const { result, unmount } = renderHook(() => useTheme(), {
          wrapper: ThemeProvider,
        });

        act(() => {
          result.current.setTheme(theme);
        });

        const hasDarkClass = document.documentElement.classList.contains('dark');

        if (theme === 'dark') {
          expect(hasDarkClass).toBe(true);
          expect(result.current.resolvedTheme).toBe('dark');
        } else if (theme === 'light') {
          expect(hasDarkClass).toBe(false);
          expect(result.current.resolvedTheme).toBe('light');
        } else {
          // system: resolved based on OS preference
          expect(hasDarkClass).toBe(systemPrefersDark);
          expect(result.current.resolvedTheme).toBe(systemPrefersDark ? 'dark' : 'light');
        }

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 4.4: Sequential theme changes always persist the last value.
   * **Validates: Requirements 12.3**
   */
  it('persists the last theme after a sequence of changes', () => {
    fc.assert(
      fc.property(fc.array(themeArb, { minLength: 1, maxLength: 10 }), (themes) => {
        // Reset state between iterations
        storageMock.clear();
        document.documentElement.classList.remove('dark');

        const { result, unmount } = renderHook(() => useTheme(), {
          wrapper: ThemeProvider,
        });

        for (const theme of themes) {
          act(() => {
            result.current.setTheme(theme);
          });
        }

        const lastTheme = themes[themes.length - 1]!;
        expect(storageMock.store[STORAGE_KEY]).toBe(lastTheme);
        expect(result.current.theme).toBe(lastTheme);

        unmount();
      }),
      { numRuns: 100 },
    );
  });
});
