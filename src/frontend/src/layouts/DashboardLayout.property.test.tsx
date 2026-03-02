/**
 * Property-Based Tests for DashboardLayout — Responsive Breakpoints
 *
 * **Property 5: Responsive Breakpoint Behavior**
 * **Validates: Requirements 5.2**
 *
 * For any screen width, the appropriate layout (mobile/tablet/desktop)
 * SHALL be rendered based on defined breakpoints:
 *   - mobile:  width < 640px
 *   - tablet:  640px ≤ width ≤ 1024px
 *   - desktop: width > 1024px
 */
import { render } from '@testing-library/react';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { breakpointValues } from '../theme/tokens';

import { DashboardLayout } from './DashboardLayout';

// --- Mocks ------------------------------------------------------------------

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

// --- Helpers ----------------------------------------------------------------

type LayoutMode = 'mobile' | 'tablet' | 'desktop';

/**
 * Determines the expected layout mode for a given screen width based on the
 * breakpoint values defined in the theme tokens.
 *
 * Breakpoints (from tokens.ts):
 *   mobile:  640   → screens < 640 are "mobile"
 *   tablet:  1024  → screens ≥ 640 and ≤ 1024 are "tablet"
 *   desktop: 1280  → screens > 1024 are "desktop"
 */
function classifyWidth(width: number): LayoutMode {
  if (width < breakpointValues.mobile) return 'mobile';
  if (width <= breakpointValues.tablet) return 'tablet';
  return 'desktop';
}

/**
 * Configures window.matchMedia to simulate a viewport of the given width.
 * Tailwind breakpoints are min-width based, so `(min-width: Xpx)` matches
 * when width ≥ X.
 */
function mockMatchMedia(width: number): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string): MediaQueryList => {
      // Parse min-width from the query, e.g. "(min-width: 640px)"
      const minWidthMatch = /\(min-width:\s*(\d+)px\)/.exec(query);
      const matches = minWidthMatch ? width >= Number(minWidthMatch[1]) : false;

      return {
        matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
      };
    },
  );
}

// --- Arbitraries ------------------------------------------------------------

/** Generates screen widths in the mobile range: 1–639px. */
const mobileWidthArb = fc.integer({ min: 1, max: breakpointValues.mobile - 1 });

/** Generates screen widths in the tablet range: 640–1024px. */
const tabletWidthArb = fc.integer({
  min: breakpointValues.mobile,
  max: breakpointValues.tablet,
});

/** Generates screen widths in the desktop range: 1025–3840px (4K). */
const desktopWidthArb = fc.integer({
  min: breakpointValues.tablet + 1,
  max: 3840,
});

/** Generates any reasonable screen width: 1–3840px. */
const anyWidthArb = fc.integer({ min: 1, max: 3840 });

// --- Tests ------------------------------------------------------------------

