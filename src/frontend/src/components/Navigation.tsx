'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useCallback, useState } from 'react';

import { useFocusTrap, useKeyboardNavigation } from '../hooks/useKeyboardNavigation';
import { selectUnreadCount, useGlobalStore } from '../store/index';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single navigation entry. */
export interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
  /** Optional nested sub-items for complex sections (Req 6.3). */
  children?: NavItem[];
}

export interface NavigationProps {
  /** Navigation items to render. */
  items: NavItem[];
}

// ---------------------------------------------------------------------------
// Default navigation items (Req 6.1)
// ---------------------------------------------------------------------------

const DashboardIcon = (): React.JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className="h-5 w-5"
    aria-hidden="true"
  >
    <path d="M11.47 3.84a.75.75 0 011.06 0l8.69 8.69a.75.75 0 101.06-1.06l-8.689-8.69a2.25 2.25 0 00-3.182 0l-8.69 8.69a.75.75 0 001.061 1.06l8.69-8.69z" />
    <path d="M12 5.432l8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75V21a.75.75 0 01-.75.75H5.625A1.875 1.875 0 013.75 19.875v-6.198a2.29 2.29 0 00.091-.086L12 5.432z" />
  </svg>
);

const TransactionsIcon = (): React.JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className="h-5 w-5"
    aria-hidden="true"
  >
    <path d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
  </svg>
);

const DocumentsIcon = (): React.JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className="h-5 w-5"
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0016.5 9h-1.875a1.875 1.875 0 01-1.875-1.875V5.25A3.75 3.75 0 009 1.5H5.625z"
      clipRule="evenodd"
    />
    <path d="M12.971 1.816A5.23 5.23 0 0114.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 013.434 1.279 9.768 9.768 0 00-6.963-6.963z" />
  </svg>
);

const InsightsIcon = (): React.JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className="h-5 w-5"
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      d="M2.25 13.5a8.25 8.25 0 018.25-8.25.75.75 0 01.75.75v6.75H18a.75.75 0 01.75.75 8.25 8.25 0 01-16.5 0z"
      clipRule="evenodd"
    />
    <path
      fillRule="evenodd"
      d="M12.75 3a.75.75 0 01.75-.75 8.25 8.25 0 018.25 8.25.75.75 0 01-.75.75h-7.5a.75.75 0 01-.75-.75V3z"
      clipRule="evenodd"
    />
  </svg>
);

const SettingsIcon = (): React.JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className="h-5 w-5"
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 00-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 00-2.282.819l-.922 1.597a1.875 1.875 0 00.432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 000 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 00-.432 2.385l.922 1.597a1.875 1.875 0 002.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 002.28-.819l.923-1.597a1.875 1.875 0 00-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 000-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 00-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 00-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 00-1.85-1.567h-1.843zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z"
      clipRule="evenodd"
    />
  </svg>
);

export const DEFAULT_NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: <DashboardIcon /> },
  { label: 'Transactions', href: '/transactions', icon: <TransactionsIcon /> },
  { label: 'Documents', href: '/documents', icon: <DocumentsIcon /> },
  { label: 'Insights', href: '/insights', icon: <InsightsIcon /> },
  { label: 'Settings', href: '/settings', icon: <SettingsIcon /> },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ChevronIcon = ({ expanded }: { expanded: boolean }): React.JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 20 20"
    fill="currentColor"
    className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
      clipRule="evenodd"
    />
  </svg>
);

const HamburgerIcon = (): React.JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className="h-6 w-6"
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      d="M3 6.75A.75.75 0 013.75 6h16.5a.75.75 0 010 1.5H3.75A.75.75 0 013 6.75zM3 12a.75.75 0 01.75-.75h16.5a.75.75 0 010 1.5H3.75A.75.75 0 013 12zm0 5.25a.75.75 0 01.75-.75h16.5a.75.75 0 010 1.5H3.75a.75.75 0 01-.75-.75z"
      clipRule="evenodd"
    />
  </svg>
);

const CloseIcon = (): React.JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className="h-6 w-6"
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z"
      clipRule="evenodd"
    />
  </svg>
);

