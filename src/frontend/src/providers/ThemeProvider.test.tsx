import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ThemeProvider, useTheme } from './ThemeProvider';

const STORAGE_KEY = 'cashtrace-theme';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
})();

// Helper to create a controllable matchMedia mock
function createMatchMediaMock(prefersDark: boolean): {
  mock: (query: string) => MediaQueryList;
  listeners: Array<(e: MediaQueryListEvent) => void>;
  setPrefersDark: (dark: boolean) => void;
} {
  let currentPrefersDark = prefersDark;
  const listeners: Array<(e: MediaQueryListEvent) => void> = [];

  const mock = (query: string): MediaQueryList => ({
    matches: query === '(prefers-color-scheme: dark)' ? currentPrefersDark : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: (_event: string, handler: EventListenerOrEventListenerObject) => {
      listeners.push(handler as (e: MediaQueryListEvent) => void);
    },
    removeEventListener: (_event: string, handler: EventListenerOrEventListenerObject) => {
      const idx = listeners.indexOf(handler as (e: MediaQueryListEvent) => void);
      if (idx >= 0) listeners.splice(idx, 1);
    },
    dispatchEvent: vi.fn(),
  });

  const setPrefersDark = (dark: boolean): void => {
    currentPrefersDark = dark;
  };

  return { mock, listeners, setPrefersDark };
}

describe('ThemeProvider', () => {
  let matchMediaHelper: ReturnType<typeof createMatchMediaMock>;

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });
    document.documentElement.classList.remove('dark');
    matchMediaHelper = createMatchMediaMock(false);
    vi.stubGlobal('matchMedia', matchMediaHelper.mock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to system theme when no localStorage value', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    });

    expect(result.current.theme).toBe('system');
    expect(result.current.resolvedTheme).toBe('light');
  });

  it('reads saved theme from localStorage on mount', () => {
    localStorageMock.setItem(STORAGE_KEY, 'dark');

    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    });

    expect(result.current.theme).toBe('dark');
    expect(result.current.resolvedTheme).toBe('dark');
  });

  it('persists theme preference to localStorage when changed', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    });

    act(() => {
      result.current.setTheme('dark');
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'dark');
  });

  it('adds dark class to html element when dark theme is set', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    });

    act(() => {
      result.current.setTheme('dark');
    });

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes dark class from html element when light theme is set', () => {
    document.documentElement.classList.add('dark');

    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    });

    act(() => {
      result.current.setTheme('light');
    });

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('resolves system theme to dark when OS prefers dark', () => {
    matchMediaHelper = createMatchMediaMock(true);
    vi.stubGlobal('matchMedia', matchMediaHelper.mock);

    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    });

    expect(result.current.theme).toBe('system');
    expect(result.current.resolvedTheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('responds to OS theme changes when in system mode', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    });

    expect(result.current.resolvedTheme).toBe('light');

    // Simulate OS switching to dark mode
    act(() => {
      matchMediaHelper.setPrefersDark(true);
      for (const listener of matchMediaHelper.listeners) {
        listener({ matches: true } as MediaQueryListEvent);
      }
    });

    expect(result.current.resolvedTheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('ignores OS theme changes when not in system mode', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    });

    act(() => {
      result.current.setTheme('light');
    });

    // Simulate OS switching to dark mode
    act(() => {
      matchMediaHelper.setPrefersDark(true);
      for (const listener of matchMediaHelper.listeners) {
        listener({ matches: true } as MediaQueryListEvent);
      }
    });

    expect(result.current.resolvedTheme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('ignores invalid localStorage values and defaults to system', () => {
    localStorageMock.setItem(STORAGE_KEY, 'invalid-value');

    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    });

    expect(result.current.theme).toBe('system');
  });

  it('throws when useTheme is used outside ThemeProvider', () => {
    // Suppress React error boundary console output
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useTheme());
    }).toThrow('useTheme must be used within a ThemeProvider');

    spy.mockRestore();
  });

  it('allows child components to toggle theme via a button', async () => {
    const user = userEvent.setup();

    function ThemeToggle(): React.JSX.Element {
      const { theme, setTheme, resolvedTheme } = useTheme();
      return (
        <div>
          <span data-testid="theme">{theme}</span>
          <span data-testid="resolved">{resolvedTheme}</span>
          <button onClick={() => setTheme('dark')}>Dark</button>
          <button onClick={() => setTheme('light')}>Light</button>
        </div>
      );
    }

    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('system');

    await user.click(screen.getByText('Dark'));
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');

    await user.click(screen.getByText('Light'));
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
  });
});
