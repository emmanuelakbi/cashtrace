/**
 * Property-based tests for Breach Notification
 *
 * **Property 9: Breach Notification**
 * For any confirmed data breach, affected users SHALL be notified
 * within 72 hours.
 *
 * **Validates: Requirements 7.6**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { BreachNotificationService } from './breachNotifier.js';
import type { RecordIncidentInput } from './breachNotifier.js';
import type { IncidentSeverity, IncidentType } from './types.js';

const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;

// ─── Generators ──────────────────────────────────────────────────────────────

const severityArb: fc.Arbitrary<IncidentSeverity> = fc.constantFrom(
  'critical',
  'high',
  'medium',
  'low',
);

const incidentTypeArb: fc.Arbitrary<IncidentType> = fc.constantFrom(
  'breach',
  'unauthorized_access',
  'data_loss',
  'vulnerability',
);

const userIdArb = fc.stringMatching(/^user-[a-z0-9]{1,12}$/);

const descriptionArb = fc.stringMatching(/^[A-Za-z0-9 ]{5,60}$/);

const affectedUsersArb = fc.array(userIdArb, { minLength: 1, maxLength: 20 });

const incidentInputArb: fc.Arbitrary<RecordIncidentInput> = fc.record({
  severity: severityArb,
  type: incidentTypeArb,
  description: descriptionArb,
  affectedUsers: affectedUsersArb,
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Breach Notification (Property 9)', () => {
  /**
   * For any incident with any combination of severity, type, and affected
   * users, when notifications are sent immediately after recording, the
   * notification is within the 72-hour deadline.
   */
  it('immediate notification is always within the 72-hour deadline', async () => {
    await fc.assert(
      fc.asyncProperty(incidentInputArb, async (input) => {
        const service = new BreachNotificationService();
        const incident = await service.recordIncident(input);
        await service.sendNotifications(incident.id);

        const withinDeadline = await service.wasNotifiedWithinDeadline(incident.id);
        expect(withinDeadline).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any incident, the breach status deadline is always exactly 72 hours
   * after the detection time.
   */
  it('deadline is always exactly 72 hours from detection', async () => {
    await fc.assert(
      fc.asyncProperty(incidentInputArb, async (input) => {
        const service = new BreachNotificationService();
        const incident = await service.recordIncident(input);
        const status = await service.getBreachStatus(incident.id);

        const expectedDeadline = incident.detectedAt.getTime() + SEVENTY_TWO_HOURS_MS;
        expect(status.deadlineAt.getTime()).toBe(expectedDeadline);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any incident, every affected user receives exactly one notification
   * when sendNotifications is called.
   */
  it('all affected users are notified for any breach', async () => {
    await fc.assert(
      fc.asyncProperty(incidentInputArb, async (input) => {
        const service = new BreachNotificationService();
        const incident = await service.recordIncident(input);
        const notifications = await service.sendNotifications(incident.id);

        const notifiedUserIds = notifications.map((n) => n.userId);
        expect(notifiedUserIds).toEqual(input.affectedUsers);

        for (const notification of notifications) {
          expect(notification.incidentId).toBe(incident.id);
          expect(notification.sentAt).toBeInstanceOf(Date);
          expect(notification.message).toBeTruthy();
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any incident that has been notified, the breach status correctly
   * reflects the notified state and is not overdue.
   */
  it('breach status reflects notified state after sending notifications', async () => {
    await fc.assert(
      fc.asyncProperty(incidentInputArb, async (input) => {
        const service = new BreachNotificationService();
        const incident = await service.recordIncident(input);
        await service.sendNotifications(incident.id);

        const status = await service.getBreachStatus(incident.id);
        expect(status.notified).toBe(true);
        expect(status.overdue).toBe(false);
        expect(status.notifications).toHaveLength(input.affectedUsers.length);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any incident that has NOT been notified, the breach status correctly
   * reflects the un-notified state.
   */
  it('breach status reflects un-notified state before sending', async () => {
    await fc.assert(
      fc.asyncProperty(incidentInputArb, async (input) => {
        const service = new BreachNotificationService();
        const incident = await service.recordIncident(input);

        const status = await service.getBreachStatus(incident.id);
        expect(status.notified).toBe(false);
        expect(status.notifications).toHaveLength(0);
        expect(status.incident.id).toBe(incident.id);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any incident where notification is sent within the 72-hour window,
   * wasNotifiedWithinDeadline returns true. We simulate elapsed time by
   * shifting detectedAt into the past by a random offset < 72 hours.
   */
  it('notification sent within 72h is always within deadline', async () => {
    const offsetWithinDeadlineArb = fc.integer({ min: 0, max: SEVENTY_TWO_HOURS_MS });

    await fc.assert(
      fc.asyncProperty(incidentInputArb, offsetWithinDeadlineArb, async (input, offsetMs) => {
        const service = new BreachNotificationService();
        const incident = await service.recordIncident(input);

        // Shift detectedAt into the past so that "now" is offsetMs after detection
        incident.detectedAt = new Date(Date.now() - offsetMs);

        await service.sendNotifications(incident.id);
        const withinDeadline = await service.wasNotifiedWithinDeadline(incident.id);
        expect(withinDeadline).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * For any incident where notification is sent after the 72-hour window,
   * wasNotifiedWithinDeadline returns false and breach status shows overdue.
   * We simulate by shifting detectedAt far enough into the past that the
   * deadline has already passed.
   */
  it('notification sent after 72h is always overdue', async () => {
    // Offset beyond the deadline: 72h + 1ms to 144h
    const offsetBeyondDeadlineArb = fc.integer({
      min: SEVENTY_TWO_HOURS_MS + 1,
      max: SEVENTY_TWO_HOURS_MS * 2,
    });

    await fc.assert(
      fc.asyncProperty(incidentInputArb, offsetBeyondDeadlineArb, async (input, offsetMs) => {
        const service = new BreachNotificationService();
        const incident = await service.recordIncident(input);

        // Shift detectedAt so the 72h deadline has already passed
        incident.detectedAt = new Date(Date.now() - offsetMs);

        await service.sendNotifications(incident.id);
        const withinDeadline = await service.wasNotifiedWithinDeadline(incident.id);
        expect(withinDeadline).toBe(false);

        const status = await service.getBreachStatus(incident.id);
        expect(status.overdue).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
