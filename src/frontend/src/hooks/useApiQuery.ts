/**
 * Generic query hook wrapping TanStack Query's useQuery with the CashTrace API client.
 *
 * Provides a type-safe wrapper that automatically uses `apiClient.get` for data fetching,
 * with full access to React Query's caching, refetching, and stale-time behaviour.
 *
 * Requirements: 16.5
 */

import {
  useQuery,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query';

import { apiClient, type RequestOptions } from '../lib/api';

/**
 * Options for `useApiQuery`, extending React Query's options with API-specific fields.
 * Omits `queryFn` since it is built from `path` + `requestOptions`.
 */
export interface UseApiQueryOptions<TData>
  extends Omit<UseQueryOptions<TData, Error>, 'queryFn'> {
  /** API path to GET (e.g. `/api/auth/me`). */
  path: string;
  /** Additional options forwarded to `apiClient.get`. */
  requestOptions?: RequestOptions;
}

/**
 * Fetches data from the CashTrace API via GET and caches the result with React Query.
 *
 * @example
 * ```ts
 * const { data, isLoading } = useApiQuery<User>({
 *   queryKey: ['user', 'me'],
 *   path: '/api/auth/me',
 * });
 * ```
 */
export function useApiQuery<TData>(
  options: UseApiQueryOptions<TData>,
): UseQueryResult<TData, Error> {
  const { path, requestOptions, ...queryOptions } = options;

  return useQuery<TData, Error>({
    ...queryOptions,
    queryFn: () => apiClient.get<TData>(path, requestOptions),
  });
}
