/**
 * Service Worker Registration Utility
 *
 * Registers and manages the service worker lifecycle for offline caching
 * and PWA support.
 *
 * Requirements: 10.2 (cache critical pages), 11.2 (register service worker)
 */

export interface ServiceWorkerConfig {
  onUpdate?: (registration: ServiceWorkerRegistration) => void;
  onSuccess?: (registration: ServiceWorkerRegistration) => void;
  onError?: (error: Error) => void;
}

/**
 * Returns true when service workers are supported and the app is running
 * in a production-like environment (not localhost dev, unless explicitly
 * served over HTTPS or from localhost).
 */
export function isServiceWorkerSupported(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  if (!('serviceWorker' in navigator)) {
    return false;
  }
  // Allow localhost and HTTPS origins
  const { hostname, protocol } = window.location;
  return hostname === 'localhost' || hostname === '127.0.0.1' || protocol === 'https:';
}

/**
 * Register the service worker at `/sw.js`.
 * Handles install, update, and error lifecycle events.
 */
export async function register(config?: ServiceWorkerConfig): Promise<void> {
  if (!isServiceWorkerSupported()) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });

    registration.addEventListener('updatefound', () => {
      const installingWorker = registration.installing;
      if (!installingWorker) {
        return;
      }

      installingWorker.addEventListener('statechange', () => {
        if (installingWorker.state !== 'installed') {
          return;
        }

        if (navigator.serviceWorker.controller) {
          // New content available — an update was installed
          config?.onUpdate?.(registration);
        } else {
          // First-time install — content cached for offline
          config?.onSuccess?.(registration);
        }
      });
    });
  } catch (error) {
    config?.onError?.(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Unregister all service workers for this origin.
 * Returns true if a registration was found and unregistered.
 */
export async function unregister(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.unregister();
  } catch (_error) {
    return false;
  }
}
