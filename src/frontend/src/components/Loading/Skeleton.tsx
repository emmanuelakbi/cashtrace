'use client';

import type { FC } from 'react';

import type { SkeletonProps } from './types';

/**
 * Skeleton loader component for content placeholders during data fetching.
 *
 * Supports rectangular, circular, and text variants.
 * Uses a shimmer animation to indicate loading.
 *
 * Satisfies Requirements 8.1 (skeleton loaders), 8.6 (ARIA attributes).
 */
export const Skeleton: FC<SkeletonProps> = ({
  variant = 'rectangular',
  width,
  height,
  className = '',
  'aria-label': ariaLabel = 'Loading content',
}) => {
  const baseClasses = 'animate-pulse bg-gray-200 dark:bg-gray-700';

  const variantClasses: Record<string, string> = {
    rectangular: 'rounded',
    circular: 'rounded-full',
    text: 'rounded',
  };

  const defaultDimensions: Record<string, { width: string; height: string }> = {
    rectangular: { width: '100%', height: '1rem' },
    circular: { width: '2.5rem', height: '2.5rem' },
    text: { width: '100%', height: '0.875rem' },
  };

  const dims = defaultDimensions[variant];

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={ariaLabel}
      className={`${baseClasses} ${variantClasses[variant]} ${className}`}
      style={{
        width: width ?? dims.width,
        height: height ?? dims.height,
      }}
      data-testid="skeleton"
    >
      <span className="sr-only">{ariaLabel}</span>
    </div>
  );
};