// ---------------------------------------------------------------------------
// Sidebar nav item (desktop / tablet)
// ---------------------------------------------------------------------------

function SidebarNavItem({
  item,
  isActive,
  pathname,
}: {
  item: NavItem;
  isActive: boolean;
  pathname: string;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = item.children && item.children.length > 0;

  // Auto-expand if a child is active
  const childActive = hasChildren
    ? item.children!.some((c) => pathname.startsWith(c.href))
    : false;

  const isExpanded = expanded || childActive;

  const handleToggle = useCallback((): void => {
    setExpanded((prev) => !prev);
  }, []);

  if (hasChildren) {
    return (
      <div>
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={isExpanded}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors min-h-[44px] ${
            isActive || childActive
              ? 'bg-primary/10 text-primary'
              : 'text-text-secondary hover:bg-gray-100 hover:text-text-primary dark:hover:bg-gray-800'
          }`}
        >
          {item.icon}
          <span className="hidden tablet:inline flex-1 text-left">{item.label}</span>
          <span className="hidden tablet:inline">
            <ChevronIcon expanded={isExpanded} />
          </span>
        </button>
        {isExpanded && (
          <div className="ml-4 mt-1 flex flex-col gap-1" role="group" aria-label={item.label}>
            {item.children!.map((child) => {
              const active = pathname.startsWith(child.href);
              return (
                <Link
                  key={child.href}
                  href={child.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors min-h-[44px] ${
                    active
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-text-secondary hover:bg-gray-100 hover:text-text-primary dark:hover:bg-gray-800'
                  }`}
                >
                  {child.icon}
                  <span className="hidden tablet:inline">{child.label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={isActive ? 'page' : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors min-h-[44px] ${
        isActive
          ? 'bg-primary/10 text-primary'
          : 'text-text-secondary hover:bg-gray-100 hover:text-text-primary dark:hover:bg-gray-800'
      }`}
    >
      {item.icon}
      <span className="hidden tablet:inline">{item.label}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Notification badge
// ---------------------------------------------------------------------------

function NotificationBadge({ count }: { count: number }): React.JSX.Element | null {
  if (count <= 0) return null;
  const display = count > 99 ? '99+' : String(count);
  return (
    <span
      className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-white"
      aria-label={`${count} unread notifications`}
    >
      {display}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sidebar (desktop / tablet) — Req 5.3, 6.1, 6.2, 6.3, 6.4
// ---------------------------------------------------------------------------

export function Sidebar({ items }: NavigationProps): React.JSX.Element {
  const pathname = usePathname();
  const unreadCount = useGlobalStore(selectUnreadCount);
  const { containerRef, handleKeyDown } = useKeyboardNavigation({
    orientation: 'vertical',
    itemSelector: 'a, button',
  });

  return (
    <aside
      className="hidden mobile:flex mobile:w-20 tablet:w-64 mobile:flex-col mobile:fixed mobile:inset-y-0 mobile:left-0 mobile:z-30 mobile:border-r mobile:border-gray-200 mobile:bg-surface mobile:pt-safe-top mobile:pb-safe-bottom mobile:pl-safe-left dark:mobile:border-gray-700"
      aria-label="Main navigation"
    >
      {/* Logo */}
      <div className="flex h-16 items-center justify-center border-b border-gray-200 px-4 dark:border-gray-700">
        <span className="hidden tablet:block text-lg font-semibold text-primary">CashTrace</span>
        <span className="block tablet:hidden text-lg font-bold text-primary">CT</span>
      </div>

      {/* Nav items — arrow key navigation (Req 6.4, 13.1) */}
      <nav
        ref={containerRef as React.RefObject<HTMLElement>}
        onKeyDown={handleKeyDown}
        className="flex flex-1 flex-col gap-1 p-2"
        aria-label="Sidebar"
        role="menubar"
        aria-orientation="vertical"
      >
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <div key={item.href} className="relative" role="none">
              <SidebarNavItem item={item} isActive={active} pathname={pathname} />
              {/* Badge on Dashboard item (Req 6.6) */}
              {item.href === '/dashboard' && (
                <span className="absolute top-1 right-1 tablet:right-auto tablet:left-8">
                  <NotificationBadge count={unreadCount} />
                </span>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Bottom navigation (mobile) — Req 5.3, 6.1, 6.2, 6.5
// ---------------------------------------------------------------------------

export function BottomNav({ items }: NavigationProps): React.JSX.Element {
  const pathname = usePathname();
  const unreadCount = useGlobalStore(selectUnreadCount);
  const { containerRef, handleKeyDown } = useKeyboardNavigation({
    orientation: 'horizontal',
    itemSelector: 'a',
  });

  return (
    <nav
      ref={containerRef as React.RefObject<HTMLElement>}
      onKeyDown={handleKeyDown}
      className="fixed inset-x-0 bottom-0 z-30 flex mobile:hidden border-t border-gray-200 bg-surface pb-safe-bottom pl-safe-left pr-safe-right dark:border-gray-700"
      aria-label="Main navigation"
      role="menubar"
      aria-orientation="horizontal"
    >
      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            role="menuitem"
            aria-current={active ? 'page' : undefined}
            className={`relative flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium transition-colors min-h-[44px] ${
              active ? 'text-primary' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.href === '/dashboard' && (
              <span className="absolute top-0 right-1/4">
                <NotificationBadge count={unreadCount} />
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Mobile hamburger overlay (Req 6.5)
// ---------------------------------------------------------------------------

export function MobileMenuButton({
  items,
}: NavigationProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const unreadCount = useGlobalStore(selectUnreadCount);

  const close = useCallback((): void => {
    setOpen(false);
  }, []);

  const toggle = useCallback((): void => {
    setOpen((prev) => !prev);
  }, []);

  const { containerRef, handleKeyDown } = useKeyboardNavigation({
    orientation: 'vertical',
    itemSelector: 'a',
    onEscape: close,
  });

  // Share the keyboard nav ref with the focus trap
  useFocusTrap({ active: open, containerRef });

  return (
    <>
      <button
        type="button"
        className="mobile:hidden inline-flex items-center justify-center rounded-lg p-2 min-h-[44px] min-w-[44px] text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-800"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? 'Close menu' : 'Open menu'}
      >
        {open ? <CloseIcon /> : <HamburgerIcon />}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50 mobile:hidden"
            onClick={close}
            aria-hidden="true"
          />
          {/* Drawer — focus-trapped and keyboard navigable (Req 13.1) */}
          <nav
            id="mobile-menu"
            ref={containerRef as React.RefObject<HTMLElement>}
            onKeyDown={handleKeyDown}
            className="fixed inset-y-0 left-0 z-50 w-64 bg-surface p-4 pt-safe-top pb-safe-bottom pl-safe-left shadow-lg mobile:hidden overflow-y-auto"
            aria-label="Mobile navigation"
            role="menu"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="text-lg font-semibold text-primary">CashTrace</span>
              <button
                type="button"
                onClick={close}
                className="rounded-lg p-2 min-h-[44px] min-w-[44px] text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Close menu"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {items.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={close}
                    role="menuitem"
                    aria-current={active ? 'page' : undefined}
                    className={`relative flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors min-h-[44px] ${
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-text-secondary hover:bg-gray-100 hover:text-text-primary dark:hover:bg-gray-800'
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                    {item.href === '/dashboard' && (
                      <span className="ml-auto">
                        <NotificationBadge count={unreadCount} />
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </nav>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Unified Navigation component
// ---------------------------------------------------------------------------

/**
 * Responsive navigation component.
 *
 * - Desktop/Tablet (≥640px): renders a sidebar
 * - Mobile (<640px): renders a bottom nav bar + optional hamburger menu
 *
 * Satisfies Requirements 6.1–6.6.
 */
export function Navigation({ items }: NavigationProps): React.JSX.Element {
  return (
    <>
      <Sidebar items={items} />
      <BottomNav items={items} />
    </>
  );
}
