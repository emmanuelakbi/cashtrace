import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NavItem } from './Navigation';
import {
  BottomNav,
  DEFAULT_NAV_ITEMS,
  MobileMenuButton,
  Navigation,
  Sidebar,
} from './Navigation';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPathname = vi.fn<() => string>().mockReturnValue('/dashboard');

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let mockUnreadCount = 0;
vi.mock('../store/index.js', () => ({
  useGlobalStore: (selector: (state: { unreadCount: number }) => unknown) =>
    selector({ unreadCount: mockUnreadCount }),
  selectUnreadCount: (state: { unreadCount: number }) => state.unreadCount,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const icon = <span data-testid="icon">★</span>;

function makeItems(overrides?: Partial<NavItem>[]): NavItem[] {
  const base: NavItem[] = [
    { label: 'Dashboard', href: '/dashboard', icon },
    { label: 'Transactions', href: '/transactions', icon },
    { label: 'Settings', href: '/settings', icon },
  ];
  if (!overrides) return base;
  return base.map((item, i) => ({ ...item, ...overrides[i] }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.mockReturnValue('/dashboard');
    mockUnreadCount = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Req 6.1 — Primary navigation items
  // -----------------------------------------------------------------------
  describe('DEFAULT_NAV_ITEMS (Req 6.1)', () => {
    it('contains the five required navigation items', () => {
      const labels = DEFAULT_NAV_ITEMS.map((i) => i.label);
      expect(labels).toEqual([
        'Dashboard',
        'Transactions',
        'Documents',
        'Insights',
        'Settings',
      ]);
    });

    it('each item has a valid href', () => {
      for (const item of DEFAULT_NAV_ITEMS) {
        expect(item.href).toMatch(/^\//);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Sidebar (Req 6.2, 6.4)
  // -----------------------------------------------------------------------
  describe('Sidebar', () => {
    it('renders all nav items', () => {
      const items = makeItems();
      render(<Sidebar items={items} />);

      for (const item of items) {
        expect(screen.getByText(item.label)).toBeInTheDocument();
      }
    });

    it('marks the active route with aria-current="page" (Req 6.2)', () => {
      mockPathname.mockReturnValue('/transactions');
      render(<Sidebar items={makeItems()} />);

      const activeLink = screen.getByText('Transactions').closest('a');
      expect(activeLink).toHaveAttribute('aria-current', 'page');

      const inactiveLink = screen.getByText('Dashboard').closest('a');
      expect(inactiveLink).not.toHaveAttribute('aria-current');
    });

    it('has aria-label on the aside element for accessibility (Req 6.4)', () => {
      render(<Sidebar items={makeItems()} />);
      expect(screen.getByLabelText('Main navigation')).toBeInTheDocument();
    });

    it('renders links that are keyboard focusable (Req 6.4)', () => {
      render(<Sidebar items={makeItems()} />);
      const links = screen.getAllByRole('link');
      for (const link of links) {
        expect(link.tabIndex).not.toBe(-1);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Req 6.3 — Nested navigation
  // -----------------------------------------------------------------------
  describe('Sidebar nested navigation (Req 6.3)', () => {
    const nestedItems: NavItem[] = [
      { label: 'Dashboard', href: '/dashboard', icon },
      {
        label: 'Settings',
        href: '/settings',
        icon,
        children: [
          { label: 'Profile', href: '/settings/profile', icon },
          { label: 'Security', href: '/settings/security', icon },
        ],
      },
    ];

    it('renders expand/collapse button for items with children', () => {
      render(<Sidebar items={nestedItems} />);
      const toggleBtn = screen.getByRole('button', { name: /settings/i });
      expect(toggleBtn).toBeInTheDocument();
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    });

    it('expands children on click', () => {
      render(<Sidebar items={nestedItems} />);
      const toggleBtn = screen.getByRole('button', { name: /settings/i });

      fireEvent.click(toggleBtn);

      expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('Profile')).toBeInTheDocument();
      expect(screen.getByText('Security')).toBeInTheDocument();
    });

    it('auto-expands when a child route is active', () => {
      mockPathname.mockReturnValue('/settings/security');
      render(<Sidebar items={nestedItems} />);

      // Should be visible without clicking
      expect(screen.getByText('Security')).toBeInTheDocument();
      expect(screen.getByText('Profile')).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // BottomNav (Req 6.1, 6.2)
  // -----------------------------------------------------------------------
  describe('BottomNav', () => {
    it('renders all nav items', () => {
      render(<BottomNav items={makeItems()} />);
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Transactions')).toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('marks the active route with aria-current="page" (Req 6.2)', () => {
      mockPathname.mockReturnValue('/settings');
      render(<BottomNav items={makeItems()} />);

      const activeLink = screen.getByText('Settings').closest('a');
      expect(activeLink).toHaveAttribute('aria-current', 'page');
    });

    it('has aria-label on the nav element', () => {
      render(<BottomNav items={makeItems()} />);
      expect(screen.getByLabelText('Main navigation')).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Req 6.6 — Notification badges
  // -----------------------------------------------------------------------
  describe('Notification badges (Req 6.6)', () => {
    it('does not show badge when unreadCount is 0', () => {
      mockUnreadCount = 0;
      render(<Sidebar items={makeItems()} />);
      expect(screen.queryByLabelText(/unread notifications/)).not.toBeInTheDocument();
    });

    it('shows badge with count on Dashboard item in sidebar', () => {
      mockUnreadCount = 5;
      render(<Sidebar items={makeItems()} />);
      expect(screen.getByLabelText('5 unread notifications')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('caps display at 99+', () => {
      mockUnreadCount = 150;
      render(<Sidebar items={makeItems()} />);
      expect(screen.getByLabelText('150 unread notifications')).toBeInTheDocument();
      expect(screen.getByText('99+')).toBeInTheDocument();
    });

    it('shows badge in bottom nav', () => {
      mockUnreadCount = 3;
      render(<BottomNav items={makeItems()} />);
      expect(screen.getByLabelText('3 unread notifications')).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Req 6.5 — Hamburger menu
  // -----------------------------------------------------------------------
  describe('MobileMenuButton (Req 6.5)', () => {
    it('renders a toggle button', () => {
      render(<MobileMenuButton items={makeItems()} />);
      expect(screen.getByLabelText('Open menu')).toBeInTheDocument();
    });

    it('opens the drawer on click', () => {
      render(<MobileMenuButton items={makeItems()} />);
      fireEvent.click(screen.getByLabelText('Open menu'));

      expect(screen.getByLabelText('Mobile navigation')).toBeInTheDocument();
      expect(screen.getByText('CashTrace')).toBeInTheDocument();
    });

    it('closes the drawer when close button is clicked', () => {
      render(<MobileMenuButton items={makeItems()} />);
      fireEvent.click(screen.getByLabelText('Open menu'));

      // There are two close buttons — the toggle and the one inside the drawer
      const drawer = screen.getByLabelText('Mobile navigation');
      const closeBtn = within(drawer).getByLabelText('Close menu');
      fireEvent.click(closeBtn);

      expect(screen.queryByLabelText('Mobile navigation')).not.toBeInTheDocument();
    });

    it('closes the drawer when a nav link is clicked', () => {
      render(<MobileMenuButton items={makeItems()} />);
      fireEvent.click(screen.getByLabelText('Open menu'));

      fireEvent.click(screen.getByText('Transactions'));

      expect(screen.queryByLabelText('Mobile navigation')).not.toBeInTheDocument();
    });

    it('sets aria-expanded correctly', () => {
      render(<MobileMenuButton items={makeItems()} />);
      const btn = screen.getByLabelText('Open menu');
      expect(btn).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(btn);
      // Two "Close menu" buttons exist: the toggle (with aria-controls) and the drawer close
      const controlBtn = screen.getAllByLabelText('Close menu')
        .find((el) => el.hasAttribute('aria-controls'));
      expect(controlBtn).toHaveAttribute('aria-expanded', 'true');
    });
  });

  // -----------------------------------------------------------------------
  // Unified Navigation component
  // -----------------------------------------------------------------------
  describe('Navigation (unified)', () => {
    it('renders both sidebar and bottom nav regions', () => {
      render(<Navigation items={makeItems()} />);
      const navs = screen.getAllByLabelText('Main navigation');
      expect(navs.length).toBe(2); // sidebar aside + bottom nav
    });
  });
});
