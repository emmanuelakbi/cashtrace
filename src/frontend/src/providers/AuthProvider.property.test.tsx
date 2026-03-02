/**
 * Property-Based Tests for AuthProvider — Token Refresh Timing
 *
 * **Property 2: Token Refresh Timing**
 * **Validates: Requirements 2.4**
 *
 * For any authenticated session, token refresh SHALL occur before expiration
 * to prevent session interruption.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import fc from 'fast-check';
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
  email: 'test@cashtrace.ng',
  businessId: 'biz-1',
  businessName: 'Lagos Supplies Ltd',
};

/** REFRESH_THRESHOLD mirrors the constant in AuthProvider. */
const REFRESH_THRESHOLD = 0.8;

/**
 * Arbitrary for token lifetimes in milliseconds.
 * Range: 10 s to 30 min — covers short-lived dev tokens through
 * typical production tokens.
 */
const tokenLifetimeArb = fc.integer({ min: 10_000, max: 30 * 60 * 1000 });

/** Build a fetch mock that tracks refresh calls. */
function buildFetchMock(
  expiresAt: number,
  nextLifetime: number,
  refreshCalls: { calledAt: number }[],
): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((url: string) => {
    if (url.endsWith('/api/auth/me')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, user: mockUser, expiresAt }),
      });
    }
    if (url.endsWith('/api/auth/refresh')) {
      refreshCalls.push({ calledAt: Date.now() });
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            user: mockUser,
            expiresAt: Date.now() + nextLifetime,
          }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
  });
}

/** Reset state between fast-check iterations. */
function resetState(): void {
  cleanup();
  vi.clearAllMocks();
  useGlobalStore.setState({
    user: null,
    activeBusiness: null,
    unreadCount: 0,
    pendingActions: [],
  });
}

describe('AuthProvider Property Tests — Token Refresh Timing', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resetState();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * Property 2.1: For any token lifetime, refresh is scheduled at 80% of
   * the lifetime — strictly before expiration.
   *
   * **Validates: Requirements 2.4**
   */
  it(
    'schedules refresh before token expiration for any token lifetime',
    async () => {
      await fc.assert(
        fc.asyncProperty(tokenLifetimeArb, async (lifetime) => {
          resetState();

          const expiresAt = Date.now() + lifetime;
          const refreshDelay = lifetime * REFRESH_THRESHOLD;
          const refreshCalls: { calledAt: number }[] = [];

          vi.stubGlobal('fetch', buildFetchMock(expiresAt, lifetime, refreshCalls));

          const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });

          // Wait for /me to resolve and auth state to settle
          await waitFor(() => {
            expect(hook.result.current.isAuthenticated).toBe(true);
          });

          // Advance past the 80% refresh threshold
          await act(async () => {
            await vi.advanceTimersByTimeAsync(refreshDelay + 100);
          });

          // Refresh must have been called
          expect(refreshCalls.length).toBeGreaterThanOrEqual(1);
          // It must have been called before the token expired
          expect(refreshCalls[0]!.calledAt).toBeLessThan(expiresAt);
          // 80% of any positive lifetime is strictly less than 100%
          expect(refreshDelay).toBeLessThan(lifetime);

          hook.unmount();
        }),
        { numRuns: 100 },
      );
    },
    120_000,
  );

  /**
   * Property 2.2: After a successful refresh, a new timer is scheduled
   * for the new token's lifetime.
   *
   * **Validates: Requirements 2.4**
   */
  it(
    'schedules a new refresh timer after successful token refresh',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          tokenLifetimeArb,
          tokenLifetimeArb,
          async (firstLifetime, secondLifetime) => {
            resetState();

            const firstExpiresAt = Date.now() + firstLifetime;
            let refreshCallCount = 0;

            const fetchMock = vi.fn().mockImplementation((url: string) => {
              if (url.endsWith('/api/auth/me')) {
                return Promise.resolve({
                  ok: true,
                  json: () =>
                    Promise.resolve({
                      success: true,
                      user: mockUser,
                      expiresAt: firstExpiresAt,
                    }),
                });
              }
              if (url.endsWith('/api/auth/refresh')) {
                refreshCallCount++;
                return Promise.resolve({
                  ok: true,
                  json: () =>
                    Promise.resolve({
                      success: true,
                      user: mockUser,
                      expiresAt: Date.now() + secondLifetime,
                    }),
                });
              }
              return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ success: true }),
              });
            });
            vi.stubGlobal('fetch', fetchMock);

            const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });

            await waitFor(() => {
              expect(hook.result.current.isAuthenticated).toBe(true);
            });

            // Trigger first refresh
            await act(async () => {
              await vi.advanceTimersByTimeAsync(
                firstLifetime * REFRESH_THRESHOLD + 100,
              );
            });
            expect(refreshCallCount).toBeGreaterThanOrEqual(1);

            // Trigger second refresh (new token lifetime)
            await act(async () => {
              await vi.advanceTimersByTimeAsync(
                secondLifetime * REFRESH_THRESHOLD + 100,
              );
            });
            expect(refreshCallCount).toBeGreaterThanOrEqual(2);

            hook.unmount();
          },
        ),
        { numRuns: 100 },
      );
    },
    120_000,
  );

  /**
   * Property 2.3: The refresh always fires strictly before the token
   * expires, never at or after expiration.
   *
   * We verify that at half the refresh delay no refresh has occurred,
   * and that the refresh fires well before the full expiration time.
   *
   * **Validates: Requirements 2.4**
   */
  it(
    'refresh fires before expiration, not after, for any token lifetime',
    async () => {
      await fc.assert(
        fc.asyncProperty(tokenLifetimeArb, async (lifetime) => {
          resetState();

          const expiresAt = Date.now() + lifetime;
          const refreshDelay = lifetime * REFRESH_THRESHOLD;
          const refreshCalls: { calledAt: number }[] = [];

          vi.stubGlobal('fetch', buildFetchMock(expiresAt, lifetime, refreshCalls));

          const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });

          await waitFor(() => {
            expect(hook.result.current.isAuthenticated).toBe(true);
          });

          // Advance to half the refresh delay — no refresh yet
          await act(async () => {
            await vi.advanceTimersByTimeAsync(refreshDelay / 2);
          });
          expect(refreshCalls.length).toBe(0);

          // Now cross the threshold
          await act(async () => {
            await vi.advanceTimersByTimeAsync(refreshDelay / 2 + 100);
          });
          expect(refreshCalls.length).toBeGreaterThanOrEqual(1);

          // 80% is always strictly less than 100%
          expect(refreshDelay).toBeLessThan(lifetime);

          hook.unmount();
        }),
        { numRuns: 100 },
      );
    },
    120_000,
  );
});
