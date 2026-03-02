import { render, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServiceWorkerConfig } from '../lib/serviceWorkerRegistration';

import { ServiceWorkerRegistrar } from './ServiceWorkerRegistrar';
import { useToastStore } from './Toast/index';

// --- Mocks ----------------------------------------------------------------

let capturedConfig: ServiceWorkerConfig | undefined;

vi.mock('../lib/serviceWorkerRegistration', () => ({
  register: vi.fn(async (config?: ServiceWorkerConfig) => {
    capturedConfig = config;
  }),
}));

// --- Tests -----------------------------------------------------------------

describe('ServiceWorkerRegistrar', () => {
  beforeEach(() => {
    capturedConfig = undefined;
    useToastStore.getState().dismissAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls register once on mount', async () => {
    await act(async () => {
      render(<ServiceWorkerRegistrar />);
    });

    expect(capturedConfig).toBeDefined();
    expect(capturedConfig).toHaveProperty('onUpdate');
    expect(capturedConfig).toHaveProperty('onSuccess');
    expect(capturedConfig).toHaveProperty('onError');
  });

  it('renders nothing (returns null)', async () => {
    let container: HTMLElement | undefined;
    await act(async () => {
      const result = render(<ServiceWorkerRegistrar />);
      container = result.container;
    });

    expect(container!.innerHTML).toBe('');
  });

  it('shows an info toast when onUpdate is called', async () => {
    await act(async () => {
      render(<ServiceWorkerRegistrar />);
    });

    act(() => {
      capturedConfig?.onUpdate?.({} as ServiceWorkerRegistration);
    });

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.type).toBe('info');
    expect(toasts[0]!.title).toBe('Update available');
    expect(toasts[0]!.message).toContain('new version');
  });

  it('shows a success toast when onSuccess is called', async () => {
    await act(async () => {
      render(<ServiceWorkerRegistrar />);
    });

    act(() => {
      capturedConfig?.onSuccess?.({} as ServiceWorkerRegistration);
    });

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.type).toBe('success');
    expect(toasts[0]!.title).toBe('Ready for offline');
    expect(toasts[0]!.message).toContain('cached for offline');
  });

  it('shows an error toast when onError is called', async () => {
    await act(async () => {
      render(<ServiceWorkerRegistrar />);
    });

    act(() => {
      capturedConfig?.onError?.(new Error('Registration failed'));
    });

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.type).toBe('error');
    expect(toasts[0]!.title).toBe('Service worker error');
    expect(toasts[0]!.message).toBe('Registration failed');
  });

  it('uses fallback message when error has no message', async () => {
    await act(async () => {
      render(<ServiceWorkerRegistrar />);
    });

    act(() => {
      capturedConfig?.onError?.(new Error(''));
    });

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.message).toBe('Failed to register service worker.');
  });
});
