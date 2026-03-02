/**
 * Toast notification system types.
 *
 * Satisfies Requirements 7.1 (notification types), 7.2 (auto-dismiss),
 * 7.3 (manual dismiss), 7.5 (positioning), 7.6 (action buttons).
 */

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  action?: ToastAction;
}

export interface Toast extends ToastOptions {
  id: string;
  createdAt: number;
}

export const DEFAULT_DURATION = 5000;

export const TOAST_ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

/**
 * Tailwind-compatible style mappings per toast type.
 * Uses semantic color tokens from the design system.
 */
export const TOAST_STYLES: Record<
  ToastType,
  { container: string; icon: string }
> = {
  success: {
    container:
      'border-l-4 border-green-600 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100 dark:border-green-400',
    icon: 'text-green-600 dark:text-green-400',
  },
  error: {
    container:
      'border-l-4 border-red-600 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100 dark:border-red-400',
    icon: 'text-red-600 dark:text-red-400',
  },
  warning: {
    container:
      'border-l-4 border-yellow-600 bg-yellow-50 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-100 dark:border-yellow-400',
    icon: 'text-yellow-600 dark:text-yellow-400',
  },
  info: {
    container:
      'border-l-4 border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100 dark:border-blue-400',
    icon: 'text-blue-600 dark:text-blue-400',
  },
};
