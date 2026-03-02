'use client';

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

/**
 * Props accepted by the ErrorBoundary component.
 */
export interface ErrorBoundaryProps {
  /** Normal content to render. */
  children: ReactNode;
  /** Optional custom fallback UI rendered when an error is caught. */
  fallback?: ReactNode | ((props: ErrorFallbackProps) => ReactNode);
  /** Optional callback invoked when an error is caught (for observability). */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Optional callback invoked when the user clicks "Try Again". */
  onReset?: () => void;
}

/**
 * Props passed to a fallback render function.
 */
export interface ErrorFallbackProps {
  /** The error that was caught. */
  error: Error;
  /** Resets the error boundary, re-rendering children. */
  resetError: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary catches React rendering errors and displays a user-friendly
 * fallback UI. It logs errors via a configurable `onError` callback for
 * observability integration and provides a "Try Again" button to reset.
 *
 * Must be a class component — React error boundaries require
 * `getDerivedStateFromError` and `componentDidCatch`.
 *
 * @see Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  /** Req 9.1 — Catch rendering errors and transition to error state. */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  /** Req 9.2 — Log errors to observability via the onError callback. */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
  }

  /**
   * Req 9.3 / 9.5 — Reset error state so children re-render.
   * Preserves application state by only clearing the error boundary state.
   */
  resetError = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback } = this.props;

    if (!hasError || !error) {
      return children;
    }

    // Req 9.6 — Support custom fallback UIs for different error types.
    if (typeof fallback === 'function') {
      return fallback({ error, resetError: this.resetError });
    }

    if (fallback !== undefined) {
      return fallback;
    }

    // Req 9.4 — Default fallback: user-friendly message, no technical details.
    return <DefaultFallback resetError={this.resetError} />;
  }
}

/**
 * Default fallback UI shown when no custom fallback is provided.
 * Displays a friendly message and a "Try Again" button.
 */
function DefaultFallback({ resetError }: { resetError: () => void }): React.JSX.Element {
  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="flex min-h-[200px] flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <div className="rounded-full bg-red-100 p-3">
        <svg
          className="h-6 w-6 text-red-600"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
          />
        </svg>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900">Something went wrong</h2>
        <p className="mt-1 text-sm text-gray-500">
          We encountered an unexpected issue. Please try again.
        </p>
      </div>

      <button
        type="button"
        onClick={resetError}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        Try Again
      </button>
    </div>
  );
}
