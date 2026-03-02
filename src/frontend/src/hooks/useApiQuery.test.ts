import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { apiClient } from '../lib/api';

import { useApiQuery } from './useApiQuery';

vi.mock('../lib/api.js', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  },
}));

const mockedGet = vi.mocked(apiClient.get);

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

interface TestUser {
  id: string;
  name: string;
  email: string;
}

describe('useApiQuery', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  it('should fetch data using apiClient.get', async () => {
    const mockUser: TestUser = { id: '1', name: 'Chidi', email: 'chidi@example.com' };
    mockedGet.mockResolvedValueOnce(mockUser);

    const { result } = renderHook(
      () =>
        useApiQuery<TestUser>({
          queryKey: ['user', 'me'],
          path: '/api/auth/me',
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedGet).toHaveBeenCalledWith('/api/auth/me', undefined);
    expect(result.current.data).toEqual(mockUser);
  });

  it('should pass requestOptions to apiClient.get', async () => {
    mockedGet.mockResolvedValueOnce({ id: '1' });

    const requestOptions = { timeout: 5000, headers: { 'X-Custom': 'value' } };

    const { result } = renderHook(
      () =>
        useApiQuery<{ id: string }>({
          queryKey: ['item'],
          path: '/api/items/1',
          requestOptions,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedGet).toHaveBeenCalledWith('/api/items/1', requestOptions);
  });

  it('should return loading state initially', () => {
    mockedGet.mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(
      () =>
        useApiQuery<TestUser>({
          queryKey: ['user', 'pending'],
          path: '/api/auth/me',
        }),
      { wrapper: createWrapper(queryClient) },
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('should return error state on failure', async () => {
    mockedGet.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(
      () =>
        useApiQuery<TestUser>({
          queryKey: ['user', 'error'],
          path: '/api/auth/me',
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('Network error');
  });

  it('should respect the enabled option', () => {
    const { result } = renderHook(
      () =>
        useApiQuery<TestUser>({
          queryKey: ['user', 'disabled'],
          path: '/api/auth/me',
          enabled: false,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    expect(mockedGet).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should use cached data for the same queryKey', async () => {
    const mockUser: TestUser = { id: '1', name: 'Amina', email: 'amina@example.com' };
    mockedGet.mockResolvedValueOnce(mockUser);

    const options = {
      queryKey: ['user', 'cached'] as const,
      path: '/api/auth/me',
      staleTime: 60_000, // keep data fresh so second mount doesn't refetch
    };

    // First render — fetches from API
    const { result: first } = renderHook(
      () => useApiQuery<TestUser>(options),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(first.current.isSuccess).toBe(true));
    expect(mockedGet).toHaveBeenCalledTimes(1);

    // Second render with same key — uses cache (data is still fresh)
    const { result: second } = renderHook(
      () => useApiQuery<TestUser>(options),
      { wrapper: createWrapper(queryClient) },
    );

    expect(second.current.data).toEqual(mockUser);
    // Should not have made a second network call
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('should forward additional query options like select', async () => {
    const mockUser: TestUser = { id: '1', name: 'Emeka', email: 'emeka@example.com' };
    mockedGet.mockResolvedValueOnce(mockUser);

    const { result } = renderHook(
      () =>
        useApiQuery<TestUser, Error, string>({
          queryKey: ['user', 'select'],
          path: '/api/auth/me',
          select: (user: TestUser) => user.name,
        } as Parameters<typeof useApiQuery<TestUser>>[0]),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBe('Emeka');
  });
});
