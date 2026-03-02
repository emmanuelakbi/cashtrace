/**
 * Offline Action Queue
 *
 * Integrates with the Zustand global store to queue failed requests when
 * offline and replay them when connectivity is restored.
 *
 * Requirements: 10.3 (queue offline actions), 10.5 (sync when online)
 */

import type { PendingAction } from '../store/types';

import { useGlobalStore } from '../store/index';

/**
 * Queue a failed request as a pending action in the Zustand store.
 */
export function queueOfflineAction(
  action: Omit<PendingAction, 'id' | 'createdAt' | 'retryCount'>,
): PendingAction {
  const pending: PendingAction = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    type: action.type,
    resource: action.resource,
    data: action.data,
    createdAt: new Date(),
    retryCount: 0,
  };

  useGlobalStore.getState().addPendingAction(pending);
  return pending;
}

/**
 * Process all queued offline actions by replaying them against the API.
 * Successfully replayed actions are removed from the store.
 *
 * @param replayFn - Callback that replays a single action. Should throw on failure.
 * @returns The number of successfully synced actions.
 */
export async function processQueue(
  replayFn: (action: PendingAction) => Promise<void>,
): Promise<number> {
  const store = useGlobalStore.getState();
  const pending = [...store.pendingActions];

  if (pending.length === 0) {
    return 0;
  }

  const failed: PendingAction[] = [];
  let synced = 0;

  for (const action of pending) {
    try {
      await replayFn(action);
      synced++;
    } catch (_error) {
      failed.push({ ...action, retryCount: action.retryCount + 1 });
    }
  }

  // Replace the queue: clear all, then re-add failures
  store.clearPendingActions();
  for (const f of failed) {
    store.addPendingAction(f);
  }

  return synced;
}

/**
 * Tell the service worker to process its internal offline queue.
 * This is useful when the app detects it has come back online.
 */
export function triggerServiceWorkerSync(): void {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'PROCESS_QUEUE' });
  }
}

/**
 * Get the current count of pending offline actions.
 */
export function getPendingCount(): number {
  return useGlobalStore.getState().pendingActions.length;
}
