import { render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useGlobalStore } from '../store/index';

import { OfflineIndicator } from './OfflineIndicator';

// Reset store state between tests
afterEach(() => {
  useGlobalStore.setState({ isOnline: true });
});

describe('OfflineIndicator', () => {
  // Req 10.1 — Display network status prominently when offline
  describe('visibility', () => {
    it('renders nothing when online', () => {
      useGlobalStore.setState({ isOnline: true });

      const { container } = render(<OfflineIndicator />);

      expect(container.firstChild).toBeNull();
    });

    it('renders a visible banner when offline', () => {
      act(() => useGlobalStore.setState({ isOnline: false }));

      render(<OfflineIndicator />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('You are offline')).toBeInTheDocument();
    });
  });

  // Req 13.2 — ARIA live region for accessibility
  describe('accessibility', () => {
    it('uses an ARIA live region with assertive politeness', () => {
      act(() => useGlobalStore.setState({ isOnline: false }));

      render(<OfflineIndicator />);

      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('aria-live', 'assertive');
    });

    it('hides the decorative icon from screen readers', () => {
      act(() => useGlobalStore.setState({ isOnline: false }));

      render(<OfflineIndicator />);

      const svg = screen.getByRole('alert').querySelector('svg');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    });
  });

  // Reactivity — banner appears/disappears as connectivity changes
  describe('reactivity', () => {
    it('shows banner when transitioning from online to offline', () => {
      act(() => useGlobalStore.setState({ isOnline: true }));

      const { rerender } = render(<OfflineIndicator />);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      act(() => useGlobalStore.setState({ isOnline: false }));
      rerender(<OfflineIndicator />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('hides banner when transitioning from offline to online', () => {
      act(() => useGlobalStore.setState({ isOnline: false }));

      const { rerender } = render(<OfflineIndicator />);
      expect(screen.getByRole('alert')).toBeInTheDocument();

      act(() => useGlobalStore.setState({ isOnline: true }));
      rerender(<OfflineIndicator />);

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
