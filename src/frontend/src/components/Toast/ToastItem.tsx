'use client';

import type { FC } from 'react';
import { useCallback, useEffect, useState } from 'react';

import type { Toast } from './types';
import { TOAST_ICONS, TOAST_STYLES } from './types';

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

/**
 * Individual toast notification component.
 *
 * Renders a styled notification with icon, title, optional message,
 * optional action button, and a manual dismiss button.
 * Uses ARIA live region attributes for screen reader accessibility.
 *
 * Satisfies Requirements 7.1 (types), 7.3 (manual dismiss), 7.6 (action buttons).
 */
export const ToastItem: FC<ToastItemProps> = ({ toast: t, onDismiss }) => {
  const [isExiting, setIsExiting] = useState(false);
  const styles = TOAST_STYLES[t.type];
  const icon = TOAST_ICONS[t.type];

  const handleDismiss = useCallback((): void => {
    setIsExiting(true);
    // Allow exit animation before removing
    setTimeout(() => {
      onDismiss(t.id);
    }, 150);
  }, [onDismiss, t.id]);

  const handleAction = useCallback((): void => {
    t.action?.onClick();
    handleDismiss();
  }, [t.action, handleDismiss]);

  // Keyboard dismiss with Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        handleDismiss();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleDismiss]);

  return (
    <div
      role="alert"
      aria-live={t.type === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      data-testid={`toast-${t.id}`}
      data-toast-type={t.type}
      className={[
        'pointer-events-auto flex w-full items-start gap-3 rounded-lg p-4 shadow-lg',
        'transition-all duration-150 ease-in-out',
        isExiting ? 'translate-x-2 opacity-0' : 'translate-x-0 opacity-100',
        styles.container,
      ].join(' ')}
    >
      {/* Icon */}
      <span className={`flex-shrink-0 text-lg ${styles.icon}`} aria-hidden="true">
        {icon}
      </span>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t.title}</p>
        {t.message && (
          <p className="mt-1 text-sm opacity-90">{t.message}</p>
        )}
        {/* Action button (Req 7.6) */}
        {t.action && (
          <button
            type="button"
            onClick={handleAction}
            className="mt-2 text-sm font-medium underline underline-offset-2 hover:no-underline focus:outline-none focus:ring-2 focus:ring-current focus:ring-offset-1 rounded"
          >
            {t.action.label}
          </button>
        )}
      </div>

      {/* Dismiss button (Req 7.3) */}
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={`Dismiss ${t.type} notification: ${t.title}`}
        className="flex-shrink-0 rounded p-1 opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-current"
      >
        <span aria-hidden="true" className="text-base leading-none">
          ✕
        </span>
      </button>
    </div>
  );
};
