import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { GlobalStore, PendingAction } from './types';

export const useGlobalStore = create<GlobalStore>()(
  persist(
    (set) => ({
      // User state
      user: null,
      setUser: (user) => set({ user }),

      // Business context
      activeBusiness: null,
      setActiveBusiness: (activeBusiness) => set({ activeBusiness }),

      // UI preferences
      theme: 'system',
      setTheme: (theme) => set({ theme }),

      // Notifications
      unreadCount: 0,
      setUnreadCount: (unreadCount) => set({ unreadCount }),

      // Offline state
      isOnline: true,
      setIsOnline: (isOnline) => set({ isOnline }),
      pendingActions: [],
      addPendingAction: (action: PendingAction) =>
        set((state) => ({ pendingActions: [...state.pendingActions, action] })),
      clearPendingActions: () => set({ pendingActions: [] }),

      // Logout — clears sensitive state (Requirement 4.6)
      clearSensitiveState: () =>
        set({
          user: null,
          activeBusiness: null,
          unreadCount: 0,
          pendingActions: [],
        }),
    }),
    {
      name: 'cashtrace-store',
      storage: createJSONStorage(() => {
        // SSR-safe: return a no-op storage when window/localStorage is unavailable
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
          return {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          };
        }
        return window.localStorage;
      }),
      partialize: (state) => ({
        theme: state.theme,
        pendingActions: state.pendingActions,
      }),
    },
  ),
);

// Selectors to prevent unnecessary re-renders (Requirement 4.4)
export const selectUser = (state: GlobalStore) => state.user;
export const selectActiveBusiness = (state: GlobalStore) => state.activeBusiness;
export const selectTheme = (state: GlobalStore) => state.theme;
export const selectUnreadCount = (state: GlobalStore) => state.unreadCount;
export const selectIsOnline = (state: GlobalStore) => state.isOnline;
export const selectPendingActions = (state: GlobalStore) => state.pendingActions;
