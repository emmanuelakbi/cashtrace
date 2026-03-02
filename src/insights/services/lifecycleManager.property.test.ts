/**
 * Property-based tests for Insight Status Transitions.
 *
 * **Property 5: Status Transitions**
 * For any insight, status transitions SHALL follow valid paths:
 * active → acknowledged → resolved, or active → dismissed, or active → expired.
 *
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';

import { makeScoredInsight } from '../test/fixtures.js';
import type { InsightStatus } from '../types/index.js';

import {
  INSIGHT_ALREADY_RESOLVED,
  INSIGHT_INVALID_TRANSITION,
  InsightLifecycleError,
  LifecycleManager,
} from './lifecycleManager.js';

// ─── Generators ──────────────────────────────────────────────────────────────

const userIdArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/);
const reasonArb = fc.stringMatching(/^[a-zA-Z0-9 .,!?-]{1,100}$/);
const notesArb = fc.stringMatching(/^[a-zA-Z0-9 .,!?-]{1,100}$/);

/** Terminal states that reject all further transitions. */
const terminalStatuses: InsightStatus[] = ['dismissed', 'resolved', 'expired'];

/** Valid transition paths from active to a terminal state. */
type TransitionPath =
  | 'active→acknowledged→resolved'
  | 'active→dismissed'
  | 'active→expired'
  | 'active→acknowledged→expired';

const validPathArb = fc.constantFrom<TransitionPath>(
  'active→acknowledged→resolved',
  'active→dismissed',
  'active→expired',
  'active→acknowledged→expired',
);

/**
 * All invalid (from, to) pairs — transitions that should always be rejected.
 * We exclude transitions to 'active' since there is no API method for that;
 * instead we test that terminal states reject all available operations.
 */
const validTransitionMap: Record<InsightStatus, InsightStatus[]> = {
  active: ['acknowledged', 'dismissed', 'expired'],
  acknowledged: ['resolved', 'expired'],
  dismissed: [],
  resolved: [],
  expired: [],
};

/** Target statuses that have corresponding API methods. */
const apiTargetStatuses: InsightStatus[] = ['acknowledged', 'dismissed', 'resolved', 'expired'];

const invalidTransitions: Array<{ from: InsightStatus; to: InsightStatus }> = [];
const allStatuses: InsightStatus[] = ['active', 'acknowledged', 'dismissed', 'resolved', 'expired'];

for (const from of allStatuses) {
  for (const to of apiTargetStatuses) {
    if (!validTransitionMap[from].includes(to)) {
      invalidTransitions.push({ from, to });
    }
  }
}

const invalidTransitionArb = fc.constantFrom(...invalidTransitions);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Drive an insight to the desired status via valid transitions.
 */
async function driveToStatus(
  manager: LifecycleManager,
  insightId: string,
  target: InsightStatus,
  userId: string,
  reason: string,
  notes: string,
): Promise<void> {
  switch (target) {
    case 'active':
      // Already active after creation
      break;
    case 'acknowledged':
      await manager.acknowledge(insightId, userId);
      break;
    case 'dismissed':
      await manager.dismiss(insightId, userId, reason);
      break;
    case 'resolved':
      await manager.acknowledge(insightId, userId);
      await manager.resolve(insightId, userId, notes);
      break;
    case 'expired':
      await manager.expire(insightId);
      break;
  }
}

/**
 * Attempt a transition to the given target status.
 */
