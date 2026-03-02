'use client';

/**
 * useSyncOnReconnect
 *
 * Watches the `isOnline` state from the global store and, when transitioning
 * from offline → online, automatically processes the offline action queue and
 * triggers the service worker sync. Displays toast notifications with the
 * sync result.
 *
 * Requirements: 10.5 (auto-sync queued actions), 10.6 (notify user of sync)
 */
import { useEffect, useRef } from 'react';

import { toast } from '../components/Toast/index';
import { processQueue, triggerServiceWorkerSync } from '../lib/offlineQueue';
import type { PendingAction } from '../store/index';
import { useGlobalStore } from '../store/index';

type ReplayFn = (action: PendingAction) => Promise<void>;

/**
 * Default replay function — resolves immediately.
 * In production, callers should provide a real replay function that sends
 * the queued action to the API.
 */
const defaultReplayFn: ReplayFn = async () => {};

export function useSyncOnReconnect(replayFn: ReplayFn = defaultReplayFn): void {
  const isOnline = useGlobalStore((state) => state.isOnline);
  const wasOnlineRef = useRef(isOnline);

  useEffect(() => {
    const wasOnline = wasOnlineRef.current;
    wasOnlineRef.current = isOnline;

    // Only sync when transitioning from offline → online
    if (!wasOnline && isOnline) {
      void syncQueuedActions(replayFn);
    }
  }, [isOnline, replayFn]);
}

async function syncQueuedActions(replayFn: ReplayFn): Promise<void> {
  const pendingCount = useGlobalStore.getState().pendingActions.length;

  if (pendingCount === 0) {
    // Nothing to sync — trigger SW sync only
    triggerServiceWorkerSync();
    return;
  }

  toast.info('Syncing offline actions…');

  try {
    const synced = await processQueue(replayFn);
    triggerServiceWorkerSync();

    const remaining = useGlobalStore.getState().pendingActions.length;

    if (remaining === 0) {
      toast.success(
        `${synced} action${synced !== 1 ? 's' : ''} synced successfully`,
      );
    } else {
      toast.warning(
        `${synced} action${synced !== 1 ? 's' : ''} synced, ${remaining} failed`,
        'Failed actions will retry on next reconnect',
      );
    }
  } catch (_error) {
    toast.error(
      'Sync failed',
      'Your offline actions will retry when connection is stable',
    );
  }
}
