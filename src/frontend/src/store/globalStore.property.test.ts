/**
 * Property-based tests for offline action persistence.
 *
 * **Property 3: Offline Action Persistence**
 * **Validates: Requirements 10.3, 10.5**
 *
 * For any action performed while offline, it SHALL be persisted to localStorage
 * and synced when connection is restored.
 *
 * Properties verified:
 *  1. Any action added while offline is persisted to localStorage
 *  2. Actions accumulate correctly (no data loss)
 *  3. clearPendingActions removes all actions from both store and localStorage
 *  4. Actions survive store rehydration (simulating app restart)
 */
import { act } from '@testing-library/react';
import * as fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';

import { useGlobalStore } from './globalStore';
import type { PendingAction } from './types';

// ---------------------------------------------------------------------------
// Arbitrary generators
// ---------------------------------------------------------------------------

const actionTypeArb = fc.constantFrom('create' as const, 'update' as const, 'delete' as const);

const pendingActionArb: fc.Arbitrary<PendingAction> = fc.record({
  id: fc.uuid(),
  type: actionTypeArb,
  resource: fc.stringMatching(/^[a-zA-Z0-9]{1,30}$/),
  data: fc.oneof(
    fc.constant(null),
    fc.integer(),
    fc.string(),
    fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.integer()),
  ),
  createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
  retryCount: fc.nat({ max: 10 }),
});

const pendingActionsArb = fc.array(pendingActionArb, { minLength: 1, maxLength: 20 });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore(): void {
  try {
    localStorage.removeItem('cashtrace-store');
  } catch {
    // noop
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

/** Read persisted pendingActions from localStorage. */
function readPersistedActions(): unknown[] {
  const raw = localStorage.getItem('cashtrace-store');
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { state?: { pendingActions?: unknown[] } };
  return parsed.state?.pendingActions ?? [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Property 3: Offline Action Persistence', () => {
  beforeEach(() => {
    resetStore();
  });

  /**
   * **Validates: Requirements 10.3**
   * Any action added while offline is immediately persisted to localStorage.
   */
  it('persists every offline action to localStorage', () => {
    fc.assert(
      fc.property(pendingActionArb, (action) => {
        resetStore();

        // Simulate offline
        act(() => {
          useGlobalStore.getState().setIsOnline(false);
        });

        act(() => {
          useGlobalStore.getState().addPendingAction(action);
        });

        const persisted = readPersistedActions();
        expect(persisted).toHaveLength(1);
        expect((persisted[0] as { id: string }).id).toBe(action.id);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 10.3**
   * Multiple actions accumulate without data loss — the count in the store and
   * localStorage always matches the number of actions added.
   */
  it('accumulates actions without data loss', () => {
    fc.assert(
      fc.property(pendingActionsArb, (actions) => {
        resetStore();

        act(() => {
          useGlobalStore.getState().setIsOnline(false);
        });

        for (const action of actions) {
          act(() => {
            useGlobalStore.getState().addPendingAction(action);
          });
        }

        // Store state matches
        const storeActions = useGlobalStore.getState().pendingActions;
        expect(storeActions).toHaveLength(actions.length);

        // localStorage matches
        const persisted = readPersistedActions();
        expect(persisted).toHaveLength(actions.length);

        // IDs preserved in order
        const storeIds = storeActions.map((a) => a.id);
        const expectedIds = actions.map((a) => a.id);
        expect(storeIds).toEqual(expectedIds);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 10.5**
   * clearPendingActions removes all actions from both the Zustand store and
   * localStorage, leaving zero pending actions.
   */
  it('clearPendingActions removes actions from store and localStorage', () => {
    fc.assert(
      fc.property(pendingActionsArb, (actions) => {
        resetStore();

        act(() => {
          useGlobalStore.getState().setIsOnline(false);
        });

        for (const action of actions) {
          act(() => {
            useGlobalStore.getState().addPendingAction(action);
          });
        }

        // Precondition: actions exist
        expect(useGlobalStore.getState().pendingActions.length).toBeGreaterThan(0);

        act(() => {
          useGlobalStore.getState().clearPendingActions();
        });

        expect(useGlobalStore.getState().pendingActions).toEqual([]);
        expect(readPersistedActions()).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 10.3, 10.5**
   * Actions survive store rehydration — simulating an app restart by seeding
   * localStorage and calling rehydrate, then verifying the store contains the
   * same actions.
   */
  it('actions survive store rehydration (app restart)', async () => {
    await fc.assert(
      fc.asyncProperty(pendingActionsArb, async (actions) => {
        resetStore();

        // Simulate offline + add actions
        act(() => {
          useGlobalStore.getState().setIsOnline(false);
        });

        for (const action of actions) {
          act(() => {
            useGlobalStore.getState().addPendingAction(action);
          });
        }

        // Snapshot localStorage before "restart"
        const snapshot = localStorage.getItem('cashtrace-store');
        expect(snapshot).not.toBeNull();

        // Simulate app restart: clear in-memory state (which also writes to
        // localStorage via persist middleware), then restore the snapshot and
        // rehydrate — mimicking a fresh page load with existing persisted data.
        act(() => {
          useGlobalStore.setState({ pendingActions: [] });
        });
        expect(useGlobalStore.getState().pendingActions).toEqual([]);

        // Restore the pre-restart localStorage snapshot
        localStorage.setItem('cashtrace-store', snapshot!);

        await useGlobalStore.persist.rehydrate();

        const rehydrated = useGlobalStore.getState().pendingActions;
        expect(rehydrated).toHaveLength(actions.length);

        // Verify IDs match (order preserved)
        const rehydratedIds = rehydrated.map((a) => a.id);
        const expectedIds = actions.map((a) => a.id);
        expect(rehydratedIds).toEqual(expectedIds);
      }),
      { numRuns: 100 },
    );
  });
});
