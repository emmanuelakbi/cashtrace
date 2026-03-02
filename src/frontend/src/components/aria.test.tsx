import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
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
  useGlobalStore: (selector: (state: { isOnline: boolean; unreadCount: number }) => unknown) =>
    selector({ isOnline: false, unreadCount: 0 }),
  selectIsOnline: (state: { isOnline: boolean }) => state.isOnline,
  selectUnreadCount: (state: { unreadCount: number }) => state.unreadCount,
}));

const mockPromptInstall = vi.fn().mockResolvedValue(undefined);
vi.mock('../hooks/useInstallPrompt', () => ({
  useInstallPrompt: () => ({
    canInstall: true,
    isInstalled: false,
    promptInstall: mockPromptInstall,
  }),
}));

import { ErrorBoundary } from './ErrorBoundary';
import { InstallPromptBanner } from './InstallPromptBanner';
import { ProgressBar } from './Loading/ProgressBar';
import { Skeleton } from './Loading/Skeleton';
import { Spinner } from './Loading/Spinner';
import { LoadingButton } from './Loading/LoadingButton';
import { OfflineIndicator } from './OfflineIndicator';
import { ToastItem } from './Toast/ToastItem';
import { ToastContainer } from './Toast/ToastContainer';
import { useToastStore, toast } from './Toast/toastStore';
import type { Toast as ToastType } from './Toast/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToast(overrides?: Partial<ToastType>): ToastType {
  return {
    id: 'aria-test-1',
    type: 'info',
    title: 'Test notification',
    createdAt: Date.now(),
    ...overrides,
  };
}

function ThrowingChild(): React.JSX.Element {
  throw new Error('test error');
}

function suppressConsoleErrors(): () => void {
  const originalError = console.error;
  console.error = vi.fn();
  return () => {
    console.error = originalError;
  };
}

// ---------------------------------------------------------------------------
// Tests — Req 13.2: ARIA labels and roles for all interactive elements
// ---------------------------------------------------------------------------

