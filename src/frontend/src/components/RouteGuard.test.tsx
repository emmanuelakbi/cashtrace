import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Permission } from './RouteGuard';
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

// --- Helpers ---------------------------------------------------------------

function setAuth(overrides: Partial<typeof mockAuth>): void {
  Object.assign(mockAuth, overrides);
}

function resetAuth(): void {
  mockAuth.user = null;
  mockAuth.isAuthenticated = false;
  mockAuth.isLoading = false;
  mockAuth.tokenExpiresAt = null;
}

// --- Tests -----------------------------------------------------------------

describe('RouteGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuth();
    mockPathname.mockReturnValue('/dashboard');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Req 3.5 — Public routes render without auth
  describe('public routes (requireAuth=false)', () => {
    it('renders children when user is not authenticated', () => {
      render(
        <RouteGuard requireAuth={false} fallbackPath="/login">
          <p>Public content</p>
        </RouteGuard>,
      );

      expect(screen.getByText('Public content')).toBeInTheDocument();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('renders children when user is authenticated', () => {
      setAuth({
        isAuthenticated: true,
        user: { id: '1', email: 'a@b.com', businessId: 'b1', businessName: 'Biz' },
      });

      render(
        <RouteGuard requireAuth={false} fallbackPath="/login">
          <p>Public content</p>
        </RouteGuard>,
      );

      expect(screen.getByText('Public content')).toBeInTheDocument();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  // Req 3.3 — Loading state while verifying auth
  describe('loading state', () => {
    it('shows loading skeleton while auth is being verified', () => {
      setAuth({ isLoading: true });

      render(
        <RouteGuard requireAuth={true} fallbackPath="/login">
          <p>Protected content</p>
        </RouteGuard>,
      );

      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText('Verifying access…')).toBeInTheDocument();
      expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  // Req 3.1 — Verify auth before rendering protected routes
  describe('protected routes — authenticated', () => {
    it('renders children when user is authenticated', () => {
      setAuth({
        isAuthenticated: true,
        user: { id: '1', email: 'a@b.com', businessId: 'b1', businessName: 'Biz' },
      });

      render(
        <RouteGuard requireAuth={true} fallbackPath="/login">
          <p>Protected content</p>
        </RouteGuard>,
      );

      expect(screen.getByText('Protected content')).toBeInTheDocument();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  // Req 3.4 — Redirect when not authenticated
  describe('protected routes — unauthenticated', () => {
    it('redirects to fallbackPath with redirect query param', () => {
      mockPathname.mockReturnValue('/dashboard');

      render(
        <RouteGuard requireAuth={true} fallbackPath="/login">
          <p>Protected content</p>
        </RouteGuard>,
      );

      expect(mockReplace).toHaveBeenCalledWith('/login?redirect=%2Fdashboard');
      expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    });

    it('encodes complex pathnames in the redirect param', () => {
      mockPathname.mockReturnValue('/settings/profile?tab=security');

      render(
        <RouteGuard requireAuth={true} fallbackPath="/login">
          <p>Protected content</p>
        </RouteGuard>,
      );

      expect(mockReplace).toHaveBeenCalledWith(
        '/login?redirect=%2Fsettings%2Fprofile%3Ftab%3Dsecurity',
      );
    });
  });

  // Req 3.2 — Permission-based access control
  describe('permission checks', () => {
    it('renders children when user has required permissions', () => {
      setAuth({
        isAuthenticated: true,
        user: { id: '1', email: 'a@b.com', businessId: 'b1', businessName: 'Biz' },
      });

      const perms: Permission[] = ['read:transactions', 'read:insights'];

      render(
        <RouteGuard
          requireAuth={true}
          requiredPermissions={perms}
          fallbackPath="/login"
        >
          <p>Protected content</p>
        </RouteGuard>,
      );

      expect(screen.getByText('Protected content')).toBeInTheDocument();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('renders children when no permissions are required', () => {
      setAuth({
        isAuthenticated: true,
        user: { id: '1', email: 'a@b.com', businessId: 'b1', businessName: 'Biz' },
      });

      render(
        <RouteGuard requireAuth={true} fallbackPath="/login">
          <p>Protected content</p>
        </RouteGuard>,
      );

      expect(screen.getByText('Protected content')).toBeInTheDocument();
    });
  });

  // Req 3.4 — Redirect preserves intended destination
  describe('redirect destination preservation', () => {
    it('preserves the current pathname as redirect param', () => {
      mockPathname.mockReturnValue('/transactions/new');

      render(
        <RouteGuard requireAuth={true} fallbackPath="/auth/login">
          <p>Protected content</p>
        </RouteGuard>,
      );

      expect(mockReplace).toHaveBeenCalledWith(
        '/auth/login?redirect=%2Ftransactions%2Fnew',
      );
    });
  });
});
