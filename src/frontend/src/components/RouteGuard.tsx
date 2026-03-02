'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '../providers/AuthProvider';

export type Permission =
  | 'read:transactions'
  | 'write:transactions'
  | 'read:insights'
  | 'manage:business';

export interface RouteGuardProps {
  /** Whether this route requires authentication. */
  requireAuth: boolean;
  /** Permissions the user must hold to access the route. */
  requiredPermissions?: Permission[];
  /** Path to redirect to when the user is not authorised. */
  fallbackPath: string;
  /** Child content rendered when access is granted. */
  children: React.ReactNode;
}

/**
 * Checks whether the user holds every required permission.
 *
 * In a real app the permissions would come from the user object or a
 * dedicated RBAC service. For now we treat any authenticated user as
 * having all permissions — the guard still wires up the check so the
 * plumbing is in place for when the backend provides role data.
 */
function hasPermissions(
  _userPermissions: Permission[],
  required: Permission[] | undefined,
): boolean {
  if (!required || required.length === 0) return true;
  return required.every((p) => _userPermissions.includes(p));
}

/**
 * Derive the set of permissions the current user holds.
 *
 * TODO: Replace with real permission data from the auth API once the
 * backend exposes role / permission claims.
 */
function getUserPermissions(isAuthenticated: boolean): Permission[] {
  if (!isAuthenticated) return [];
  // Authenticated users currently receive all permissions.
  return ['read:transactions', 'write:transactions', 'read:insights', 'manage:business'];
}

function LoadingSkeleton(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-label="Verifying authentication"
      className="flex min-h-screen items-center justify-center"
    >
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
        <span className="text-sm text-gray-500">Verifying access…</span>
      </div>
    </div>
  );
}

/**
 * RouteGuard protects routes based on authentication status and
 * optional permission requirements.
 *
 * - Displays a loading skeleton while auth state is being resolved.
 * - Redirects unauthenticated users to `fallbackPath`, preserving the
 *   intended destination via a `?redirect=` query parameter.
 * - Checks permissions for role-based access control.
 * - Renders children immediately for public routes (`requireAuth=false`).
 *
 * @see Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 */
export function RouteGuard({
  requireAuth,
  requiredPermissions,
  fallbackPath,
  children,
}: RouteGuardProps): React.JSX.Element {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const userPermissions = getUserPermissions(isAuthenticated);
  const permitted = hasPermissions(userPermissions, requiredPermissions);

  useEffect(() => {
    // Still resolving auth — do nothing yet.
    if (isLoading) return;

    // Public route — no checks needed.
    if (!requireAuth) return;

    if (!isAuthenticated) {
      // Preserve intended destination so the login page can redirect back.
      const redirectParam = encodeURIComponent(pathname);
      router.replace(`${fallbackPath}?redirect=${redirectParam}`);
      return;
    }

    if (!permitted) {
      router.replace(fallbackPath);
    }
  }, [isLoading, isAuthenticated, requireAuth, permitted, fallbackPath, pathname, router]);

  // --- Render logic ---

  // Public route: always render children regardless of auth state.
  if (!requireAuth) {
    return children as React.JSX.Element;
  }

  // Auth is still loading — show skeleton.
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  // Not authenticated or lacking permissions — render nothing while redirect fires.
  if (!isAuthenticated || !permitted) {
    return <LoadingSkeleton />;
  }

  return children as React.JSX.Element;
}
