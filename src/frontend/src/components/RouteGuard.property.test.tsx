/**
 * Property-based tests for RouteGuard component.
 *
 * **Property 1: Authentication State Consistency**
 * **Validates: Requirements 2.5, 2.6**
 *
 * For any protected route access, the user SHALL be redirected to login
 * if not authenticated, and returned to original destination after
 * successful login.
 *
 * Properties verified:
 * 1. For any pathname, an unauthenticated user is always redirected to the fallback path.
 * 2. The redirect URL always contains the original pathname as a query parameter.
 * 3. An authenticated user is never redirected (always sees the content).
 */
import { render, screen } from '@testing-library/react';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RouteGuard } from './RouteGuard';

// --- Mocks ----------------------------------------------------------------

const mockReplace = vi.fn();
const mockPathname = vi.fn<() => string>().mockReturnValue('/dashboard');

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => mockPathname(),
}));

const mockAuth = {
  user: null as { id: string; email: string; businessId: string; businessName: string } | null,
  isAuthenticated: false,
  isLoading: false,
  tokenExpiresAt: null as number | null,
  login: vi.fn(),
  logout: vi.fn(),
  refreshToken: vi.fn(),
};

vi.mock('../providers/AuthProvider', () => ({
  useAuth: () => mockAuth,
}));

// --- Generators -----------------------------------------------------------

/**
 * Generates realistic URL path segments (lowercase alpha + hyphens).
 * Avoids empty segments and special characters that would break URL parsing.
 */
const arbPathSegment = fc
  .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
    minLength: 1,
    maxLength: 20,
  })
  .filter((s) => !s.startsWith('-') && !s.endsWith('-'));

/**
 * Generates valid URL pathnames like /dashboard, /settings/profile, /a/b/c.
 * Always starts with / and has 1-4 segments.
 */
const arbPathname = fc
  .array(arbPathSegment, { minLength: 1, maxLength: 4 })
  .map((segments) => '/' + segments.join('/'));

/**
 * Generates fallback paths (login-style routes).
 */
const arbFallbackPath = fc
  .constantFrom('/login', '/auth/login', '/signin', '/auth/signin');

// --- Helpers ---------------------------------------------------------------

function setAuthenticated(): void {
  mockAuth.user = { id: '1', email: 'user@example.com', businessId: 'b1', businessName: 'Biz' };
  mockAuth.isAuthenticated = true;
  mockAuth.isLoading = false;
}

function setUnauthenticated(): void {
  mockAuth.user = null;
  mockAuth.isAuthenticated = false;
  mockAuth.isLoading = false;
}

// --- Property Tests -------------------------------------------------------

describe('RouteGuard — Property 1: Authentication State Consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUnauthenticated();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * **Validates: Requirement 2.5**
   *
   * For any pathname, an unauthenticated user accessing a protected route
   * is always redirected to the fallback path.
   */
  it('unauthenticated users are always redirected for any protected route', () => {
    fc.assert(
      fc.property(arbPathname, arbFallbackPath, (pathname, fallbackPath) => {
        vi.clearAllMocks();
        setUnauthenticated();
        mockPathname.mockReturnValue(pathname);

        const { unmount } = render(
          <RouteGuard requireAuth={true} fallbackPath={fallbackPath}>
            <p>Protected content</p>
          </RouteGuard>,
        );

        // The router.replace must have been called with the fallback path
        expect(mockReplace).toHaveBeenCalledTimes(1);
        const calledUrl = mockReplace.mock.calls[0]![0] as string;
        expect(calledUrl.startsWith(fallbackPath)).toBe(true);

        // Protected content must NOT be visible
        expect(screen.queryByText('Protected content')).not.toBeInTheDocument();

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirement 2.6**
   *
   * The redirect URL always encodes the original pathname as a ?redirect=
   * query parameter so the user can be returned after login.
   */
  it('redirect URL always contains the original pathname as a query parameter', () => {
    fc.assert(
      fc.property(arbPathname, arbFallbackPath, (pathname, fallbackPath) => {
        vi.clearAllMocks();
        setUnauthenticated();
        mockPathname.mockReturnValue(pathname);

        const { unmount } = render(
          <RouteGuard requireAuth={true} fallbackPath={fallbackPath}>
            <p>Protected content</p>
          </RouteGuard>,
        );

        expect(mockReplace).toHaveBeenCalledTimes(1);
        const calledUrl = mockReplace.mock.calls[0]![0] as string;

        // The redirect URL must contain ?redirect= with the encoded pathname
        const expectedRedirect = `${fallbackPath}?redirect=${encodeURIComponent(pathname)}`;
        expect(calledUrl).toBe(expectedRedirect);

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.5, 2.6**
   *
   * An authenticated user is never redirected — they always see the
   * protected content regardless of the pathname.
   */
  it('authenticated users are never redirected and always see content', () => {
    fc.assert(
      fc.property(arbPathname, arbFallbackPath, (pathname, fallbackPath) => {
        vi.clearAllMocks();
        setAuthenticated();
        mockPathname.mockReturnValue(pathname);

        const { unmount } = render(
          <RouteGuard requireAuth={true} fallbackPath={fallbackPath}>
            <p>Protected content</p>
          </RouteGuard>,
        );

        // No redirect should have occurred
        expect(mockReplace).not.toHaveBeenCalled();

        // Protected content must be visible
        expect(screen.getByText('Protected content')).toBeInTheDocument();

        unmount();
      }),
      { numRuns: 100 },
    );
  });
});
