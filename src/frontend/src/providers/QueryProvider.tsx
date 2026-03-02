'use client';

/**
 * React Query provider for CashTrace.
 *
 * Configures TanStack Query with sensible defaults for a Nigerian SME app:
 * - 5-minute stale time (reduces unnecessary refetches on slow networks)
 * - 10-minute garbage collection time
 * - Refetch on window focus (catches stale data after tab switch)
 * - Refetch on reconnect (critical for intermittent connectivity)
 * - Single retry for queries, no retry for mutations
 *
 * Requirements: 16.5
 */

import { useState } from 'react';

import {
  QueryClient,
  QueryClientProvider,
  type QueryClientConfig,
} from '@tanstack/react-query';

import { ApiError } from '../lib/api';

/** 5 minutes — balances freshness with network efficiency. */
const DEFAULT_STALE_TIME_MS = 5 * 60 * 1000;

/** 10 minutes — keep unused data in cache a bit longer for back-navigation. */
const DEFAULT_GC_TIME_MS = 10 * 60 * 1000;

/**
 * Determines whether a failed query should be retried.
 * Skips retry for 4xx client errors (except 408 Request Timeout and 429 Too Many Requests).
 */
function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;

  if (error instanceof ApiError) {
    const { status } = error;
    // Don't retry client errors (except timeout and rate-limit)
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
      return false;
    }
  }

  return true;
}

const queryClientConfig: QueryClientConfig = {
  defaultOptions: {
    queries: {
      staleTime: DEFAULT_STALE_TIME_MS,
      gcTime: DEFAULT_GC_TIME_MS,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchOnMount: true,
      retry: shouldRetryQuery,
    },
    mutations: {
      retry: false,
    },
  },
};

interface QueryProviderProps {
  children: React.ReactNode;
  /** Override the default QueryClient (useful for testing). */
  client?: QueryClient;
}

export function QueryProvider({ children, client }: QueryProviderProps): React.JSX.Element {
  const [queryClient] = useState(() => client ?? new QueryClient(queryClientConfig));

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export { DEFAULT_STALE_TIME_MS, DEFAULT_GC_TIME_MS };
