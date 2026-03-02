'use client';

import { usePathname } from 'next/navigation';
import { type ReactNode } from 'react';

import { DEFAULT_NAV_ITEMS, MobileMenuButton, Navigation } from '../components/Navigation';
import { SkipLink } from '../components/SkipLink';
import { useFocusOnRouteChange } from '../hooks/useFocusOnRouteChange';
import { usePrefetch } from '../hooks/usePrefetch';

export interface DashboardLayoutProps {
  children: ReactNode;
}

/** Routes to prefetch after initial render (Req 14.3). */
const PREFETCH_ROUTES = ['/dashboard', '/transactions', '/documents', '/insights', '/settings'];

/**
 * Main application layout with responsive navigation.
 *
 * - Mobile (<640px): bottom navigation bar + hamburger menu
 * - Tablet/Desktop (≥640px): sidebar navigation
 *
 * Delegates navigation rendering to the standalone Navigation component.
 *
 * @see Requirements 5.1, 5.2, 5.3, 6.1, 14.3
 */
export function DashboardLayout({ children }: DashboardLayoutProps): React.JSX.Element {
  const pathname = usePathname();
  useFocusOnRouteChange();
  usePrefetch(PREFETCH_ROUTES);

  const activeLabel =
    DEFAULT_NAV_ITEMS.find((item) => pathname.startsWith(item.href))?.label ?? 'CashTrace';

  return (
    <div className="flex min-h-screen flex-col mobile:flex-row">
      <SkipLink />
      {/* Sidebar (desktop/tablet) + Bottom nav (mobile) */}
      <Navigation items={DEFAULT_NAV_ITEMS} />

      {/* Main content area */}
      <div className="flex flex-1 flex-col mobile:ml-20 tablet:ml-64">
        {/* Header — safe area top inset for notched devices (Req 5.5) */}
        <header role="banner" className="sticky top-0 z-20 flex min-h-[44px] items-center border-b border-gray-200 bg-surface px-4 pt-safe-top pl-safe-left pr-safe-right dark:border-gray-700">
          {/* Hamburger for mobile (Req 6.5) */}
          <MobileMenuButton items={DEFAULT_NAV_ITEMS} />
          <h1 className="text-lg font-semibold text-text-primary ml-2 mobile:ml-0">
            {activeLabel}
          </h1>
        </header>

        {/* Page content — safe area horizontal insets (Req 5.5) */}
        <main id="main-content" className="flex-1 p-4 pl-safe-left pr-safe-right tablet:p-6">
          {children}
        </main>
      </div>

      {/* Spacer for mobile bottom nav so content isn't hidden behind it */}
      <div className="h-16 mobile:hidden" aria-hidden="true" />
    </div>
  );
}
