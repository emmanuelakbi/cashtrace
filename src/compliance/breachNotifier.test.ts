/**
 * Unit tests for the BreachNotificationService.
 *
 * Validates Requirement 7.6: THE Security_Service SHALL notify users
 * of data breaches within 72 hours.
 *
 * @module compliance/breachNotifier.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BreachNotificationService } from './breachNotifier.js';
import type { RecordIncidentInput } from './breachNotifier.js';

function validInput(): RecordIncidentInput {
  return {
    severity: 'high',
    type: 'breach',
    description: 'Unauthorized access to customer PII',
    affectedUsers: ['user-1', 'user-2'],
  };
}

describe('BreachNotificationService', () => {
  let service: BreachNotificationService;

  beforeEach(() => {
    service = new BreachNotificationService();
  });

  describe('recordIncident', () => {
    it('should create an incident with auto-generated id and detectedAt', async () => {
      const incident = await service.recordIncident(validInput());

      expect(incident.id).toBeDefined();
      expect(incident.severity).toBe('high');
      expect(incident.type).toBe('breach');
      expect(incident.description).toBe('Unauthorized access to customer PII');
      expect(incident.affectedUsers).toEqual(['user-1', 'user-2']);
      expect(incident.detectedAt).toBeInstanceOf(Date);
      expect(incident.notificationSentAt).toBeUndefined();
    });

    it('should throw if description is missing', async () => {
      await expect(service.recordIncident({ ...validInput(), description: '' })).rejects.toThrow(
        'description',
      );
    });

    it('should throw if affectedUsers is empty', async () => {
      await expect(service.recordIncident({ ...validInput(), affectedUsers: [] })).rejects.toThrow(
        'affected user',
      );
    });

    it('should not mutate the input affectedUsers array', async () => {
      const input = validInput();
      const original = [...input.affectedUsers];
      const incident = await service.recordIncident(input);
      incident.affectedUsers.push('user-3');
      expect(input.affectedUsers).toEqual(original);
    });
  });

  describe('getIncident', () => {
    it('should return an incident by id', async () => {
      const created = await service.recordIncident(validInput());
      const fetched = await service.getIncident(created.id);
      expect(fetched).toEqual(created);
    });

    it('should return undefined for unknown id', async () => {
      const result = await service.getIncident('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('sendNotifications', () => {
    it('should send notifications to all affected users', async () => {
      const incident = await service.recordIncident(validInput());
      const notifications = await service.sendNotifications(incident.id);

      expect(notifications).toHaveLength(2);
      expect(notifications[0].userId).toBe('user-1');
      expect(notifications[1].userId).toBe('user-2');
      expect(notifications[0].incidentId).toBe(incident.id);
      expect(notifications[0].sentAt).toBeInstanceOf(Date);
      expect(notifications[0].message).toContain('Security incident alert');
    });

    it('should set notificationSentAt on the incident', async () => {
      const incident = await service.recordIncident(validInput());
      await service.sendNotifications(incident.id);

      const updated = await service.getIncident(incident.id);
      expect(updated?.notificationSentAt).toBeInstanceOf(Date);
    });

    it('should throw for unknown incident', async () => {
      await expect(service.sendNotifications('nonexistent')).rejects.toThrow('not found');
    });

    it('should throw if notifications already sent', async () => {
      const incident = await service.recordIncident(validInput());
      await service.sendNotifications(incident.id);
      await expect(service.sendNotifications(incident.id)).rejects.toThrow('already sent');
    });
  });

  describe('getBreachStatus', () => {
    it('should return status with deadline 72 hours from detection', async () => {
      const incident = await service.recordIncident(validInput());
      const status = await service.getBreachStatus(incident.id);

      const expectedDeadline = incident.detectedAt.getTime() + 72 * 60 * 60 * 1000;
      expect(status.deadlineAt.getTime()).toBe(expectedDeadline);
      expect(status.notified).toBe(false);
      expect(status.notifications).toHaveLength(0);
      expect(status.overdue).toBe(false);
    });

    it('should reflect notified status after sending notifications', async () => {
      const incident = await service.recordIncident(validInput());
      await service.sendNotifications(incident.id);
      const status = await service.getBreachStatus(incident.id);

      expect(status.notified).toBe(true);
      expect(status.notifications).toHaveLength(2);
      expect(status.overdue).toBe(false);
    });

    it('should throw for unknown incident', async () => {
      await expect(service.getBreachStatus('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('listIncidents', () => {
    it('should return all incidents when no filter', async () => {
      await service.recordIncident(validInput());
      await service.recordIncident({ ...validInput(), type: 'data_loss' });

      const all = await service.listIncidents();
      expect(all).toHaveLength(2);
    });

    it('should filter by type', async () => {
      await service.recordIncident(validInput());
      await service.recordIncident({ ...validInput(), type: 'data_loss' });

      const breaches = await service.listIncidents('breach');
      expect(breaches).toHaveLength(1);
      expect(breaches[0].type).toBe('breach');
    });

    it('should return empty array when no incidents match', async () => {
      await service.recordIncident(validInput());
      const result = await service.listIncidents('vulnerability');
      expect(result).toHaveLength(0);
    });
  });

  describe('getOverdueIncidents', () => {
    it('should return empty when all incidents are notified', async () => {
      const incident = await service.recordIncident(validInput());
      await service.sendNotifications(incident.id);

      const overdue = await service.getOverdueIncidents();
      expect(overdue).toHaveLength(0);
    });

    it('should return empty when incidents are within deadline', async () => {
      await service.recordIncident(validInput());
      const overdue = await service.getOverdueIncidents();
      expect(overdue).toHaveLength(0);
    });
  });

  describe('wasNotifiedWithinDeadline', () => {
    it('should return true when notified immediately', async () => {
      const incident = await service.recordIncident(validInput());
      await service.sendNotifications(incident.id);

      const withinDeadline = await service.wasNotifiedWithinDeadline(incident.id);
      expect(withinDeadline).toBe(true);
    });

    it('should throw for unknown incident', async () => {
      await expect(service.wasNotifiedWithinDeadline('nonexistent')).rejects.toThrow('not found');
    });

    it('should throw if not yet notified', async () => {
      const incident = await service.recordIncident(validInput());
      await expect(service.wasNotifiedWithinDeadline(incident.id)).rejects.toThrow(
        'not been notified',
      );
    });
  });
});
