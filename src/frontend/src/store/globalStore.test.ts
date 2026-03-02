import { act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  useGlobalStore,
  selectUser,
  selectActiveBusiness,
  selectTheme,
  selectUnreadCount,
  selectIsOnline,
  selectPendingActions,
} from './globalStore';
import type { Business, PendingAction, User } from './types';

// Helper to reset store and localStorage between tests
function resetStore(): void {
  try {
    localStorage.removeItem('cashtrace-store');
  } catch {
    // localStorage may not be available in all test environments
  }
  act(() => {
    useGlobalStore.setState({
      user: null,
      activeBusiness: null,
      theme: 'system',
      unreadCount: 0,
      isOnline: true,
      pendingActions: [],
    });
  });
}

describe('GlobalStore', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('user state', () => {
    it('should initialize with null user', () => {
      expect(useGlobalStore.getState().user).toBeNull();
    });

    it('should set user', () => {
      const user: User = {
        id: 'u1',
        email: 'test@example.com',
        businessId: 'b1',
        businessName: 'Test Biz',
      };
      useGlobalStore.getState().setUser(user);
      expect(useGlobalStore.getState().user).toEqual(user);
    });

    it('should clear user by setting null', () => {
      useGlobalStore
        .getState()
        .setUser({ id: 'u1', email: 'a@b.com', businessId: 'b1', businessName: 'B' });
      useGlobalStore.getState().setUser(null);
      expect(useGlobalStore.getState().user).toBeNull();
    });
  });

  describe('business context', () => {
    it('should initialize with null activeBusiness', () => {
      expect(useGlobalStore.getState().activeBusiness).toBeNull();
    });

    it('should set activeBusiness', () => {
      const biz: Business = { id: 'b1', name: 'Acme', sector: 'Retail' };
      useGlobalStore.getState().setActiveBusiness(biz);
      expect(useGlobalStore.getState().activeBusiness).toEqual(biz);
    });
  });

  describe('UI preferences', () => {
    it('should default theme to system', () => {
      expect(useGlobalStore.getState().theme).toBe('system');
    });

    it('should set theme', () => {
      useGlobalStore.getState().setTheme('dark');
      expect(useGlobalStore.getState().theme).toBe('dark');
    });
  });

  describe('notifications', () => {
    it('should initialize unreadCount to 0', () => {
      expect(useGlobalStore.getState().unreadCount).toBe(0);
    });

    it('should set unreadCount', () => {
      useGlobalStore.getState().setUnreadCount(5);
      expect(useGlobalStore.getState().unreadCount).toBe(5);
    });
  });

  describe('offline state', () => {
    it('should default isOnline to true', () => {
      expect(useGlobalStore.getState().isOnline).toBe(true);
    });

    it('should set isOnline', () => {
      useGlobalStore.getState().setIsOnline(false);
      expect(useGlobalStore.getState().isOnline).toBe(false);
    });

    it('should initialize with empty pendingActions', () => {
      expect(useGlobalStore.getState().pendingActions).toEqual([]);
    });

    it('should add a pending action', () => {
      const action: PendingAction = {
        id: 'a1',
        type: 'create',
        resource: 'transaction',
        data: { amount: 1000 },
        createdAt: new Date('2024-01-01'),
        retryCount: 0,
      };
      useGlobalStore.getState().addPendingAction(action);
      expect(useGlobalStore.getState().pendingActions).toHaveLength(1);
      expect(useGlobalStore.getState().pendingActions[0]).toEqual(action);
    });

    it('should accumulate multiple pending actions', () => {
      const a1: PendingAction = {
        id: 'a1',
        type: 'create',
        resource: 'tx',
        data: {},
        createdAt: new Date(),
        retryCount: 0,
      };
      const a2: PendingAction = {
        id: 'a2',
        type: 'update',
        resource: 'tx',
        data: {},
        createdAt: new Date(),
        retryCount: 1,
      };
      useGlobalStore.getState().addPendingAction(a1);
      useGlobalStore.getState().addPendingAction(a2);
      expect(useGlobalStore.getState().pendingActions).toHaveLength(2);
    });

    it('should clear pending actions', () => {
      useGlobalStore.getState().addPendingAction({
        id: 'a1',
        type: 'delete',
        resource: 'doc',
        data: null,
        createdAt: new Date(),
        retryCount: 0,
      });
      useGlobalStore.getState().clearPendingActions();
      expect(useGlobalStore.getState().pendingActions).toEqual([]);
    });
  });

  describe('clearSensitiveState (Requirement 4.6)', () => {
    it('should clear user, activeBusiness, unreadCount, and pendingActions on logout', () => {
      useGlobalStore
        .getState()
        .setUser({ id: 'u1', email: 'a@b.com', businessId: 'b1', businessName: 'B' });
      useGlobalStore.getState().setActiveBusiness({ id: 'b1', name: 'Biz' });
      useGlobalStore.getState().setUnreadCount(10);
      useGlobalStore.getState().addPendingAction({
        id: 'a1',
        type: 'create',
        resource: 'tx',
        data: {},
        createdAt: new Date(),
        retryCount: 0,
      });
      useGlobalStore.getState().setTheme('dark');

      useGlobalStore.getState().clearSensitiveState();

      const state = useGlobalStore.getState();
      expect(state.user).toBeNull();
      expect(state.activeBusiness).toBeNull();
      expect(state.unreadCount).toBe(0);
      expect(state.pendingActions).toEqual([]);
      // Theme should be preserved — it's a UI preference, not sensitive
      expect(state.theme).toBe('dark');
    });
  });

  describe('selectors (Requirement 4.4)', () => {
    it('selectUser returns user from state', () => {
      const user: User = { id: 'u1', email: 'a@b.com', businessId: 'b1', businessName: 'B' };
      useGlobalStore.setState({ user });
      expect(selectUser(useGlobalStore.getState())).toEqual(user);
    });

    it('selectActiveBusiness returns activeBusiness from state', () => {
      const biz: Business = { id: 'b1', name: 'Biz' };
      useGlobalStore.setState({ activeBusiness: biz });
      expect(selectActiveBusiness(useGlobalStore.getState())).toEqual(biz);
    });

    it('selectTheme returns theme from state', () => {
      useGlobalStore.setState({ theme: 'light' });
      expect(selectTheme(useGlobalStore.getState())).toBe('light');
    });

    it('selectUnreadCount returns unreadCount from state', () => {
      useGlobalStore.setState({ unreadCount: 3 });
      expect(selectUnreadCount(useGlobalStore.getState())).toBe(3);
    });

    it('selectIsOnline returns isOnline from state', () => {
      useGlobalStore.setState({ isOnline: false });
      expect(selectIsOnline(useGlobalStore.getState())).toBe(false);
    });

    it('selectPendingActions returns pendingActions from state', () => {
      const actions: PendingAction[] = [
        {
          id: 'a1',
          type: 'create',
          resource: 'tx',
          data: {},
          createdAt: new Date(),
          retryCount: 0,
        },
      ];
      useGlobalStore.setState({ pendingActions: actions });
      expect(selectPendingActions(useGlobalStore.getState())).toEqual(actions);
    });
  });

  describe('state persistence (Requirements 4.2, 4.5)', () => {
    it('should use cashtrace-store as the localStorage key', () => {
      useGlobalStore.getState().setTheme('dark');

      const stored = localStorage.getItem('cashtrace-store');
      expect(stored).not.toBeNull();
    });

    it('should persist theme to localStorage', () => {
      useGlobalStore.getState().setTheme('light');

      const stored = JSON.parse(localStorage.getItem('cashtrace-store') ?? '{}');
      expect(stored.state.theme).toBe('light');
    });

    it('should persist pendingActions to localStorage', () => {
      const action: PendingAction = {
        id: 'pa1',
        type: 'create',
        resource: 'transaction',
        data: { amount: 5000 },
        createdAt: new Date('2024-06-01T12:00:00Z'),
        retryCount: 0,
      };
      useGlobalStore.getState().addPendingAction(action);

      const stored = JSON.parse(localStorage.getItem('cashtrace-store') ?? '{}');
      expect(stored.state.pendingActions).toHaveLength(1);
      expect(stored.state.pendingActions[0].id).toBe('pa1');
    });

    it('should NOT persist user to localStorage', () => {
      useGlobalStore
        .getState()
        .setUser({ id: 'u1', email: 'a@b.com', businessId: 'b1', businessName: 'B' });

      const stored = JSON.parse(localStorage.getItem('cashtrace-store') ?? '{}');
      expect(stored.state.user).toBeUndefined();
    });

    it('should NOT persist activeBusiness to localStorage', () => {
      useGlobalStore.getState().setActiveBusiness({ id: 'b1', name: 'Biz' });

      const stored = JSON.parse(localStorage.getItem('cashtrace-store') ?? '{}');
      expect(stored.state.activeBusiness).toBeUndefined();
    });

    it('should NOT persist isOnline to localStorage', () => {
      useGlobalStore.getState().setIsOnline(false);

      const stored = JSON.parse(localStorage.getItem('cashtrace-store') ?? '{}');
      expect(stored.state.isOnline).toBeUndefined();
    });

    it('should NOT persist unreadCount to localStorage', () => {
      useGlobalStore.getState().setUnreadCount(42);

      const stored = JSON.parse(localStorage.getItem('cashtrace-store') ?? '{}');
      expect(stored.state.unreadCount).toBeUndefined();
    });

    it('should hydrate persisted state from localStorage', async () => {
      // Seed localStorage with persisted data
      const persistedData = {
        state: { theme: 'dark' as const, pendingActions: [] },
        version: 0,
      };
      localStorage.setItem('cashtrace-store', JSON.stringify(persistedData));

      // Trigger rehydration
      await useGlobalStore.persist.rehydrate();

      expect(useGlobalStore.getState().theme).toBe('dark');
    });

    it('should hydrate pendingActions from localStorage', async () => {
      const action = {
        id: 'pa-hydrate',
        type: 'update' as const,
        resource: 'invoice',
        data: { status: 'paid' },
        createdAt: '2024-06-01T12:00:00.000Z',
        retryCount: 1,
      };
      const persistedData = {
        state: { theme: 'system' as const, pendingActions: [action] },
        version: 0,
      };
      localStorage.setItem('cashtrace-store', JSON.stringify(persistedData));

      await useGlobalStore.persist.rehydrate();

      expect(useGlobalStore.getState().pendingActions).toHaveLength(1);
      expect(useGlobalStore.getState().pendingActions[0].id).toBe('pa-hydrate');
    });

    it('should not overwrite non-persisted state during hydration', async () => {
      // Set runtime state
      useGlobalStore.getState().setIsOnline(false);
      useGlobalStore.getState().setUnreadCount(7);

      const persistedData = {
        state: { theme: 'light' as const, pendingActions: [] },
        version: 0,
      };
      localStorage.setItem('cashtrace-store', JSON.stringify(persistedData));

      await useGlobalStore.persist.rehydrate();

      // Persisted fields updated
      expect(useGlobalStore.getState().theme).toBe('light');
      // Non-persisted fields preserved
      expect(useGlobalStore.getState().isOnline).toBe(false);
      expect(useGlobalStore.getState().unreadCount).toBe(7);
    });

    it('should handle missing localStorage data gracefully', async () => {
      localStorage.removeItem('cashtrace-store');

      await useGlobalStore.persist.rehydrate();

      // Defaults should remain
      expect(useGlobalStore.getState().theme).toBe('system');
      expect(useGlobalStore.getState().pendingActions).toEqual([]);
    });

    it('should handle corrupted localStorage data gracefully', async () => {
      localStorage.setItem('cashtrace-store', '{invalid json!!!');

      // Should not throw
      await expect(useGlobalStore.persist.rehydrate()).resolves.not.toThrow();
    });

    it('should update localStorage when clearSensitiveState clears pendingActions', () => {
      useGlobalStore.getState().addPendingAction({
        id: 'a1',
        type: 'create',
        resource: 'tx',
        data: {},
        createdAt: new Date(),
        retryCount: 0,
      });
      useGlobalStore.getState().setTheme('dark');

      useGlobalStore.getState().clearSensitiveState();

      const stored = JSON.parse(localStorage.getItem('cashtrace-store') ?? '{}');
      expect(stored.state.pendingActions).toEqual([]);
      // Theme preserved after clearSensitiveState
      expect(stored.state.theme).toBe('dark');
    });
  });
});
