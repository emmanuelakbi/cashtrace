/**
 * API Client for CashTrace frontend.
 *
 * Provides a configured HTTP client using native `fetch` with:
 * - Base URL from environment config
 * - Auth cookie injection via `credentials: 'include'`
 * - Common request headers (Content-Type, Accept)
 * - Response interceptor for error handling (401 → redirect, 5xx → throw)
 * - Timeout support via AbortController
 *
 * Requirements: 16.1 (configured API client), 16.2 (request/response interceptors)
 */

import { env } from '../config/env';

export interface RequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
  retry?: boolean;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Default request timeout in milliseconds (30 seconds). */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Request interceptor: attaches common headers to every outgoing request.
 */
function applyRequestHeaders(
  init: RequestInit,
  options?: RequestOptions,
): RequestInit {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
    ...options?.headers,
  };

  // Only set Content-Type for requests that carry a body
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  return { ...init, headers };
}

/**
 * Response interceptor: handles error status codes.
 * - 401 → redirects to login page
 * - 4xx/5xx → throws ApiError with server message
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    // 204 No Content — nothing to parse
    if (response.status === 204) {
      return undefined as T;
    }
    return response.json() as Promise<T>;
  }

  // Attempt to parse error body
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  const message = body?.error?.message ?? `Request failed with status ${response.status}`;
  const code = body?.error?.code;

  // 401 Unauthorized → redirect to login
  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      const currentPath = window.location.pathname + window.location.search;
      const redirectUrl = `/login?redirect=${encodeURIComponent(currentPath)}`;
      window.location.href = redirectUrl;
    }
    throw new ApiError(message, response.status, code);
  }

  throw new ApiError(message, response.status, code);
}

/**
 * Core fetch wrapper with timeout, request interceptor, and response interceptor.
 */
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  const url = `${env.apiBaseUrl}${path}`;
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const init: RequestInit = {
    method,
    credentials: 'include',
    signal: controller.signal,
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const finalInit = applyRequestHeaders(init, options);

  try {
    const response = await fetch(url, finalInit);
    return await handleResponse<T>(response);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(`Request timed out after ${timeout}ms`, 408);
    }
    throw new ApiError(
      error instanceof Error ? error.message : 'Network error',
      0,
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface APIClient {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, data: unknown, options?: RequestOptions): Promise<T>;
  put<T>(path: string, data: unknown, options?: RequestOptions): Promise<T>;
  delete<T>(path: string, options?: RequestOptions): Promise<T>;
}

export const apiClient: APIClient = {
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>('GET', path, undefined, options);
  },
  post<T>(path: string, data: unknown, options?: RequestOptions): Promise<T> {
    return request<T>('POST', path, data, options);
  },
  put<T>(path: string, data: unknown, options?: RequestOptions): Promise<T> {
    return request<T>('PUT', path, data, options);
  },
  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>('DELETE', path, undefined, options);
  },
};
