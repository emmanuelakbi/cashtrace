'use client';

import type { FC } from 'react';

import type { ProgressBarProps } from './types';

/**
 * Progress bar component for file uploads and long-running operations.
 *
 * Supports determinate (specific value) and indeterminate (continuous animation) modes.
 *
 * Satisfies Requirements 8.3 (progress bars), 8.6 (ARIA attributes).
 */
export const ProgressBar: FC<ProgressBarProps> = ({
  mode = 'determinate',
  value = 0,
  label = 'Progress',
  className = '',
}) => {
  const clampedValue = Math.min(100, Math.max(0, value));

  return (
    <div className={`w-full ${className}`} data-testid="progress-bar">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={mode === 'determinate' ? clampedValue : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-busy={mode === 'indeterminate' || clampedValue < 100}
        className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
      >
        {mode === 'determinate' ? (
          <div
            className="h-full rounded-full bg-teal-600 transition-[width] duration-300 ease-in-out dark:bg-teal-400"
            style={{ width: `${clampedValue}%` }}
            data-testid="progress-bar-fill"
          />
        ) : (
          <div
            className="h-full w-1/3 animate-[indeterminate_1.5s_ease-in-out_infinite] rounded-full bg-teal-600 dark:bg-teal-400"
            data-testid="progress-bar-fill"
          />
        )}
      </div>
    </div>
  );
};
