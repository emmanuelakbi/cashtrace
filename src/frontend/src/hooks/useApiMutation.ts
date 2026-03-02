/**
 * Generic mutation hook wrapping TanStack Query's useMutation with the CashTrace API client.
 *
 * Supports POST, PUT, and DELETE methods with type-safe request/response generics.
 *
 * Requirements: 16.5
 */

import {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';

import { apiClient, type RequestOptions } from '../lib/api';

type HttpMethod = 'POST' | 'PUT' | 'DELETE';

/**
 * Variables passed to the mutation function at call time.
 * For DELETE requests, `data` is optional.
 */
export interface MutationVariables<TBody = unknown> {
  data?: TBody;
  requestOptions?: RequestOptions;
}

/**
 * Options for `useApiMutation`, extending React Query's mutation options
 * with API-specific fields.
 */
export interface UseApiMutationOptions<TData, TBody = unknown>
  extends Omit<
    UseMutationOptions<TData, Error, MutationVariables<TBody>>,
    'mutationFn'
  > {
  /** API path (e.g. `/api/transactions`). */
  path: string;
  /** HTTP method — defaults to `'POST'`. */
  method?: HttpMethod;
}

/**
 * Performs a mutation (POST/PUT/DELETE) against the CashTrace API.
 *
 * @example
 * ```ts
 * const { mutate } = useApiMutation<Transaction, CreateTransactionDto>({
 *   path: '/api/transactions',
 *   method: 'POST',
 *   onSuccess: () => queryClient.invalidateQueries({ queryKey: ['transactions'] }),
 * });
 *
 * mutate({ data: { amount: 50000, description: 'Office supplies' } });
 * ```
 */
export function useApiMutation<TData, TBody = unknown>(
  options: UseApiMutationOptions<TData, TBody>,
): UseMutationResult<TData, Error, MutationVariables<TBody>> {
  const { path, method = 'POST', ...mutationOptions } = options;

  return useMutation<TData, Error, MutationVariables<TBody>>({
    ...mutationOptions,
    mutationFn: (variables: MutationVariables<TBody>) => {
      const { data, requestOptions } = variables;

      switch (method) {
        case 'POST':
          return apiClient.post<TData>(path, data, requestOptions);
        case 'PUT':
          return apiClient.put<TData>(path, data, requestOptions);
        case 'DELETE':
          return apiClient.delete<TData>(path, requestOptions);
      }
    },
  });
}
