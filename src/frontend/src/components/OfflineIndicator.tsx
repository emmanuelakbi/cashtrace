'use client';

import { useGlobalStore, selectIsOnline } from '../store/index';

/**
 * Displays a prominent banner when the user is offline.
 * Uses an ARIA live region so screen readers announce connectivity changes.
 *
 * Requirements: 10.1
 */
export function OfflineIndicator(): React.JSX.Element | null {
  const isOnline = useGlobalStore(selectIsOnline);

  if (isOnline) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-0 inset-x-0 z-50 flex items-center justify-center gap-2 bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-md"
    >
      <svg
        aria-hidden="true"
        className="h-4 w-4 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M18.364 5.636a9 9 0 0 1 0 12.728M5.636 18.364a9 9 0 0 1 0-12.728"
        />
        <line x1="4" y1="4" x2="20" y2="20" strokeLinecap="round" />
      </svg>
      <span>You are offline</span>
    </div>
  );
}
