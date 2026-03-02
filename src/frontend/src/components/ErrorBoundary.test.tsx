import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ErrorFallbackProps } from './ErrorBoundary';
import { ErrorBoundary } from './ErrorBoundary';

// --- Helpers ---------------------------------------------------------------

/** A component that throws on render to trigger the error boundary. */
function ThrowingChild({ message = 'boom' }: { message?: string }): React.JSX.Element {
  throw new Error(message);
}

/** Suppress React / jsdom error logging during expected error boundary tests. */
function suppressConsoleErrors(): () => void {
  const originalError = console.error;
  console.error = vi.fn();
  return () => {
    console.error = originalError;
  };
}

// --- Tests -----------------------------------------------------------------

describe('ErrorBoundary', () => {
  let restoreConsole: () => void;

  afterEach(() => {
    restoreConsole?.();
    vi.restoreAllMocks();
  });

  // Req 9.1 — Catch rendering errors and display fallback UI
  describe('catches rendering errors', () => {
    it('renders children when no error occurs', () => {
      render(
        <ErrorBoundary>
          <p>All good</p>
        </ErrorBoundary>,
      );

      expect(screen.getByText('All good')).toBeInTheDocument();
    });

    it('displays default fallback UI when a child throws', () => {
      restoreConsole = suppressConsoleErrors();

      render(
        <ErrorBoundary>
          <ThrowingChild />
        </ErrorBoundary>,
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });
  });

  // Req 9.2 — Log errors to observability
  describe('error logging', () => {
    it('calls onError callback with the error and error info', () => {
      restoreConsole = suppressConsoleErrors();
      const onError = vi.fn();

      render(
        <ErrorBoundary onError={onError}>
          <ThrowingChild message="test error" />
        </ErrorBoundary>,
      );

      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(onError.mock.calls[0][0].message).toBe('test error');
      // Second arg is React ErrorInfo with componentStack
      expect(onError.mock.calls[0][1]).toHaveProperty('componentStack');
    });
  });

  // Req 9.3 — Provide a "Try Again" option
  describe('try again', () => {
    it('renders a "Try Again" button in the default fallback', () => {
      restoreConsole = suppressConsoleErrors();

      render(
        <ErrorBoundary>
          <ThrowingChild />
        </ErrorBoundary>,
      );

      expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    });

    it('resets error state when "Try Again" is clicked', async () => {
      restoreConsole = suppressConsoleErrors();
      const user = userEvent.setup();
      let shouldThrow = true;

      function ConditionalChild(): React.JSX.Element {
        if (shouldThrow) {
          throw new Error('boom');
        }
        return <p>Recovered</p>;
      }

      render(
        <ErrorBoundary>
          <ConditionalChild />
        </ErrorBoundary>,
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();

      // Fix the child before clicking retry
      shouldThrow = false;
      await user.click(screen.getByRole('button', { name: 'Try Again' }));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText('Recovered')).toBeInTheDocument();
    });

    it('calls onReset callback when "Try Again" is clicked', async () => {
      restoreConsole = suppressConsoleErrors();
      const user = userEvent.setup();
      const onReset = vi.fn();
      let shouldThrow = true;

      function ConditionalChild(): React.JSX.Element {
        if (shouldThrow) {
          throw new Error('boom');
        }
        return <p>Recovered</p>;
      }

      render(
        <ErrorBoundary onReset={onReset}>
          <ConditionalChild />
        </ErrorBoundary>,
      );

      shouldThrow = false;
      await user.click(screen.getByRole('button', { name: 'Try Again' }));

      expect(onReset).toHaveBeenCalledOnce();
    });
  });

  // Req 9.4 — User-friendly messages without technical details
  describe('user-friendly messages', () => {
    it('does not expose the error message in the default fallback', () => {
      restoreConsole = suppressConsoleErrors();

      render(
        <ErrorBoundary>
          <ThrowingChild message="SECRET_INTERNAL_ERROR_42" />
        </ErrorBoundary>,
      );

      expect(screen.queryByText('SECRET_INTERNAL_ERROR_42')).not.toBeInTheDocument();
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });
  });

  // Req 9.5 — Preserve application state during error recovery
  describe('state preservation', () => {
    it('preserves sibling state after error recovery', async () => {
      restoreConsole = suppressConsoleErrors();
      const user = userEvent.setup();
      let shouldThrow = true;

      function ConditionalChild(): React.JSX.Element {
        if (shouldThrow) {
          throw new Error('boom');
        }
        return <p>Child OK</p>;
      }

      // The ErrorBoundary only resets its own hasError/error state,
      // so external state (e.g. Zustand stores, context) is preserved.
      const onReset = vi.fn();

      render(
        <div>
          <p>Sibling content</p>
          <ErrorBoundary onReset={onReset}>
            <ConditionalChild />
          </ErrorBoundary>
        </div>,
      );

      // Sibling is still rendered while boundary shows fallback
      expect(screen.getByText('Sibling content')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();

      shouldThrow = false;
      await user.click(screen.getByRole('button', { name: 'Try Again' }));

      expect(screen.getByText('Sibling content')).toBeInTheDocument();
      expect(screen.getByText('Child OK')).toBeInTheDocument();
    });
  });

  // Req 9.6 — Support different fallback UIs for different error types
  describe('custom fallback', () => {
    it('renders a ReactNode fallback when provided', () => {
      restoreConsole = suppressConsoleErrors();

      render(
        <ErrorBoundary fallback={<div data-testid="custom">Custom error UI</div>}>
          <ThrowingChild />
        </ErrorBoundary>,
      );

      expect(screen.getByTestId('custom')).toBeInTheDocument();
      expect(screen.getByText('Custom error UI')).toBeInTheDocument();
    });

    it('renders a fallback render function with error and resetError', async () => {
      restoreConsole = suppressConsoleErrors();
      const user = userEvent.setup();
      let shouldThrow = true;

      function ConditionalChild(): React.JSX.Element {
        if (shouldThrow) {
          throw new Error('boom');
        }
        return <p>Recovered</p>;
      }

      function CustomFallback({ error, resetError }: ErrorFallbackProps): React.JSX.Element {
        return (
          <div data-testid="render-fallback">
            <p>Error type: {error.constructor.name}</p>
            <button onClick={resetError}>Retry</button>
          </div>
        );
      }

      render(
        <ErrorBoundary fallback={CustomFallback}>
          <ConditionalChild />
        </ErrorBoundary>,
      );

      expect(screen.getByTestId('render-fallback')).toBeInTheDocument();
      expect(screen.getByText('Error type: Error')).toBeInTheDocument();

      shouldThrow = false;
      await user.click(screen.getByRole('button', { name: 'Retry' }));

      expect(screen.getByText('Recovered')).toBeInTheDocument();
    });
  });
});
