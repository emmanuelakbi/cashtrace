import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { useToastStore } from '../components/Toast/index';
import * as offlineQueue from '../lib/offlineQueue';
import type { PendingAction } from '../store/index';
import { useGlobalStore } from '../store/index';

import { useSyncOnReconnect } from './useSyncOnReconnect';

vi.mock('../lib/offlineQueue', async () => {
  const actual = await vi.importActual<typeof offlineQueue>('../lib/offlineQueue');
  return {
    ...actual,
    processQueue: vi.fn(),
    triggerServiceWorkerSync: vi.fn(),
  };
});

function makePendingAction(overrides?: Partial<PendingAction>): PendingAction {
  return {
    id: 'test-1',
    type: 'create',
    resource: '/api/transactions',
    data: { amount: 1000 },
    createdAt: new Date(),
    retryCount: 0,
    ...overrides,
  };
}

function resetStores(): void {
  act(() => {
    useGlobalStore.setState({ isOnline: true, pendingActions: [] });
    useToastStore.getState().dismissAll();
  });
}

describe('useSyncOnReconnect', () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should not sync when initially online with no transition', () => {
    act(() => {
      useGlobalStore.setState({ isOnline: true });
    });

    renderHook(() => useSyncOnReconnect());

    expect(offlineQueue.processQueue).not.toHaveBeenCalled();
    expect(offlineQueue.triggerServiceWorkerSync).not.toHaveBeenCalled();
  });

  it('should not sync when going offline', () => {
    act(() => {
      useGlobalStore.setState({ isOnline: true });
    });

    renderHook(() => useSyncOnReconnect());

    act(() => {
      useGlobalStore.setState({ isOnline: false });
    });

    expect(offlineQueue.processQueue).not.toHaveBeenCalled();
  });

  it('should trigger sync when transitioning from offline to online with pending actions', async () => {
    const actions = [makePendingAction()];
    vi.mocked(offlineQueue.processQueue).mockImplementation(async () => {
      useGlobalStore.setState({ pendingActions: [] });
      return 1;
    });

    act(() => {
      useGlobalStore.setState({ isOnline: false, pendingActions: actions });
    });

    renderHook(() => useSyncOnReconnect());

    // Transition to online — keep pendingActions so the hook sees them
    await act(async () => {
      useGlobalStore.setState({ isOnline: true });
    });

    expect(offlineQueue.processQueue).toHaveBeenCalledOnce();
    expect(offlineQueue.triggerServiceWorkerSync).toHaveBeenCalledOnce();
  });

  it('should show success toast when all actions sync', async () => {
    const actions = [makePendingAction(), makePendingAction({ id: 'test-2' })];
    vi.mocked(offlineQueue.processQueue).mockImplementation(async () => {
      // Simulate clearing the queue after processing
      useGlobalStore.setState({ pendingActions: [] });
      return 2;
    });

    act(() => {
      useGlobalStore.setState({ isOnline: false, pendingActions: actions });
    });

    renderHook(() => useSyncOnReconnect());

    await act(async () => {
      useGlobalStore.setState({ isOnline: true });
    });

    const toasts = useToastStore.getState().toasts;
    const successToast = toasts.find((t) => t.type === 'success');
    expect(successToast).toBeDefined();
    expect(successToast?.title).toBe('2 actions synced successfully');
  });

  it('should show warning toast when some actions fail', async () => {
    const actions = [makePendingAction(), makePendingAction({ id: 'test-2' })];
    vi.mocked(offlineQueue.processQueue).mockImplementation(async () => {
      // One action remains in the queue (failed)
      useGlobalStore.setState({
        pendingActions: [makePendingAction({ id: 'test-2', retryCount: 1 })],
      });
      return 1;
    });

    act(() => {
      useGlobalStore.setState({ isOnline: false, pendingActions: actions });
    });

    renderHook(() => useSyncOnReconnect());

    await act(async () => {
      useGlobalStore.setState({ isOnline: true });
    });

    const toasts = useToastStore.getState().toasts;
    const warningToast = toasts.find((t) => t.type === 'warning');
    expect(warningToast).toBeDefined();
    expect(warningToast?.title).toBe('1 action synced, 1 failed');
  });

  it('should show error toast when processQueue throws', async () => {
    const actions = [makePendingAction()];
    vi.mocked(offlineQueue.processQueue).mockRejectedValue(new Error('Network error'));

    act(() => {
      useGlobalStore.setState({ isOnline: false, pendingActions: actions });
    });

    renderHook(() => useSyncOnReconnect());

    await act(async () => {
      useGlobalStore.setState({ isOnline: true });
    });

    const toasts = useToastStore.getState().toasts;
    const errorToast = toasts.find((t) => t.type === 'error');
    expect(errorToast).toBeDefined();
    expect(errorToast?.title).toBe('Sync failed');
  });

  it('should only trigger service worker sync when no pending actions', async () => {
    act(() => {
      useGlobalStore.setState({ isOnline: false, pendingActions: [] });
    });

    renderHook(() => useSyncOnReconnect());

    await act(async () => {
      useGlobalStore.setState({ isOnline: true });
    });

    expect(offlineQueue.processQueue).not.toHaveBeenCalled();
    expect(offlineQueue.triggerServiceWorkerSync).toHaveBeenCalledOnce();
  });

  it('should show info toast before syncing', async () => {
    const actions = [makePendingAction()];
    let infoShown = false;

    vi.mocked(offlineQueue.processQueue).mockImplementation(async () => {
      // Check that info toast was shown before processQueue runs
      const toasts = useToastStore.getState().toasts;
      infoShown = toasts.some((t) => t.type === 'info');
      useGlobalStore.setState({ pendingActions: [] });
      return 1;
    });

    act(() => {
      useGlobalStore.setState({ isOnline: false, pendingActions: actions });
    });

    renderHook(() => useSyncOnReconnect());

    await act(async () => {
      useGlobalStore.setState({ isOnline: true });
    });

    expect(infoShown).toBe(true);
  });

  it('should use singular "action" for single item sync', async () => {
    const actions = [makePendingAction()];
    vi.mocked(offlineQueue.processQueue).mockImplementation(async () => {
      useGlobalStore.setState({ pendingActions: [] });
      return 1;
    });

    act(() => {
      useGlobalStore.setState({ isOnline: false, pendingActions: actions });
    });

    renderHook(() => useSyncOnReconnect());

    await act(async () => {
      useGlobalStore.setState({ isOnline: true });
    });

    const toasts = useToastStore.getState().toasts;
    const successToast = toasts.find((t) => t.type === 'success');
    expect(successToast?.title).toBe('1 action synced successfully');
  });

  it('should pass the provided replayFn to processQueue', async () => {
    const customReplay = vi.fn().mockResolvedValue(undefined);
    const actions = [makePendingAction()];
    vi.mocked(offlineQueue.processQueue).mockImplementation(async (fn) => {
      await fn(actions[0]!);
      useGlobalStore.setState({ pendingActions: [] });
      return 1;
    });

    act(() => {
      useGlobalStore.setState({ isOnline: false, pendingActions: actions });
    });

    renderHook(() => useSyncOnReconnect(customReplay));

    await act(async () => {
      useGlobalStore.setState({ isOnline: true });
    });

    expect(customReplay).toHaveBeenCalledWith(actions[0]);
  });
});