async function attemptTransition(
  manager: LifecycleManager,
  insightId: string,
  target: InsightStatus,
  userId: string,
  reason: string,
  notes: string,
): Promise<void> {
  switch (target) {
    case 'acknowledged':
      await manager.acknowledge(insightId, userId);
      break;
    case 'dismissed':
      await manager.dismiss(insightId, userId, reason);
      break;
    case 'resolved':
      await manager.resolve(insightId, userId, notes);
      break;
    case 'expired':
      await manager.expire(insightId);
      break;
    default:
      throw new Error(`No API method for transitioning to '${target}'`);
  }
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Status Transitions (Property 5)', () => {
  let manager: LifecycleManager;

  beforeEach(() => {
    manager = new LifecycleManager();
  });

  /**
   * Any valid transition path (active→acknowledged→resolved,
   * active→dismissed, active→expired, active→acknowledged→expired)
   * always succeeds.
   *
   * **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
   */
  it('valid transition paths always succeed', async () => {
    await fc.assert(
      fc.asyncProperty(
        validPathArb,
        userIdArb,
        reasonArb,
        notesArb,
        async (path, userId, reason, notes) => {
          const scored = makeScoredInsight();
          const insight = await manager.create(scored);
          expect(insight.status).toBe('active');

          switch (path) {
            case 'active→acknowledged→resolved':
              await manager.acknowledge(insight.id, userId);
              expect(manager.getOrThrow(insight.id).status).toBe('acknowledged');
              await manager.resolve(insight.id, userId, notes);
              expect(manager.getOrThrow(insight.id).status).toBe('resolved');
              break;

            case 'active→dismissed':
              await manager.dismiss(insight.id, userId, reason);
              expect(manager.getOrThrow(insight.id).status).toBe('dismissed');
              break;

            case 'active→expired':
              await manager.expire(insight.id);
              expect(manager.getOrThrow(insight.id).status).toBe('expired');
              break;

            case 'active→acknowledged→expired':
              await manager.acknowledge(insight.id, userId);
              expect(manager.getOrThrow(insight.id).status).toBe('acknowledged');
              await manager.expire(insight.id);
              expect(manager.getOrThrow(insight.id).status).toBe('expired');
              break;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Any invalid transition always throws InsightLifecycleError with
   * INSIGHT_INVALID_TRANSITION or INSIGHT_ALREADY_RESOLVED code.
   *
   * **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
   */
  it('invalid transitions throw InsightLifecycleError', async () => {
    await fc.assert(
      fc.asyncProperty(
        invalidTransitionArb,
        userIdArb,
        reasonArb,
        notesArb,
        async ({ from, to }, userId, reason, notes) => {
          const scored = makeScoredInsight();
          const insight = await manager.create(scored);

          // Drive the insight to the desired `from` status
          await driveToStatus(manager, insight.id, from, userId, reason, notes);
          expect(manager.getOrThrow(insight.id).status).toBe(from);

          // Attempt the invalid transition — should throw
          try {
            await attemptTransition(manager, insight.id, to, userId, reason, notes);
            expect.unreachable('Expected InsightLifecycleError to be thrown');
          } catch (error) {
            expect(error).toBeInstanceOf(InsightLifecycleError);
            const lifecycleError = error as InsightLifecycleError;
            // resolved→resolved uses INSIGHT_ALREADY_RESOLVED; all others use INSIGHT_INVALID_TRANSITION
            if (from === 'resolved' && to === 'resolved') {
              expect(lifecycleError.code).toBe(INSIGHT_ALREADY_RESOLVED);
            } else {
              expect(lifecycleError.code).toBe(INSIGHT_INVALID_TRANSITION);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Terminal states (dismissed, resolved, expired) reject all further transitions.
   *
   * **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
   */
  it('terminal states reject all further transitions', async () => {
    const terminalStatusArb = fc.constantFrom<InsightStatus>(...terminalStatuses);
    const targetStatusArb = fc.constantFrom<InsightStatus>(...apiTargetStatuses);

    await fc.assert(
      fc.asyncProperty(
        terminalStatusArb,
        targetStatusArb,
        userIdArb,
        reasonArb,
        notesArb,
        async (terminal, target, userId, reason, notes) => {
          const scored = makeScoredInsight();
          const insight = await manager.create(scored);

          // Drive to terminal state
          await driveToStatus(manager, insight.id, terminal, userId, reason, notes);
          expect(manager.getOrThrow(insight.id).status).toBe(terminal);

          // Any transition from a terminal state should throw
          try {
            await attemptTransition(manager, insight.id, target, userId, reason, notes);
            expect.unreachable('Expected InsightLifecycleError to be thrown');
          } catch (error) {
            expect(error).toBeInstanceOf(InsightLifecycleError);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  /**
   * After acknowledge, the acknowledgedAt and acknowledgedBy fields are set.
   *
   * **Validates: Requirement 8.1**
   */
  it('acknowledge sets acknowledgedAt and acknowledgedBy', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, async (userId) => {
        const scored = makeScoredInsight();
        const insight = await manager.create(scored);

        expect(insight.acknowledgedAt).toBeNull();
        expect(insight.acknowledgedBy).toBeNull();

        const beforeAck = new Date();
        await manager.acknowledge(insight.id, userId);
        const afterAck = new Date();

        const updated = manager.getOrThrow(insight.id);
        expect(updated.status).toBe('acknowledged');
        expect(updated.acknowledgedBy).toBe(userId);
        expect(updated.acknowledgedAt).toBeInstanceOf(Date);
        expect(updated.acknowledgedAt!.getTime()).toBeGreaterThanOrEqual(beforeAck.getTime());
        expect(updated.acknowledgedAt!.getTime()).toBeLessThanOrEqual(afterAck.getTime());
      }),
      { numRuns: 100 },
    );
  });

  /**
   * After dismiss, the dismissedAt, dismissedBy, and dismissReason fields are set.
   *
   * **Validates: Requirement 8.2**
   */
  it('dismiss sets dismissedAt, dismissedBy, and dismissReason', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, reasonArb, async (userId, reason) => {
        const scored = makeScoredInsight();
        const insight = await manager.create(scored);

        expect(insight.dismissedAt).toBeNull();
        expect(insight.dismissedBy).toBeNull();
        expect(insight.dismissReason).toBeNull();

        const beforeDismiss = new Date();
        await manager.dismiss(insight.id, userId, reason);
        const afterDismiss = new Date();

        const updated = manager.getOrThrow(insight.id);
        expect(updated.status).toBe('dismissed');
        expect(updated.dismissedBy).toBe(userId);
        expect(updated.dismissReason).toBe(reason);
        expect(updated.dismissedAt).toBeInstanceOf(Date);
        expect(updated.dismissedAt!.getTime()).toBeGreaterThanOrEqual(beforeDismiss.getTime());
        expect(updated.dismissedAt!.getTime()).toBeLessThanOrEqual(afterDismiss.getTime());
      }),
      { numRuns: 100 },
    );
  });

  /**
   * After resolve, the resolvedAt, resolvedBy, and resolutionNotes fields are set.
   *
   * **Validates: Requirement 8.3**
   */
  it('resolve sets resolvedAt, resolvedBy, and resolutionNotes', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, notesArb, async (userId, notes) => {
        const scored = makeScoredInsight();
        const insight = await manager.create(scored);

        // Must acknowledge first
        await manager.acknowledge(insight.id, userId);

        expect(manager.getOrThrow(insight.id).resolvedAt).toBeNull();
        expect(manager.getOrThrow(insight.id).resolvedBy).toBeNull();
        expect(manager.getOrThrow(insight.id).resolutionNotes).toBeNull();

        const beforeResolve = new Date();
        await manager.resolve(insight.id, userId, notes);
        const afterResolve = new Date();

        const updated = manager.getOrThrow(insight.id);
        expect(updated.status).toBe('resolved');
        expect(updated.resolvedBy).toBe(userId);
        expect(updated.resolutionNotes).toBe(notes);
        expect(updated.resolvedAt).toBeInstanceOf(Date);
        expect(updated.resolvedAt!.getTime()).toBeGreaterThanOrEqual(beforeResolve.getTime());
        expect(updated.resolvedAt!.getTime()).toBeLessThanOrEqual(afterResolve.getTime());
      }),
      { numRuns: 100 },
    );
  });
});
