/**
 * Breach Notification Service for CashTrace Security & Compliance Module.
 *
 * Records security incidents, tracks notification status, and ensures
 * affected users are notified within 72 hours of breach detection.
 *
 * @module compliance/breachNotifier
 *
 * Requirement 7.6: THE Security_Service SHALL notify users of data breaches within 72 hours.
 */

import { randomUUID } from 'node:crypto';
import type { SecurityIncident, IncidentSeverity, IncidentType } from './types.js';

/** 72 hours in milliseconds. */
const NOTIFICATION_DEADLINE_MS = 72 * 60 * 60 * 1000;

/**
 * Notification sent to affected users about a breach.
 */
export interface BreachNotification {
  incidentId: string;
  userId: string;
  sentAt: Date;
  message: string;
}

/**
 * Input for recording a new security incident.
 */
export interface RecordIncidentInput {
  severity: IncidentSeverity;
  type: IncidentType;
  description: string;
  affectedUsers: string[];
}

/**
 * Summary of breach notification status for an incident.
 */
export interface BreachStatus {
  incident: SecurityIncident;
  notified: boolean;
  notifications: BreachNotification[];
  deadlineAt: Date;
  overdue: boolean;
}

export class BreachNotificationService {
  private readonly incidents = new Map<string, SecurityIncident>();
  private readonly notifications = new Map<string, BreachNotification[]>();

  /**
   * Record a new security incident.
   *
   * @param input - Incident details.
   * @returns The created SecurityIncident.
   * @throws Error if required fields are missing.
   */
  async recordIncident(input: RecordIncidentInput): Promise<SecurityIncident> {
    if (!input.description) {
      throw new Error('Incident requires a description');
    }
    if (!input.affectedUsers || input.affectedUsers.length === 0) {
      throw new Error('Incident requires at least one affected user');
    }

    const incident: SecurityIncident = {
      id: randomUUID(),
      severity: input.severity,
      type: input.type,
      description: input.description,
      affectedUsers: [...input.affectedUsers],
      detectedAt: new Date(),
    };

    this.incidents.set(incident.id, incident);
    this.notifications.set(incident.id, []);
    return incident;
  }

  /**
   * Get a security incident by ID.
   */
  async getIncident(incidentId: string): Promise<SecurityIncident | undefined> {
    return this.incidents.get(incidentId);
  }

  /**
   * Send breach notifications to all affected users for an incident.
   * Sets `notificationSentAt` on the incident.
   *
   * @param incidentId - The incident to notify about.
   * @returns Array of notifications sent.
   * @throws Error if the incident is not found or notifications were already sent.
   */
  async sendNotifications(incidentId: string): Promise<BreachNotification[]> {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }
    if (incident.notificationSentAt) {
      throw new Error(`Notifications already sent for incident: ${incidentId}`);
    }

    const now = new Date();
    const sent: BreachNotification[] = incident.affectedUsers.map((userId) => ({
      incidentId,
      userId,
      sentAt: now,
      message: `Security incident alert: ${incident.description}`,
    }));

    incident.notificationSentAt = now;
    this.incidents.set(incidentId, incident);
    this.notifications.set(incidentId, sent);

    return sent;
  }

  /**
   * Check whether the notification deadline (72 hours) has been met or is overdue.
   *
   * @param incidentId - The incident to check.
   * @returns BreachStatus with notification and deadline info.
   * @throws Error if the incident is not found.
   */
  async getBreachStatus(incidentId: string): Promise<BreachStatus> {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    const deadlineAt = new Date(incident.detectedAt.getTime() + NOTIFICATION_DEADLINE_MS);
    const notifications = this.notifications.get(incidentId) ?? [];
    const notified = incident.notificationSentAt != null;

    const referenceTime = incident.notificationSentAt ?? new Date();
    const overdue = referenceTime.getTime() > deadlineAt.getTime();

    return {
      incident,
      notified,
      notifications,
      deadlineAt,
      overdue,
    };
  }

  /**
   * List all incidents, optionally filtered by type.
   */
  async listIncidents(type?: IncidentType): Promise<SecurityIncident[]> {
    const all = Array.from(this.incidents.values());
    if (type) {
      return all.filter((i) => i.type === type);
    }
    return all;
  }

  /**
   * List all incidents that are overdue for notification (detected > 72h ago, not yet notified).
   */
  async getOverdueIncidents(): Promise<SecurityIncident[]> {
    const now = new Date();
    const overdue: SecurityIncident[] = [];

    for (const incident of this.incidents.values()) {
      if (incident.notificationSentAt) continue;
      const deadline = incident.detectedAt.getTime() + NOTIFICATION_DEADLINE_MS;
      if (now.getTime() > deadline) {
        overdue.push(incident);
      }
    }

    return overdue;
  }

  /**
   * Check if notification was sent within the 72-hour window.
   *
   * @returns true if notified within deadline, false otherwise.
   * @throws Error if incident not found or not yet notified.
   */
  async wasNotifiedWithinDeadline(incidentId: string): Promise<boolean> {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }
    if (!incident.notificationSentAt) {
      throw new Error(`Incident has not been notified yet: ${incidentId}`);
    }

    const deadline = incident.detectedAt.getTime() + NOTIFICATION_DEADLINE_MS;
    return incident.notificationSentAt.getTime() <= deadline;
  }
}
