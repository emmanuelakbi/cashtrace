import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardLayout } from './DashboardLayout';

// --- Mocks ----------------------------------------------------------------

const mockPathname = vi.fn<() => string>().mockReturnValue('/dashboard');

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({ prefetch: vi.fn() }),
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

vi.mock('../store/index.js', () => ({
  useGlobalStore: (selector: (state: { unreadCount: number }) => unknown) =>
    selector({ unreadCount: 0 }),
  selectUnreadCount: (state: { unreadCount: number }) => state.unreadCount,
}));

// --- Tests -----------------------------------------------------------------

describe('DashboardLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.mockReturnValue('/dashboard');
  });

  // Req 5.1 — Renders children in main content area
  it('renders children in the main content area', () => {
    render(
      <DashboardLayout>
        <p>Page content</p>
      </DashboardLayout>,
    );

    expect(screen.getByText('Page content')).toBeInTheDocument();
  });

  // Req 5.1 — Uses semantic HTML elements
  it('uses semantic HTML elements', () => {
    render(
      <DashboardLayout>
        <p>Content</p>
      </DashboardLayout>,
    );

    // main element for content
    expect(screen.getByRole('main')).toBeInTheDocument();

    // nav elements for navigation (use menubar role for keyboard nav — Req 13.1)
    const navElements = screen.getAllByRole('menubar');
    expect(navElements.length).toBeGreaterThanOrEqual(1);
  });

  // Req 6.1 — Displays primary navigation items
  it('displays all primary navigation items', () => {
    render(
      <DashboardLayout>
        <p>Content</p>
      </DashboardLayout>,
    );

    const expectedLabels = ['Dashboard', 'Transactions', 'Documents', 'Insights', 'Settings'];

    for (const label of expectedLabels) {
      // Each label appears in both sidebar and bottom nav
      const elements = screen.getAllByText(label);
      expect(elements.length).toBeGreaterThanOrEqual(1);
    }
  });

  // Req 6.2 — Highlights the current active route
  it('marks the active route with aria-current="page"', () => {
    mockPathname.mockReturnValue('/transactions');

    render(
      <DashboardLayout>
        <p>Content</p>
      </DashboardLayout>,
    );

    const activeLinks = screen.getAllByRole('link', { current: 'page' });
    expect(activeLinks.length).toBeGreaterThanOrEqual(1);
    // All active links should point to /transactions
    for (const link of activeLinks) {
      expect(link).toHaveAttribute('href', '/transactions');
    }
  });

  // Req 6.2 — Non-active routes do not have aria-current
  it('does not mark non-active routes as current', () => {
    mockPathname.mockReturnValue('/dashboard');

    render(
      <DashboardLayout>
        <p>Content</p>
      </DashboardLayout>,
    );

    const settingsLinks = screen.getAllByText('Settings');
    for (const el of settingsLinks) {
      const link = el.closest('a');
      expect(link).not.toHaveAttribute('aria-current');
    }
  });

  // Req 5.2 — Header displays current section name
  it('displays the current section name in the header', () => {
    mockPathname.mockReturnValue('/insights');

    render(
      <DashboardLayout>
        <p>Content</p>
      </DashboardLayout>,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Insights');
  });

  // Fallback header when no route matches
  it('displays CashTrace as fallback header when no route matches', () => {
    mockPathname.mockReturnValue('/unknown');

    render(
      <DashboardLayout>
        <p>Content</p>
      </DashboardLayout>,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('CashTrace');
  });

  // Req 5.4 — Touch targets meet minimum size
  it('navigation links have minimum touch target size class', () => {
    render(
      <DashboardLayout>
        <p>Content</p>
      </DashboardLayout>,
    );

    const navLinks = screen.getAllByRole('link');
    for (const link of navLinks) {
      // Skip the visually-hidden skip link (Req 13.5) — it uses sr-only styling
      if (link.className.includes('sr-only')) continue;
      expect(link.className).toContain('min-h-[44px]');
    }
  });
});
