/**
 * Toast notification store using Zustand.
 *
 * Provides show/dismiss/dismissAll operations and auto-dismiss timers.
 * Satisfies Requirements 7.1, 7.2, 7.3, 7.4.
 */
import { create } from 'zustand';

import type { Toast, ToastOptions } from './types';
import { DEFAULT_DURATION } from './types';

let toastCounter = 0;

function generateId(): string {
  toastCounter += 1;
  return `toast-${Date.now()}-${toastCounter}`;
}

export interface ToastStore {
  toasts: Toast[];
  show: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

/** Active auto-dismiss timers keyed by toast id. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  show: (options: ToastOptions): string => {
    const id = generateId();
    const toast: Toast = {
      ...options,
      id,
      createdAt: Date.now(),
    };

    set((state) => ({ toasts: [...state.toasts, toast] }));

    // Auto-dismiss after configured duration (Req 7.2)
    const duration = options.duration ?? DEFAULT_DURATION;
    if (duration > 0) {
      const timer = setTimeout(() => {
        get().dismiss(id);
      }, duration);
      timers.set(id, timer);
    }

    return id;
  },

  dismiss: (id: string): void => {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  dismissAll: (): void => {
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();
    set({ toasts: [] });
  },
}));

/**
 * Convenience function for use outside React components.
 */
export const toast = {
  show: (options: ToastOptions): string => useToastStore.getState().show(options),
  dismiss: (id: string): void => useToastStore.getState().dismiss(id),
  dismissAll: (): void => useToastStore.getState().dismissAll(),
  success: (title: string, message?: string): string =>
    useToastStore.getState().show({ type: 'success', title, message }),
  error: (title: string, message?: string): string =>
    useToastStore.getState().show({ type: 'error', title, message }),
  warning: (title: string, message?: string): string =>
    useToastStore.getState().show({ type: 'warning', title, message }),
  info: (title: string, message?: string): string =>
    useToastStore.getState().show({ type: 'info', title, message }),
};
