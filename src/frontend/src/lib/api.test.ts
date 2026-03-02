import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiClient } from './api';

/* ------------------------------------------------------------------ */
/*  Mock environment config                                           */
/* ------------------------------------------------------------------ */
vi.mock('../config/env', () => ({
  env: { apiBaseUrl: 'https://api.test.com' },
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return new Response(
    JSON.stringify({ success: false, error: { code, message } }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('apiClient', () => {
  const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchSpy);
    // Prevent actual navigation in 401 tests
    Object.defineProperty(window, 'location', {
      value: { pathname: '/dashboard', search: '', href: '' },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /* ---- Request interceptor: common headers ---- */

  describe('request interceptor', () => {
    it('sets Accept header on GET requests', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await apiClient.get('/api/test');

      const [, init] = fetchSpy.mock.calls[0]!;
      const headers = init?.headers as Record<string, string>;
      expect(headers['Accept']).toBe('application/json');
    });

    it('sets Content-Type on POST requests with body', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await apiClient.post('/api/test', { name: 'foo' });

      const [, init] = fetchSpy.mock.calls[0]!;
      const headers = init?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Accept']).toBe('application/json');
    });

    it('does not set Content-Type on GET requests (no body)', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await apiClient.get('/api/test');

      const [, init] = fetchSpy.mock.calls[0]!;
      const headers = init?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBeUndefined();
    });

    it('merges custom headers from options', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await apiClient.get('/api/test', {
        headers: { 'X-Custom': 'value' },
      });

      const [, init] = fetchSpy.mock.calls[0]!;
      const headers = init?.headers as Record<string, string>;
      expect(headers['X-Custom']).toBe('value');
      expect(headers['Accept']).toBe('application/json');
    });

    it('includes credentials for cookie-based auth', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await apiClient.get('/api/test');

      const [, init] = fetchSpy.mock.calls[0]!;
      expect(init?.credentials).toBe('include');
    });
  });

  /* ---- Base URL configuration ---- */

  describe('base URL', () => {
    it('prepends apiBaseUrl to the path', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await apiClient.get('/api/users');

      const [url] = fetchSpy.mock.calls[0]!;
      expect(url).toBe('https://api.test.com/api/users');
    });
  });

  /* ---- HTTP methods ---- */

  describe('HTTP methods', () => {
    it('sends GET request', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ items: [] }));

      const result = await apiClient.get<{ items: string[] }>('/api/items');

      expect(fetchSpy.mock.calls[0]![1]?.method).toBe('GET');
      expect(result).toEqual({ items: [] });
    });

    it('sends POST request with JSON body', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ id: '1' }));
      const payload = { name: 'test' };

      const result = await apiClient.post<{ id: string }>('/api/items', payload);

      const [, init] = fetchSpy.mock.calls[0]!;
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe(JSON.stringify(payload));
      expect(result).toEqual({ id: '1' });
    });

    it('sends PUT request with JSON body', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ updated: true }));

      await apiClient.put('/api/items/1', { name: 'updated' });

      expect(fetchSpy.mock.calls[0]![1]?.method).toBe('PUT');
    });

    it('sends DELETE request without body', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ deleted: true }));

      await apiClient.delete('/api/items/1');

      const [, init] = fetchSpy.mock.calls[0]!;
      expect(init?.method).toBe('DELETE');
      expect(init?.body).toBeUndefined();
    });

    it('handles 204 No Content responses', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(null, { status: 204 }),
      );

      const result = await apiClient.delete('/api/items/1');

      expect(result).toBeUndefined();
    });
  });

  /* ---- Response interceptor: error handling ---- */

  describe('response interceptor', () => {
    it('throws ApiError with server message on 4xx', async () => {
      fetchSpy.mockResolvedValueOnce(
        errorResponse(400, 'VALIDATION_ERROR', 'Invalid input'),
      );

      try {
        await apiClient.post('/api/test', {});
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).status).toBe(400);
        expect((e as ApiError).code).toBe('VALIDATION_ERROR');
        expect((e as ApiError).message).toBe('Invalid input');
      }
    });

    it('throws ApiError with server message on 5xx', async () => {
      fetchSpy.mockResolvedValueOnce(
        errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong'),
      );

      await expect(apiClient.get('/api/test')).rejects.toThrow(ApiError);
    });

    it('falls back to status text when error body is unparseable', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('not json', { status: 502 }),
      );

      try {
        await apiClient.get('/api/test');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).status).toBe(502);
        expect((e as ApiError).message).toContain('502');
      }
    });

    it('redirects to login on 401 and preserves current path', async () => {
      Object.defineProperty(window, 'location', {
        value: { pathname: '/dashboard', search: '?tab=overview', href: '' },
        writable: true,
        configurable: true,
      });

      fetchSpy.mockResolvedValueOnce(
        errorResponse(401, 'UNAUTHORIZED', 'Not authenticated'),
      );

      await expect(apiClient.get('/api/test')).rejects.toThrow(ApiError);

      expect(window.location.href).toBe(
        '/login?redirect=%2Fdashboard%3Ftab%3Doverview',
      );
    });
  });

  /* ---- Timeout support ---- */

  describe('timeout', () => {
    it('aborts request after custom timeout', async () => {
      // Use a real AbortController-based approach: fetch rejects when signal aborts
      fetchSpy.mockImplementation((_url, init) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            if (signal.aborted) {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
              return;
            }
            signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }
        });
      });

      try {
        await apiClient.get('/api/slow', { timeout: 1 });
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).status).toBe(408);
        expect((e as ApiError).message).toMatch(/timed out/);
      }
    });
  });

  /* ---- Network errors ---- */

  describe('network errors', () => {
    it('wraps fetch failures as ApiError with status 0', async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      try {
        await apiClient.get('/api/test');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).status).toBe(0);
        expect((e as ApiError).message).toBe('Failed to fetch');
      }
    });
  });
});
