import { describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for lazyImport utility.
 *
 * Because `next/dynamic` is a framework primitive that requires the full Next.js
 * runtime, we test the module's structure and contract rather than rendering.
 * Integration / E2E tests cover the actual lazy-loading behaviour in-browser.
 *
 * Validates Requirement 14.1 (code splitting for route-based lazy loading).
 */

// Mock next/dynamic so we can inspect the arguments passed to it.
vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: vi.fn((_loader: unknown, opts: Record<string, unknown>) => {
    // Return a sentinel so we can assert the call happened.
    return { __dynamic: true, opts };
  }),
}));

describe('lazyImport', () => {
  it('calls next/dynamic with ssr disabled by default', async () => {
    const { default: dynamicMock } = await import('next/dynamic');
    const { lazyImport } = await import('./lazyImport.js');

    const importFn = (): Promise<{ default: () => null }> =>
      Promise.resolve({ default: () => null });

    lazyImport(importFn);

    expect(dynamicMock).toHaveBeenCalledWith(
      importFn,
      expect.objectContaining({ ssr: false }),
    );
  });

  it('passes ssr option through when explicitly enabled', async () => {
    const { default: dynamicMock } = await import('next/dynamic');
    const { lazyImport } = await import('./lazyImport.js');

    const importFn = (): Promise<{ default: () => null }> =>
      Promise.resolve({ default: () => null });

    lazyImport(importFn, { ssr: true });

    expect(dynamicMock).toHaveBeenCalledWith(
      importFn,
      expect.objectContaining({ ssr: true }),
    );
  });

  it('provides a loading function in the dynamic options', async () => {
    const { default: dynamicMock } = await import('next/dynamic');
    const { lazyImport } = await import('./lazyImport.js');

    const importFn = (): Promise<{ default: () => null }> =>
      Promise.resolve({ default: () => null });

    lazyImport(importFn);

    const call = vi.mocked(dynamicMock).mock.calls.at(-1);
    const opts = call?.[1] as Record<string, unknown> | undefined;

    expect(opts).toBeDefined();
    expect(typeof opts?.loading).toBe('function');
  });

  it('returns a component (the result of next/dynamic)', async () => {
    const { lazyImport } = await import('./lazyImport.js');

    const importFn = (): Promise<{ default: () => null }> =>
      Promise.resolve({ default: () => null });

    const Component = lazyImport(importFn);

    // Our mock returns an object with __dynamic flag.
    expect(Component).toBeDefined();
  });
});
