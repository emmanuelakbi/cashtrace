'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { UseLoadingTimeoutOptions, UseLoadingTimeoutResult } from './types';
import { DEFAULT_LOADING_TIMEOUT } from './types';

/**
 * Hook that triggers an error/timed-out state after a configurable duration.
 *
 * Satisfies Requirement 8.5 (timeout and show error after 30 seconds of loading).
 *
 * @example
 * ```tsx
 * const { timedOut, start, reset } = useLoadingTimeout();
 * useEffect(() => { if (isLoading) start(); else reset(); }, [isLoading]);
 * if (timedOut) return <p>Request timed out. Please try again.</p>;
 * ```
 */
export function useLoadingTimeout(
  options?: UseLoadingTimeoutOptions,
): UseLoadingTimeoutResult {
  const timeout = options?.timeout ?? DEFAULT_LOADING_TIMEOUT;
  const [timedOut, setTimedOut] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback((): void => {
    clear();
    setTimedOut(false);
    timerRef.current = setTimeout(() => {
      setTimedOut(true);
    }, timeout);
  }, [clear, timeout]);

  const reset = useCallback((): void => {
    clear();
    setTimedOut(false);
  }, [clear]);

  // Cleanup on unmount.
  useEffect(() => clear, [clear]);

  return { timedOut, start, reset };
}