describe('DashboardLayout Property Tests — Responsive Breakpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Property 5.1: Width classification is exhaustive and mutually exclusive.
   * Every positive integer width maps to exactly one layout mode.
   * **Validates: Requirements 5.2**
   */
  it('classifies every screen width into exactly one layout mode', () => {
    fc.assert(
      fc.property(anyWidthArb, (width) => {
        const mode = classifyWidth(width);
        const validModes: LayoutMode[] = ['mobile', 'tablet', 'desktop'];
        expect(validModes).toContain(mode);

        // Verify mutual exclusivity — only one condition is true
        const isMobile = width < breakpointValues.mobile;
        const isTablet = width >= breakpointValues.mobile && width <= breakpointValues.tablet;
        const isDesktop = width > breakpointValues.tablet;
        const trueCount = [isMobile, isTablet, isDesktop].filter(Boolean).length;
        expect(trueCount).toBe(1);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Property 5.2: Breakpoint boundaries are correctly placed.
   * The mobile→tablet transition happens at exactly 640px and
   * the tablet→desktop transition happens at exactly 1025px.
   * **Validates: Requirements 5.2**
   */
  it('transitions at the correct breakpoint boundaries', () => {
    // Just below mobile breakpoint → mobile
    expect(classifyWidth(breakpointValues.mobile - 1)).toBe('mobile');
    // At mobile breakpoint → tablet
    expect(classifyWidth(breakpointValues.mobile)).toBe('tablet');
    // At tablet breakpoint → tablet
    expect(classifyWidth(breakpointValues.tablet)).toBe('tablet');
    // Just above tablet breakpoint → desktop
    expect(classifyWidth(breakpointValues.tablet + 1)).toBe('desktop');
  });

  /**
   * Property 5.3: For any mobile width, the DashboardLayout renders
   * bottom navigation (visible) and hides the sidebar.
   * **Validates: Requirements 5.2**
   */
  it('renders bottom navigation for mobile widths', () => {
    fc.assert(
      fc.property(mobileWidthArb, (width) => {
        mockMatchMedia(width);
        Object.defineProperty(window, 'innerWidth', { value: width, writable: true });

        const { unmount } = render(
          <DashboardLayout>
            <p>Content</p>
          </DashboardLayout>,
        );

        // Sidebar (aside) exists but has 'hidden' class on mobile
        const aside = document.querySelector('aside[aria-label="Main navigation"]');
        expect(aside).not.toBeNull();
        expect(aside!.className).toContain('hidden');
        // Sidebar becomes visible only at mobile breakpoint via mobile:flex
        expect(aside!.className).toContain('mobile:flex');

        // Bottom nav element exists and uses mobile:hidden (hidden at ≥640px)
        // so it is visible below 640px. It does NOT have a standalone 'hidden' class.
        const bottomNav = document.querySelector('nav[aria-label="Main navigation"]');
        expect(bottomNav).not.toBeNull();
        const bottomNavClasses = bottomNav!.className.split(/\s+/);
        expect(bottomNavClasses).not.toContain('hidden');
        expect(bottomNav!.className).toContain('mobile:hidden');

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 5.4: For any tablet/desktop width, the DashboardLayout renders
   * sidebar navigation. The sidebar uses mobile:flex to become visible at ≥640px.
   * **Validates: Requirements 5.2**
   */
  it('renders sidebar navigation for tablet and desktop widths', () => {
    fc.assert(
      fc.property(
        fc.oneof(tabletWidthArb, desktopWidthArb),
        (width) => {
          mockMatchMedia(width);
          Object.defineProperty(window, 'innerWidth', { value: width, writable: true });

          const { unmount } = render(
            <DashboardLayout>
              <p>Content</p>
            </DashboardLayout>,
          );

          // Sidebar aside element exists with responsive classes
          const aside = document.querySelector('aside[aria-label="Main navigation"]');
          expect(aside).not.toBeNull();
          // Has mobile:flex class — visible at ≥640px
          expect(aside!.className).toContain('mobile:flex');

          // Bottom nav has mobile:hidden — hidden at ≥640px
          const bottomNav = document.querySelector('nav[aria-label="Main navigation"]');
          expect(bottomNav).not.toBeNull();
          expect(bottomNav!.className).toContain('mobile:hidden');

          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 5.5: For any desktop width (>1024px), the sidebar shows full labels.
   * The tablet:w-64 class enables the wider sidebar, and tablet:inline shows labels.
   * **Validates: Requirements 5.2**
   */
  it('sidebar has wide layout classes for desktop widths', () => {
    fc.assert(
      fc.property(desktopWidthArb, (width) => {
        mockMatchMedia(width);
        Object.defineProperty(window, 'innerWidth', { value: width, writable: true });

        const { unmount } = render(
          <DashboardLayout>
            <p>Content</p>
          </DashboardLayout>,
        );

        const aside = document.querySelector('aside[aria-label="Main navigation"]');
        expect(aside).not.toBeNull();
        // Wide sidebar class for tablet+ breakpoint
        expect(aside!.className).toContain('tablet:w-64');

        // Nav item labels use tablet:inline to show text at ≥1024px
        const labelSpans = aside!.querySelectorAll('span.hidden.tablet\\:inline');
        expect(labelSpans.length).toBe(5); // 5 nav items

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 5.6: Breakpoint token values match the Tailwind config contract.
   * mobile=640, tablet=1024 — ensuring tokens and layout stay in sync.
   * **Validates: Requirements 5.2**
   */
  it('breakpoint token values match the required specification', () => {
    expect(breakpointValues.mobile).toBe(640);
    expect(breakpointValues.tablet).toBe(1024);
    // Requirement says mobile (<640), tablet (640-1024), desktop (>1024)
    // Verify the classification aligns with the requirement
    fc.assert(
      fc.property(anyWidthArb, (width) => {
        const mode = classifyWidth(width);
        if (width < 640) expect(mode).toBe('mobile');
        else if (width <= 1024) expect(mode).toBe('tablet');
        else expect(mode).toBe('desktop');
      }),
      { numRuns: 200 },
    );
  });
});
