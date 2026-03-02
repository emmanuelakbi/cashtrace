'use client';

/**
 * ServiceWorkerRegistrar
 *
 * Client component that registers the service worker on mount and
 * surfaces lifecycle events (update available, content cached) as
 * toast notifications.
 *
 * Requirements: 11.2 (register a service worker for offline caching)
 */
import { useEffect, useRef } from 'react';

import { toast } from './Toast/index';

/**
 * Registers the service worker once on mount.
 * Shows a toast when a new version is available or when content
 * has been cached for offline use for the first time.
 */
export function ServiceWorkerRegistrar(): null {
  const registered = useRef(false);

  useEffect(() => {
    if (registered.current) {
      return;
    }
    registered.current = true;

    void registerServiceWorker();
  }, []);

  return null;
}

async function registerServiceWorker(): Promise<void> {
  // Dynamic import keeps the registration utility out of the server bundle
  const { register } = await import('../lib/serviceWorkerRegistration');

  await register({
    onUpdate: () => {
      toast.info(
        'Update available',
        'A new version of CashTrace is available. Refresh to update.',
      );
    },
    onSuccess: () => {
      toast.success(
        'Ready for offline',
        'CashTrace content has been cached for offline use.',
      );
    },
    onError: (error: Error) => {
      toast.error(
        'Service worker error',
        error.message || 'Failed to register service worker.',
      );
    },
  });
}