describe('ARIA attributes (Req 13.2)', () => {
  describe('ToastContainer', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      useToastStore.setState({ toasts: [] });
    });

    afterEach(() => {
      toast.dismissAll();
      vi.useRealTimers();
    });

    it('has role="region" and aria-live="polite" on the container', () => {
      act(() => {
        toast.show({ type: 'info', title: 'Test' });
      });

      render(<ToastContainer />);

      const container = screen.getByTestId('toast-container');
      expect(container).toHaveAttribute('role', 'region');
      expect(container).toHaveAttribute('aria-live', 'polite');
      expect(container).toHaveAttribute('aria-label', 'Notifications');
      expect(container).toHaveAttribute('aria-relevant', 'additions removals');
    });
  });

  describe('ToastItem', () => {
    it('has role="alert" and aria-atomic="true"', () => {
      const t = makeToast();
      render(<ToastItem toast={t} onDismiss={vi.fn()} />);

      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('aria-atomic', 'true');
    });

    it('has aria-live="assertive" for error toasts', () => {
      const t = makeToast({ type: 'error' });
      render(<ToastItem toast={t} onDismiss={vi.fn()} />);

      expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
    });

    it('has aria-live="polite" for non-error toasts', () => {
      const t = makeToast({ type: 'success' });
      render(<ToastItem toast={t} onDismiss={vi.fn()} />);

      expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'polite');
    });

    it('dismiss button has descriptive aria-label', () => {
      const t = makeToast({ type: 'warning', title: 'Low balance' });
      render(<ToastItem toast={t} onDismiss={vi.fn()} />);

      expect(
        screen.getByLabelText('Dismiss warning notification: Low balance'),
      ).toBeInTheDocument();
    });

    it('hides decorative icon from screen readers', () => {
      const t = makeToast();
      render(<ToastItem toast={t} onDismiss={vi.fn()} />);

      const alert = screen.getByRole('alert');
      const icons = alert.querySelectorAll('[aria-hidden="true"]');
      expect(icons.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Skeleton', () => {
    it('has role="status" and aria-busy="true"', () => {
      render(<Skeleton />);

      const el = screen.getByRole('status');
      expect(el).toHaveAttribute('aria-busy', 'true');
      expect(el).toHaveAttribute('aria-label', 'Loading content');
    });

    it('accepts custom aria-label', () => {
      render(<Skeleton aria-label="Loading transactions" />);

      expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading transactions');
    });

    it('has sr-only text for screen readers', () => {
      render(<Skeleton aria-label="Loading data" />);

      expect(screen.getByText('Loading data')).toBeInTheDocument();
    });
  });

  describe('Spinner', () => {
    it('has role="status" and aria-label', () => {
      render(<Spinner />);

      const el = screen.getByRole('status');
      expect(el).toHaveAttribute('aria-label', 'Loading');
    });

    it('hides SVG from screen readers', () => {
      render(<Spinner />);

      const svg = screen.getByRole('status').querySelector('svg');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    });

    it('has sr-only text matching the label', () => {
      render(<Spinner label="Processing" />);

      expect(screen.getByText('Processing')).toBeInTheDocument();
    });
  });

  describe('ProgressBar', () => {
    it('has role="progressbar" with aria-valuemin and aria-valuemax', () => {
      render(<ProgressBar value={50} />);

      const bar = screen.getByRole('progressbar');
      expect(bar).toHaveAttribute('aria-valuemin', '0');
      expect(bar).toHaveAttribute('aria-valuemax', '100');
    });

    it('has aria-valuenow in determinate mode', () => {
      render(<ProgressBar mode="determinate" value={75} />);

      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');
    });

    it('omits aria-valuenow in indeterminate mode', () => {
      render(<ProgressBar mode="indeterminate" />);

      expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    });

    it('has aria-busy when incomplete', () => {
      render(<ProgressBar value={30} />);

      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-busy', 'true');
    });

    it('has aria-label', () => {
      render(<ProgressBar label="Upload progress" value={50} />);

      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', 'Upload progress');
    });
  });

  describe('LoadingButton', () => {
    it('has aria-busy="true" when loading', () => {
      render(<LoadingButton loading>Submit</LoadingButton>);

      const btn = screen.getByRole('button');
      expect(btn).toHaveAttribute('aria-busy', 'true');
    });

    it('has aria-busy="false" when not loading', () => {
      render(<LoadingButton loading={false}>Submit</LoadingButton>);

      const btn = screen.getByRole('button');
      expect(btn).toHaveAttribute('aria-busy', 'false');
    });

    it('has aria-disabled when loading or disabled', () => {
      render(<LoadingButton loading>Submit</LoadingButton>);

      expect(screen.getByRole('button')).toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('ErrorBoundary — DefaultFallback', () => {
    let restoreConsole: () => void;

    afterEach(() => {
      restoreConsole?.();
    });

    it('has role="alert" and aria-live="assertive"', () => {
      restoreConsole = suppressConsoleErrors();

      render(
        <ErrorBoundary>
          <ThrowingChild />
        </ErrorBoundary>,
      );

      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('aria-live', 'assertive');
      expect(alert).toHaveAttribute('aria-atomic', 'true');
    });

    it('hides decorative SVG from screen readers', () => {
      restoreConsole = suppressConsoleErrors();

      render(
        <ErrorBoundary>
          <ThrowingChild />
        </ErrorBoundary>,
      );

      const svg = screen.getByRole('alert').querySelector('svg');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('OfflineIndicator', () => {
    it('has role="alert" and aria-live="assertive"', () => {
      render(<OfflineIndicator />);

      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('aria-live', 'assertive');
    });

    it('hides decorative SVG from screen readers', () => {
      render(<OfflineIndicator />);

      const svg = screen.getByRole('alert').querySelector('svg');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('InstallPromptBanner', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('has role="banner" and aria-label', () => {
      render(<InstallPromptBanner />);

      const banner = screen.getByRole('banner');
      expect(banner).toHaveAttribute('aria-label', 'Install application');
    });

    it('install button has descriptive aria-label', () => {
      render(<InstallPromptBanner />);

      expect(
        screen.getByRole('button', { name: 'Install CashTrace application' }),
      ).toBeInTheDocument();
    });

    it('dismiss button has descriptive aria-label', () => {
      render(<InstallPromptBanner />);

      expect(
        screen.getByRole('button', { name: 'Dismiss install banner' }),
      ).toBeInTheDocument();
    });
  });
});
