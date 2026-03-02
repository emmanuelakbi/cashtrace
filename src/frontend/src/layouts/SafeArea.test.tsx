import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AuthLayout } from './AuthLayout';
import { DashboardLayout } from './DashboardLayout';
import { PublicLayout } from './PublicLayout';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Checks whether an element (or any ancestor) contains a specific CSS class substring.
 * Useful for verifying Tailwind safe-area utility classes.
 */
function hasClassOnSelfOrAncestor(el: HTMLElement, classSubstring: string): boolean {
  let current: HTMLElement | null = el;
  while (current) {
    if (current.className && current.className.includes(classSubstring)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

/**
 * Collects all interactive elements (links, buttons, role=button) from a container.
 */
function getInteractiveElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('a, button, [role="button"]'),
  );
}

// ---------------------------------------------------------------------------
// Tests — Req 5.4: Touch targets (44x44px minimum)
// ---------------------------------------------------------------------------

describe('Touch target sizing (Req 5.4)', () => {
  it('DashboardLayout header hamburger button has min 44px touch target', () => {
    render(<DashboardLayout><div>content</div></DashboardLayout>);
    const menuBtn = screen.getByLabelText('Open menu');
    expect(menuBtn.className).toContain('min-h-[44px]');
    expect(menuBtn.className).toContain('min-w-[44px]');
  });

  it('PublicLayout interactive elements have min-h-touch class', () => {
    render(<PublicLayout><div>content</div></PublicLayout>);
    const loginLink = screen.getByText('Log in');
    expect(loginLink.className).toContain('min-h-touch');
    const signupLink = screen.getByText('Sign up');
    expect(signupLink.className).toContain('min-h-touch');
  });

  it('PublicLayout Log in link has min-w-touch for adequate tap area', () => {
    render(<PublicLayout><div>content</div></PublicLayout>);
    const loginLink = screen.getByText('Log in');
    expect(loginLink.className).toContain('min-w-touch');
  });

  it('DashboardLayout header has min-h-[44px] for touch target compliance', () => {
    render(<DashboardLayout><div>content</div></DashboardLayout>);
    const header = screen.getByRole('banner');
    expect(header.className).toContain('min-h-[44px]');
  });
});

// ---------------------------------------------------------------------------
// Tests — Req 5.5: Safe area insets for notched devices
// ---------------------------------------------------------------------------

describe('Safe area insets (Req 5.5)', () => {
  describe('DashboardLayout', () => {
    it('header applies safe area top padding', () => {
      render(<DashboardLayout><div>content</div></DashboardLayout>);
      const header = screen.getByRole('banner');
      expect(header.className).toContain('pt-safe-top');
    });

    it('header applies safe area left/right padding', () => {
      render(<DashboardLayout><div>content</div></DashboardLayout>);
      const header = screen.getByRole('banner');
      expect(header.className).toContain('pl-safe-left');
      expect(header.className).toContain('pr-safe-right');
    });

    it('main content applies safe area horizontal padding', () => {
      render(<DashboardLayout><div data-testid="child">content</div></DashboardLayout>);
      const main = screen.getByRole('main');
      expect(main.className).toContain('pl-safe-left');
      expect(main.className).toContain('pr-safe-right');
    });
  });

  describe('AuthLayout', () => {
    it('outer container applies all four safe area insets', () => {
      const { container } = render(<AuthLayout><div>content</div></AuthLayout>);
      const outer = container.firstElementChild as HTMLElement;
      expect(outer.className).toContain('pt-safe-top');
      expect(outer.className).toContain('pb-safe-bottom');
      expect(outer.className).toContain('pl-safe-left');
      expect(outer.className).toContain('pr-safe-right');
    });
  });

  describe('PublicLayout', () => {
    it('header applies safe area top padding', () => {
      render(<PublicLayout><div>content</div></PublicLayout>);
      const header = screen.getByRole('banner');
      expect(header.className).toContain('pt-safe-top');
    });

    it('header inner container applies safe area horizontal padding', () => {
      render(<PublicLayout><div>content</div></PublicLayout>);
      const brandLink = screen.getByText('CashTrace');
      const headerInner = brandLink.parentElement as HTMLElement;
      expect(headerInner.className).toContain('pl-safe-left');
      expect(headerInner.className).toContain('pr-safe-right');
    });

    it('footer applies safe area bottom padding', () => {
      render(<PublicLayout><div>content</div></PublicLayout>);
      const footer = screen.getByRole('contentinfo');
      expect(footer.className).toContain('pb-safe-bottom');
    });

    it('main content applies safe area horizontal padding', () => {
      render(<PublicLayout><div>content</div></PublicLayout>);
      const main = screen.getByRole('main');
      expect(main.className).toContain('pl-safe-left');
      expect(main.className).toContain('pr-safe-right');
    });
  });

  describe('Navigation', () => {
    it('bottom nav applies safe area bottom and horizontal padding', () => {
      render(<DashboardLayout><div>content</div></DashboardLayout>);
      const bottomNav = screen.getAllByLabelText('Main navigation')
        .find((el) => el.tagName === 'NAV');
      expect(bottomNav).toBeDefined();
      expect(bottomNav!.className).toContain('pb-safe-bottom');
      expect(bottomNav!.className).toContain('pl-safe-left');
      expect(bottomNav!.className).toContain('pr-safe-right');
    });

    it('sidebar applies safe area top, bottom, and left padding', () => {
      render(<DashboardLayout><div>content</div></DashboardLayout>);
      const sidebar = screen.getByLabelText('Main navigation', { selector: 'aside' });
      expect(sidebar.className).toContain('mobile:pt-safe-top');
      expect(sidebar.className).toContain('mobile:pb-safe-bottom');
      expect(sidebar.className).toContain('mobile:pl-safe-left');
    });
  });
});

// ---------------------------------------------------------------------------
// Tests — Tailwind config tokens
// ---------------------------------------------------------------------------

describe('Tailwind safe area config', () => {
  it('design tokens export safe area inset values', async () => {
    const { safeAreaInsets, touchTarget } = await import('../theme/tokens.js');
    expect(safeAreaInsets.top).toBe('env(safe-area-inset-top)');
    expect(safeAreaInsets.bottom).toBe('env(safe-area-inset-bottom)');
    expect(safeAreaInsets.left).toBe('env(safe-area-inset-left)');
    expect(safeAreaInsets.right).toBe('env(safe-area-inset-right)');
    expect(touchTarget.min).toBe(44);
    expect(touchTarget.minPx).toBe('44px');
  });
});
