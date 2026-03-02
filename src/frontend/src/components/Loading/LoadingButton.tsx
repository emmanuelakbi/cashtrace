'use client';

import type { FC } from 'react';

import { Spinner } from './Spinner';
import type { LoadingButtonProps } from './types';

/**
 * Button that displays a spinner and prevents duplicate clicks while loading.
 *
 * Satisfies Requirements 8.2 (spinner for button actions), 8.4 (prevent duplicate submissions),
 * 8.6 (ARIA attributes).
 */
export const LoadingButton: FC<LoadingButtonProps> = ({
  loading,
  children,
  onClick,
  type = 'button',
  disabled = false,
  className = '',
}) => {
  const isDisabled = loading || disabled;

  return (
    <button
      type={type}
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      aria-busy={loading}
      aria-disabled={isDisabled}
      className={[
        'relative inline-flex items-center justify-center gap-2 rounded px-4 py-2',
        'text-sm font-medium transition-opacity',
        'bg-teal-600 text-white dark:bg-teal-500',
        'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2',
        isDisabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-teal-700 dark:hover:bg-teal-600',
        className,
      ].join(' ')}
      data-testid="loading-button"
    >
      {loading && <Spinner size="sm" label="Submitting" />}
      <span className={loading ? 'opacity-70' : ''}>{children}</span>
    </button>
  );
};
