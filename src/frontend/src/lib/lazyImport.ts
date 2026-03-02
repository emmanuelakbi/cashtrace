'use client';

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import { createElement } from 'react';

import { Skeleton } from '../components/Loading/Skeleton';

/**
 * Options for the lazyImport utility.
 */
export interface LazyImportOptions {
  /** Whether to disable server-side rendering for this component. Defaults to true. */
  ssr?: boolean;
  /** Accessible label for the loading skeleton. */
  loadingLabel?: string;
}

/**
 * Wraps `next/dynamic` to lazily import a component with a Skeleton loading fallback.
 *
 * Next.js App Router handles route-based code splitting automatically. This utility
 * is for dynamically importing heavy components *within* pages (e.g., charts, editors)
 * to keep initial page bundles small.
 *
 * Satisfies Requirement 14.1 (code splitting for route-based lazy loading).
 *
 * @param importFn - A function returning a dynamic `import()` of the component module.
 * @param options  - Optional configuration for SSR and loading state.
 * @returns A lazy-loaded component that shows a Skeleton while loading.
 *
 * @example
 * ```ts
 * const Chart = lazyImport(() => import('../components/Chart.js'));
 * ```
 */
export function lazyImport<P extends Record<string, unknown>>(
  importFn: () => Promise<{ default: ComponentType<P> }>,
  options: LazyImportOptions = {},
): ComponentType<P> {
  const { ssr = false, loadingLabel = 'Loading component' } = options;

  return dynamic(importFn, {
    ssr,
    loading: () =>
      createElement(Skeleton, {
        variant: 'rectangular',
        width: '100%',
        height: '12rem',
        'aria-label': loadingLabel,
      }),
  });
}
