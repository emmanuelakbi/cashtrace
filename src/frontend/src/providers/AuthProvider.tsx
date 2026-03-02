'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { env } from '../config/env';
import { useGlobalStore } from '../store';
import type { User } from '../store';

export interface LoginCredentials {
  email: string;
  password: string;
}

/** Default token lifetime in ms (15 minutes). */
const DEFAULT_TOKEN_LIFETIME_MS = 15 * 60 * 1000;

/** Fraction of token lifetime at which we trigger a refresh (80%). */
const REFRESH_THRESHOLD = 0.8;

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  tokenExpiresAt: number | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${env.apiBaseUrl}${path}`;
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string; code?: string };
    } | null;
    const message = body?.error?.message ?? `Request failed with status ${res.status}`;
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

interface MeResponse {
  success: boolean;
  user: User;
  expiresAt?: number;
}

interface LoginResponse {
  success: boolean;
  user: User;
  expiresAt?: number;
}

/**
 * Compute the timestamp (ms since epoch) at which the token expires.
 * If the API provides `expiresAt`, use it; otherwise fall back to
 * `now + DEFAULT_TOKEN_LIFETIME_MS`.
 */
function computeExpiresAt(apiExpiresAt?: number): number {
  if (apiExpiresAt && apiExpiresAt > Date.now()) {
    return apiExpiresAt;
  }
  return Date.now() + DEFAULT_TOKEN_LIFETIME_MS;
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [user, setUserState] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number | null>(null);
  const mountedRef = useRef(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setStoreUser = useGlobalStore((s) => s.setUser);
  const clearSensitiveState = useGlobalStore((s) => s.clearSensitiveState);

  // Clear any pending refresh timer
  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  // Sync local + store user
  const setUser = useCallback(
    (u: User | null) => {
      setUserState(u);
      setStoreUser(u);
    },
    [setStoreUser],
  );

  const logout = useCallback(async (): Promise<void> => {
    clearRefreshTimer();
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Swallow logout API errors — we still clear local state
    } finally {
      setUser(null);
      setTokenExpiresAt(null);
      clearSensitiveState();
    }
  }, [setUser, clearSensitiveState, clearRefreshTimer]);

  const refreshToken = useCallback(async (): Promise<void> => {
    const data = await apiFetch<MeResponse>('/api/auth/refresh', { method: 'POST' });
    setUser(data.user);
    setTokenExpiresAt(computeExpiresAt(data.expiresAt));
  }, [setUser]);

  // Schedule the next automatic refresh
  const scheduleRefresh = useCallback(
    (expiresAt: number) => {
      clearRefreshTimer();

      const now = Date.now();
      const timeUntilExpiry = expiresAt - now;

      if (timeUntilExpiry <= 0) {
        // Token already expired — log out
        void logout();
        return;
      }

      const delay = Math.max(timeUntilExpiry * REFRESH_THRESHOLD, 0);

      refreshTimerRef.current = setTimeout(() => {
        void (async () => {
          try {
            await refreshToken();
          } catch {
            // Refresh failed — force logout
            if (mountedRef.current) {
              void logout();
            }
          }
        })();
      }, delay);
    },
    [clearRefreshTimer, refreshToken, logout],
  );

  // Whenever tokenExpiresAt changes and user is authenticated, schedule refresh
  useEffect(() => {
    if (user && tokenExpiresAt) {
      scheduleRefresh(tokenExpiresAt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenExpiresAt]);

  // Check auth on mount
  useEffect(() => {
    mountedRef.current = true;

    const checkAuth = async (): Promise<void> => {
      try {
        const data = await apiFetch<MeResponse>('/api/auth/me');
        if (mountedRef.current) {
          setUser(data.user);
          setTokenExpiresAt(computeExpiresAt(data.expiresAt));
        }
      } catch {
        if (mountedRef.current) {
          setUser(null);
          setTokenExpiresAt(null);
        }
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
        }
      }
    };

    void checkAuth();

    return () => {
      mountedRef.current = false;
      clearRefreshTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setUser]);

  const login = useCallback(
    async (credentials: LoginCredentials): Promise<void> => {
      const data = await apiFetch<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });
      setUser(data.user);
      setTokenExpiresAt(computeExpiresAt(data.expiresAt));
    },
    [setUser],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      tokenExpiresAt,
      login,
      logout,
      refreshToken,
    }),
    [user, isLoading, tokenExpiresAt, login, logout, refreshToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
