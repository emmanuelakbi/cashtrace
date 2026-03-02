'use client';

import { useEffect } from 'react';

import { useGlobalStore } from '../store/index';

/**
 * Syncs browser online/offline connectivity status with the Zustand global store.
 *
 * On mount:
 *  - Sets `isOnline` based on `navigator.onLine`
 *  - Registers `online` and `offline` window event listeners
 *
 * On unmount:
 *  - Cleans up event listeners
 *
 * Requirements: 10.3, 10.4
 */
export function useOnlineStatus(): void {
  const setIsOnline = useGlobalStore((state) => state.setIsOnline);

  useEffect(() => {
    // Set initial status from browser API
    setIsOnline(navigator.onLine);

    const handleOnline = (): void => {
      setIsOnline(true);
    };

    const handleOffline = (): void => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setIsOnline]);
}
