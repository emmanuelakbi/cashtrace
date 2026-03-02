import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalStore } from '../store';

import { AuthProvider, useAuth } from './AuthProvider';

// Mock env config
vi.mock('../config/env', () => ({
  env: {
    apiBaseUrl: 'http://localhost:3000',
    appEnv: 'development',
    appUrl: 'http://localhost:3001',
    features: { pwa: false, offline: false, darkMode: true },
    isDevelopment: true,
    isStaging: false,
    isProduction: false,
  },
}));

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  businessId: 'biz-1',
  businessName: 'Test Business',
};

function mockFetchSuccess(data: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    }),
  );
}

function mockFetchFailure(status = 401, body?: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve(body ?? { error: { message: 'Unauthorized' } }),
    }),
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset Zustand store
    useGlobalStore.setState({
      user: null,
      activeBusiness: null,
      unreadCount: 0,
      pendingActions: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial auth check', () => {
    it('sets user when /api/auth/me succeeds', async () => {
      mockFetchSuccess({ success: true, user: mockUser });

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.user).toEqual(mockUser);
      expect(result.current.isAuthenticated).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/auth/me',
        expect.objectContaining({ credentials: 'include' }),
      );
    });

    it('sets user to null when /api/auth/me fails', async () => {
      mockFetchFailure(401);

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
    });

    it('syncs user to Zustand store on successful auth check', async () => {
      mockFetchSuccess({ success: true, user: mockUser });

      renderHook(() => useAuth(), { wrapper: AuthProvider });

      await waitFor(() => {
        expect(useGlobalStore.getState().user).toEqual(mockUser);
      });
    });
  });

  describe('login', () => {
    it('calls /api/auth/login and sets user on success', async () => {
      // First call: /me fails (not logged in), second call: /login succeeds
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: { message: 'Unauthorized' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, user: mockUser }),
        });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.login({ email: 'test@example.com', password: 'password123' });
      });

      expect(result.current.user).toEqual(mockUser);
      expect(result.current.isAuthenticated).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/api/auth/login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
        }),
      );
    });

    it('throws on login failure with server error message', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: { message: 'Unauthorized' } }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: { message: 'Invalid credentials' } }),
        });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.login({ email: 'bad@example.com', password: 'wrong' });
        }),
      ).rejects.toThrow('Invalid credentials');

      expect(result.current.user).toBeNull();
    });
  });

  describe('logout', () => {
    it('calls /api/auth/logout and clears user state', async () => {
      // /me succeeds, then /logout succeeds
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, user: mockUser }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(useGlobalStore.getState().user).toBeNull();
    });

    it('clears user even if logout API call fails', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, user: mockUser }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: { message: 'Server error' } }),
        });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      await act(async () => {
        await result.current.logout();
      });

      // User should still be cleared even though API failed
      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  describe('refreshToken', () => {
    it('calls /api/auth/refresh and updates user', async () => {
      const updatedUser = { ...mockUser, email: 'updated@example.com' };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, user: mockUser }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, user: updatedUser }),
        });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      await act(async () => {
        await result.current.refreshToken();
      });

      expect(result.current.user).toEqual(updatedUser);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/api/auth/refresh',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('automatic token refresh', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('sets tokenExpiresAt after successful auth check', async () => {
      const expiresAt = Date.now() + 15 * 60 * 1000;
      mockFetchSuccess({ success: true, user: mockUser, expiresAt });

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.tokenExpiresAt).toBe(expiresAt);
    });

    it('auto-refreshes token at 80% of expiry time', async () => {
      const TOKEN_LIFETIME = 10_000;
      const expiresAt = Date.now() + TOKEN_LIFETIME;

      const refreshedUser = { ...mockUser, email: 'refreshed@example.com' };
      const newExpiresAt = expiresAt + TOKEN_LIFETIME;

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, user: mockUser, expiresAt }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ success: true, user: refreshedUser, expiresAt: newExpiresAt }),
        });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      // Advance past the 80% threshold
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TOKEN_LIFETIME * 0.8 + 100);
      });

      await waitFor(() => {
        expect(result.current.user?.email).toBe('refreshed@example.com');
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenLastCalledWith(
        'http://localhost:3000/api/auth/refresh',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('logs out user when refresh fails', async () => {
      const TOKEN_LIFETIME = 10_000;
      const expiresAt = Date.now() + TOKEN_LIFETIME;

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, user: mockUser, expiresAt }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: { message: 'Token expired' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(TOKEN_LIFETIME * 0.8 + 100);
      });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(false);
      });

      expect(result.current.user).toBeNull();
    });

    it('does not schedule refresh when user is not authenticated', async () => {
      mockFetchFailure(401);

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.tokenExpiresAt).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('clears refresh timer on logout', async () => {
      const TOKEN_LIFETIME = 10_000;
      const expiresAt = Date.now() + TOKEN_LIFETIME;

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, user: mockUser, expiresAt }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.tokenExpiresAt).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(TOKEN_LIFETIME);
      });

      // Only /me and /logout were called, no /refresh
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('uses default lifetime when API does not provide expiresAt', async () => {
      mockFetchSuccess({ success: true, user: mockUser });

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      // tokenExpiresAt should be set to approximately now + 15 min
      const now = Date.now();
      expect(result.current.tokenExpiresAt).not.toBeNull();
      expect(result.current.tokenExpiresAt!).toBeGreaterThanOrEqual(now);
      expect(result.current.tokenExpiresAt!).toBeLessThanOrEqual(now + 16 * 60 * 1000);
    });

    it('resets refresh timer after successful login', async () => {
      const TOKEN_LIFETIME = 10_000;
      const loginExpiresAt = Date.now() + TOKEN_LIFETIME;

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: { message: 'Unauthorized' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ success: true, user: mockUser, expiresAt: loginExpiresAt }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              user: mockUser,
              expiresAt: loginExpiresAt + TOKEN_LIFETIME,
            }),
        });
      vi.stubGlobal('fetch', fetchMock);

      const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.login({ email: 'test@example.com', password: 'pass' });
      });

      expect(result.current.tokenExpiresAt).toBe(loginExpiresAt);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(TOKEN_LIFETIME * 0.8 + 100);
      });

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(3);
      });
    });
  });

  describe('useAuth hook', () => {
    it('throws when used outside AuthProvider', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useAuth());
      }).toThrow('useAuth must be used within an AuthProvider');

      spy.mockRestore();
    });
  });

  describe('UI integration', () => {
    it('renders children and exposes auth state', async () => {
      mockFetchSuccess({ success: true, user: mockUser });

      function AuthStatus(): React.JSX.Element {
        const { user, isAuthenticated, isLoading } = useAuth();
        if (isLoading) return <div data-testid="status">loading</div>;
        if (isAuthenticated) return <div data-testid="status">{user?.email}</div>;
        return <div data-testid="status">not authenticated</div>;
      }

      render(
        <AuthProvider>
          <AuthStatus />
        </AuthProvider>,
      );

      expect(screen.getByTestId('status')).toHaveTextContent('loading');

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('test@example.com');
      });
    });

    it('allows login via button click', async () => {
      const user = userEvent.setup();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: { message: 'Unauthorized' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, user: mockUser }),
        });
      vi.stubGlobal('fetch', fetchMock);

      function LoginButton(): React.JSX.Element {
        const { isAuthenticated, login, isLoading } = useAuth();
        if (isLoading) return <div data-testid="status">loading</div>;
        if (isAuthenticated) return <div data-testid="status">logged in</div>;
        return (
          <button
            onClick={() => {
              void login({ email: 'test@example.com', password: 'pass' });
            }}
          >
            Login
          </button>
        );
      }

      render(
        <AuthProvider>
          <LoginButton />
        </AuthProvider>,
      );

      await waitFor(() => {
        expect(screen.getByText('Login')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Login'));

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('logged in');
      });
    });
  });
});
