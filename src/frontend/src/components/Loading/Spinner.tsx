'use client';

import type { FC } from 'react';

import type { SpinnerProps } from './types';
import { SPINNER_SIZES } from './types';

/**
 * Spinner indicator for button actions and inline loading states.
 *
 * Satisfies Requirements 8.2 (spinner indicators), 8.6 (ARIA attributes).
 */
export const Spinner: FC<SpinnerProps> = ({
  size = 'md',
  label = 'Loading',
  className = '',
}) => {
  return (
    <div
      role="status"
      aria-label={label}
      className={`inline-flex items-center justify-center ${className}`}
      data-testid="spinner"
    >
      <svg
        className={`animate-spin text-current ${SPINNER_SIZES[size]}`}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </div>
  );
};
