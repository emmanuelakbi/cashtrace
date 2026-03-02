'use client';

import type { FC } from 'react';

import { useToastStore } from './toastStore';
import { ToastItem } from './ToastItem';

/**
 * Toast container that positions notifications on screen.
 *
 * Mobile (<640px): centered at top of viewport.
 * Desktop (≥640px): top-right corner.
 *
 * Satisfies Requirements 7.4 (stacking), 7.5 (positioning).
 */
export const ToastContainer: FC = () => {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      aria-relevant="additions removals"
      data-testid="toast-container"
      className={[
        'pointer-events-none fixed z-50',
        // Mobile: top center (Req 7.5)
        'inset-x-0 top-0 flex flex-col items-center px-4 pt-4',
        // Desktop: top-right (Req 7.5)
        'sm:inset-x-auto sm:right-0 sm:items-end sm:pr-6 sm:pt-6',
      ].join(' ')}
    >
      <div className="flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </div>
  );
};
