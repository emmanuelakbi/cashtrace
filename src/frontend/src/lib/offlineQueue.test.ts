import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalStore } from '../store/index';

import {
  getPendingCount,
  processQueue,
  queueOfflineAction,
  triggerServiceWorkerSync,
} from './offlineQueue';

describe('offlineQueue', () => {
  beforeEach(() => {
    // Reset the store between tests
    useGlobalStore.setState({
      pendingActions: [],
      isOnline: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('queueOfflineAction', () => {
    it('adds a pending action to the store', () => {
      const action = queueOfflineAction({
        type: 'create',
        resource: '/api/transactions',
        data: { amount: 5000 },
      });

      expect(action.id).toBeTruthy();
      expect(action.type).toBe('create');
      expect(action.resource).toBe('/api/transactions');
      expect(action.data).toEqual({ amount: 5000 });
      expect(action.retryCount).toBe(0);
      expect(action.createdAt).toBeInstanceOf(Date);

      const pending = useGlobalStore.getState().pendingActions;
      expect(pending).toHaveLength(1);
      expect(pending[0]).toEqual(action);
    });

    it('generates unique IDs for each action', () => {
      const a1 = queueOfflineAction({ type: 'create', resource: '/api/a', data: null });
      const a2 = queueOfflineAction({ type: 'update', resource: '/api/b', data: null });

      expect(a1.id).not.toBe(a2.id);
      expect(useGlobalStore.getState().pendingActions).toHaveLength(2);
    });
  });

  describe('processQueue', () => {
    it('replays all actions and clears the queue on success', async () => {
      queueOfflineAction({ type: 'create', resource: '/api/tx', data: { amount: 100 } });
      queueOfflineAction({ type: 'update', resource: '/api/tx/1', data: { amount: 200 } });

      const replayFn = vi.fn().mockResolvedValue(undefined);

      const synced = await processQueue(replayFn);

      expect(synced).toBe(2);
      expect(replayFn).toHaveBeenCalledTimes(2);
      expect(useGlobalStore.getState().pendingActions).toHaveLength(0);
    });

    it('keeps failed actions in the queue with incremented retryCount', async () => {
      queueOfflineAction({ type: 'create', resource: '/api/a', data: null });
      queueOfflineAction({ type: 'delete', resource: '/api/b', data: null });

      const replayFn = vi.fn()
        .mockResolvedValueOnce(undefined) // first succeeds
        .mockRejectedValueOnce(new Error('Network error')); // second fails

      const synced = await processQueue(replayFn);

      expect(synced).toBe(1);
      const remaining = useGlobalStore.getState().pendingActions;
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.resource).toBe('/api/b');
      expect(remaining[0]?.retryCount).toBe(1);
    });

    it('returns 0 when queue is empty', async () => {
      const replayFn = vi.fn();
      const synced = await processQueue(replayFn);

      expect(synced).toBe(0);
      expect(replayFn).not.toHaveBeenCalled();
    });

    it('handles all actions failing', async () => {
      queueOfflineAction({ type: 'create', resource: '/api/x', data: null });
      queueOfflineAction({ type: 'update', resource: '/api/y', data: null });

      const replayFn = vi.fn().mockRejectedValue(new Error('offline'));

      const synced = await processQueue(replayFn);

      expect(synced).toBe(0);
      expect(useGlobalStore.getState().pendingActions).toHaveLength(2);
    });
  });

  describe('triggerServiceWorkerSync', () => {
    it('posts PROCESS_QUEUE message to service worker controller', () => {
      const postMessage = vi.fn();
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { controller: { postMessage } },
        writable: true,
        configurable: true,
      });

      triggerServiceWorkerSync();

      expect(postMessage).toHaveBeenCalledWith({ type: 'PROCESS_QUEUE' });
    });

    it('does nothing when no service worker controller', () => {
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { controller: null },
        writable: true,
        configurable: true,
      });

      // Should not throw
      triggerServiceWorkerSync();
    });
  });

  describe('getPendingCount', () => {
    it('returns 0 when queue is empty', () => {
      expect(getPendingCount()).toBe(0);
    });

    it('returns the correct count after queuing actions', () => {
      queueOfflineAction({ type: 'create', resource: '/api/a', data: null });
      queueOfflineAction({ type: 'update', resource: '/api/b', data: null });
      queueOfflineAction({ type: 'delete', resource: '/api/c', data: null });

      expect(getPendingCount()).toBe(3);
    });
  });
});
