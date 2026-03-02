'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Network Information API type (not yet in all TS libs).
 * @see https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation
 */
interface NetworkInformation {
  saveData: boolean;
}

declare global {
  interface Navigator {
    connection?: NetworkInformation;
  }
}

/** Default delay (ms) before prefetching starts, to avoid competing with initial render. */
const PREFETCH_DELAY_MS = 2_000;

/**
 * Prefetches an array of route paths using the Next.js router.
 *
 * - Waits {@link PREFETCH_DELAY_MS} after mount before starting
 * - Skips prefetching when the browser is offline (`navigator.onLine === false`)
 * - Skips prefetching when data-saver mode is active (`navigator.connection.saveData`)
 *
 * @param paths - Route paths to prefetch (e.g. `['/dashboard', '/transactions']`)
 * @param delayMs - Optional override for the prefetch delay (default 2 000 ms)
 *
 * Requirements: 14.3
 */
export function usePrefetch(paths: string[], delayMs: number = PREFETCH_DELAY_MS): void {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      // Skip when offline
      if (!navigator.onLine) {
        return;
      }

      // Skip when data-saver is enabled
      if (navigator.connection?.saveData) {
        return;
      }

      for (const path of paths) {
        router.prefetch(path);
      }
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
    // paths is expected to be stable (literal array); delayMs is a primitive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, delayMs]);
}
