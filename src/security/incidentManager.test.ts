import { describe, it, expect, beforeEach } from 'vitest';
import { IncidentManager } from './incidentManager.js';
import type { EscalationProcedure, IncidentSeverity, TimelineEntryType } from './types.js';

const baseDate = new Date('2024-06-01T12:00:00Z');

function createManager() {
  return new IncidentManager();
}

describe('IncidentManager', () => {
  let manager: IncidentManager;

  beforeEach(() => {
    manager = createManager();
  });

  // ─── Severity Levels (Requirement 10.1) ───

  describe('severity levels', () => {
    const severities: IncidentSeverity[] = ['critical', 'high', 'medium', 'low'];

    it.each(severities)('supports creating an incident with %s severity', (severity) => {
      const incident = manager.createIncident({
        severity,
        type: 'breach',
        description: `${severity} incident`,
        detectedAt: baseDate,
      });

      expect(incident.severity).toBe(severity);
      expect(incident.status).toBe('open');
    });
  });

  // ─── createIncident ───

  describe('createIncident()', () => {
    it('creates an incident with all provided fields', () => {
      const incident = manager.createIncident({
        severity: 'high',
        type: 'unauthorized_access',
        description: 'Suspicious login detected',
        affectedUsers: ['user-1', 'user-2'],
        detectedAt: baseDate,
      });

      expect(incident.id).toBeDefined();
      expect(incident.severity).toBe('high');
      expect(incident.type).toBe('unauthorized_access');
      expect(incident.status).toBe('open');
      expect(incident.description).toBe('Suspicious login detected');
      expect(incident.affectedUsers).toEqual(['user-1', 'user-2']);
      expect(incident.detectedAt).toEqual(baseDate);
    });

    it('defaults affectedUsers to empty array', () => {
      const incident = manager.createIncident({
        severity: 'low',
        type: 'vulnerability',
        description: 'Minor vuln found',
        detectedAt: baseDate,
      });

      expect(incident.affectedUsers).toEqual([]);
    });

    it('assigns a unique id to each incident', () => {
      const a = manager.createIncident({
        severity: 'medium',
        type: 'data_loss',
        description: 'Incident A',
        detectedAt: baseDate,
      });
      const b = manager.createIncident({
        severity: 'medium',
        type: 'data_loss',
        description: 'Incident B',
        detectedAt: baseDate,
      });

      expect(a.id).not.toBe(b.id);
    });

    it('stores the incident for later retrieval', () => {
      const created = manager.createIncident({
        severity: 'critical',
        type: 'breach',
        description: 'Data breach',
        detectedAt: baseDate,
      });

      const retrieved = manager.getIncident(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(created.id);
    });
  });

  // ─── updateIncident ───

  describe('updateIncident()', () => {
    it('updates incident fields', () => {
      const incident = manager.createIncident({
        severity: 'high',
        type: 'breach',
        description: 'Initial',
        detectedAt: baseDate,
      });

      const updated = manager.updateIncident(incident.id, {
        description: 'Updated description',
        rootCause: 'Weak credentials',
      });

      expect(updated).toBeDefined();
      expect(updated!.description).toBe('Updated description');
      expect(updated!.rootCause).toBe('Weak credentials');
    });

    it('auto-sets resolvedAt when status becomes resolved', () => {
      const incident = manager.createIncident({
        severity: 'medium',
        type: 'vulnerability',
        description: 'Vuln',
        detectedAt: baseDate,
      });

      const updated = manager.updateIncident(incident.id, { status: 'resolved' });

      expect(updated!.status).toBe('resolved');
      expect(updated!.resolvedAt).toBeDefined();
    });

    it('auto-sets containedAt when status becomes contained', () => {
      const incident = manager.createIncident({
        severity: 'high',
        type: 'breach',
        description: 'Breach',
        detectedAt: baseDate,
      });

      const updated = manager.updateIncident(incident.id, { status: 'contained' });

      expect(updated!.status).toBe('contained');
      expect(updated!.containedAt).toBeDefined();
    });

    it('does not overwrite explicit resolvedAt', () => {
      const resolvedDate = new Date('2024-06-02T00:00:00Z');
      const incident = manager.createIncident({
        severity: 'low',
        type: 'vulnerability',
        description: 'Vuln',
        detectedAt: baseDate,
      });

      const updated = manager.updateIncident(incident.id, {
        status: 'resolved',
        resolvedAt: resolvedDate,
      });

      expect(updated!.resolvedAt).toEqual(resolvedDate);
    });

    it('returns undefined for unknown incident', () => {
      const result = manager.updateIncident('nonexistent', { status: 'closed' });
      expect(result).toBeUndefined();
    });
  });

  // ─── getIncident / getIncidents ───

  describe('getIncident()', () => {
    it('returns undefined for unknown id', () => {
      expect(manager.getIncident('unknown')).toBeUndefined();
    });

    it('returns a copy (not a reference)', () => {
      const created = manager.createIncident({
        severity: 'high',
        type: 'breach',
        description: 'Test',
        detectedAt: baseDate,
      });

      const a = manager.getIncident(created.id);
      const b = manager.getIncident(created.id);
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
    });
  });

  describe('getIncidents()', () => {
    it('returns all incidents when no filter is provided', () => {
      manager.createIncident({
        severity: 'critical',
        type: 'breach',
        description: 'A',
        detectedAt: baseDate,
      });
      manager.createIncident({
        severity: 'low',
        type: 'vulnerability',
        description: 'B',
        detectedAt: baseDate,
      });

      expect(manager.getIncidents()).toHaveLength(2);
    });

    it('filters by status', () => {
      const incident = manager.createIncident({
        severity: 'high',
        type: 'breach',
        description: 'A',
        detectedAt: baseDate,
      });
      manager.createIncident({
        severity: 'low',
        type: 'vulnerability',
        description: 'B',
        detectedAt: baseDate,
      });
      manager.updateIncident(incident.id, { status: 'resolved' });

      expect(manager.getIncidents({ status: 'resolved' })).toHaveLength(1);
      expect(manager.getIncidents({ status: 'open' })).toHaveLength(1);
    });

    it('filters by severity', () => {
      manager.createIncident({
        severity: 'critical',
        type: 'breach',
        description: 'A',
        detectedAt: baseDate,
      });
      manager.createIncident({
        severity: 'low',
        type: 'vulnerability',
        description: 'B',
        detectedAt: baseDate,
      });
      manager.createIncident({
        severity: 'critical',
        type: 'data_loss',
        description: 'C',
        detectedAt: baseDate,
      });

      expect(manager.getIncidents({ severity: 'critical' })).toHaveLength(2);
      expect(manager.getIncidents({ severity: 'low' })).toHaveLength(1);
      expect(manager.getIncidents({ severity: 'medium' })).toHaveLength(0);
    });

    it('filters by both status and severity', () => {
      const a = manager.createIncident({
        severity: 'critical',
        type: 'breach',
        description: 'A',
        detectedAt: baseDate,
      });
      manager.createIncident({
        severity: 'critical',
        type: 'data_loss',
        description: 'B',
        detectedAt: baseDate,
      });
      manager.updateIncident(a.id, { status: 'resolved' });

      expect(manager.getIncidents({ status: 'resolved', severity: 'critical' })).toHaveLength(1);
      expect(manager.getIncidents({ status: 'open', severity: 'critical' })).toHaveLength(1);
    });

    it('returns empty array when no incidents exist', () => {
      expect(manager.getIncidents()).toHaveLength(0);
    });
  });

  // ─── Escalation Procedures (Requirement 10.2) ───

  describe('getEscalationProcedure()', () => {
    it('returns immediate response for critical severity', () => {
      const procedure = manager.getEscalationProcedure('critical');

      expect(procedure.severity).toBe('critical');
      expect(procedure.responseTimeMs).toBe(0);
      expect(procedure.notifyRoles).toContain('executive');
      expect(procedure.notifyRoles).toContain('incident_commander');
    });

    it('returns 1-hour response for high severity', () => {
      const procedure = manager.getEscalationProcedure('high');

      expect(procedure.severity).toBe('high');
      expect(procedure.responseTimeMs).toBe(1 * 60 * 60 * 1000);
      expect(procedure.notifyRoles).toContain('team_lead');
    });

    it('returns 4-hour response for medium severity', () => {
      const procedure = manager.getEscalationProcedure('medium');

      expect(procedure.severity).toBe('medium');
      expect(procedure.responseTimeMs).toBe(4 * 60 * 60 * 1000);
      expect(procedure.notifyRoles).toContain('security_team');
    });

    it('returns next-business-day response for low severity', () => {
      const procedure = manager.getEscalationProcedure('low');

      expect(procedure.severity).toBe('low');
      expect(procedure.responseTimeMs).toBe(8 * 60 * 60 * 1000);
      expect(procedure.notifyRoles).toContain('security_team');
    });

    it('returns a copy (not a reference)', () => {
      const a = manager.getEscalationProcedure('critical');
      const b = manager.getEscalationProcedure('critical');
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
    });
  });

  describe('escalate()', () => {
    it('creates an escalation record for an incident', () => {
      const incident = manager.createIncident({
        severity: 'critical',
        type: 'breach',
        description: 'Data breach detected',
        detectedAt: baseDate,
      });

      const record = manager.escalate(incident.id, baseDate);

      expect(record).toBeDefined();
      expect(record!.incidentId).toBe(incident.id);
      expect(record!.severity).toBe('critical');
      expect(record!.escalatedAt).toEqual(baseDate);
      expect(record!.notifiedRoles).toContain('executive');
      expect(record!.procedure.severity).toBe('critical');
    });

    it('uses the correct procedure for the incident severity', () => {
      const incident = manager.createIncident({
        severity: 'medium',
        type: 'unauthorized_access',
        description: 'Unauthorized access attempt',
        detectedAt: baseDate,
      });

      const record = manager.escalate(incident.id, baseDate);

      expect(record!.procedure.responseTimeMs).toBe(4 * 60 * 60 * 1000);
      expect(record!.notifiedRoles).toContain('security_team');
    });

    it('returns undefined for unknown incident', () => {
      const result = manager.escalate('nonexistent', baseDate);
      expect(result).toBeUndefined();
    });

    it('allows multiple escalations for the same incident', () => {
      const incident = manager.createIncident({
        severity: 'high',
        type: 'breach',
        description: 'Breach',
        detectedAt: baseDate,
      });

      manager.escalate(incident.id, baseDate);
      manager.escalate(incident.id, new Date(baseDate.getTime() + 60 * 60 * 1000));

      const records = manager.getEscalationRecords(incident.id);
      expect(records).toHaveLength(2);
    });
  });

  describe('getEscalationRecords()', () => {
    it('returns all records when no filter is provided', () => {
      const a = manager.createIncident({
        severity: 'critical',
        type: 'breach',
        description: 'A',
        detectedAt: baseDate,
      });
      const b = manager.createIncident({
        severity: 'low',
        type: 'vulnerability',
        description: 'B',
        detectedAt: baseDate,
      });

      manager.escalate(a.id, baseDate);
      manager.escalate(b.id, baseDate);

      expect(manager.getEscalationRecords()).toHaveLength(2);
    });

    it('filters records by incident id', () => {
      const a = manager.createIncident({
        severity: 'critical',
        type: 'breach',
        description: 'A',
        detectedAt: baseDate,
      });
      const b = manager.createIncident({
        severity: 'low',
        type: 'vulnerability',
        description: 'B',
        detectedAt: baseDate,
      });

      manager.escalate(a.id, baseDate);
      manager.escalate(b.id, baseDate);

      expect(manager.getEscalationRecords(a.id)).toHaveLength(1);
      expect(manager.getEscalationRecords(a.id)[0]!.severity).toBe('critical');
    });

    it('returns empty array when no escalations exist', () => {
      expect(manager.getEscalationRecords()).toHaveLength(0);
    });
  });

  // ─── Custom Escalation Procedures ───

  describe('custom escalation procedures', () => {
    it('accepts custom escalation procedures via constructor', () => {
      const customProcedures: Record<IncidentSeverity, EscalationProcedure> = {
        critical: {
          severity: 'critical',
          responseTimeMs: 5 * 60 * 1000, // 5 minutes
          notifyRoles: ['ceo', 'cto'],
          description: 'Immediate C-suite notification.',
        },
        high: {
          severity: 'high',
          responseTimeMs: 30 * 60 * 1000,
          notifyRoles: ['vp_engineering'],
          description: 'VP notification within 30 minutes.',
        },
        medium: {
          severity: 'medium',
          responseTimeMs: 2 * 60 * 60 * 1000,
          notifyRoles: ['engineering_lead'],
          description: 'Engineering lead within 2 hours.',
        },
        low: {
          severity: 'low',
          responseTimeMs: 24 * 60 * 60 * 1000,
          notifyRoles: ['on_call'],
          description: 'On-call within 24 hours.',
        },
      };

      const customManager = new IncidentManager({ escalationProcedures: customProcedures });

      const procedure = customManager.getEscalationProcedure('critical');
      expect(procedure.responseTimeMs).toBe(5 * 60 * 1000);
      expect(procedure.notifyRoles).toEqual(['ceo', 'cto']);
    });
  });

  // ─── Timeline Tracking (Requirement 10.3) ───

  describe('addTimelineEntry()', () => {
    it('adds a timeline entry to an existing incident', () => {
      const incident = manager.createIncident({
        severity: 'high',
        type: 'breach',
        description: 'Breach detected',
        detectedAt: baseDate,
      });

      const entry = manager.addTimelineEntry(incident.id, {
        description: 'Anomalous traffic detected by IDS',
        author: 'security-bot',
        entryType: 'detection',
        timestamp: baseDate,
      });

      expect(entry).toBeDefined();
      expect(entry!.id).toBeDefined();
      expect(entry!.incidentId).toBe(incident.id);
      expect(entry!.description).toBe('Anomalous traffic detected by IDS');
      expect(entry!.author).toBe('security-bot');
      expect(entry!.entryType).toBe('detection');
      expect(entry!.timestamp).toEqual(baseDate);
    });

    it('returns undefined for a nonexistent incident', () => {
      const result = manager.addTimelineEntry('nonexistent', {
        description: 'Entry',
        author: 'admin',
        entryType: 'other',
      });
      expect(result).toBeUndefined();
    });

    it('defaults timestamp to current time when not provided', () => {
      const incident = manager.createIncident({
        severity: 'low',
        type: 'vulnerability',
        description: 'Vuln',
        detectedAt: baseDate,
      });

      const before = new Date();
      const entry = manager.addTimelineEntry(incident.id, {
        description: 'Auto-detected',
        author: 'scanner',
        entryType: 'detection',
      });
      const after = new Date();

      expect(entry!.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(entry!.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('supports all entry types', () => {
      const incident = manager.createIncident({
        severity: 'medium',
        type: 'unauthorized_access',
        description: 'Unauthorized access',
        detectedAt: baseDate,
      });

      const entryTypes: TimelineEntryType[] = [
        'detection',
        'investigation',
        'containment',
        'resolution',
        'notification',
        'other',
      ];

      for (const entryType of entryTypes) {
        const entry = manager.addTimelineEntry(incident.id, {
          description: `${entryType} step`,
          author: 'admin',
          entryType,
          timestamp: baseDate,
        });
        expect(entry!.entryType).toBe(entryType);
      }
    });

    it('assigns unique ids to each entry', () => {
      const incident = manager.createIncident({
        severity: 'high',
        type: 'breach',
        description: 'Breach',
        detectedAt: baseDate,
      });

      const a = manager.addTimelineEntry(incident.id, {
        description: 'First',
        author: 'admin',
        entryType: 'detection',
      });
      const b = manager.addTimelineEntry(incident.id, {
        description: 'Second',
        author: 'admin',
        entryType: 'investigation',
      });

      expect(a!.id).not.toBe(b!.id);
    });
  });

  describe('getTimeline()', () => {
    it('returns entries sorted by timestamp ascending', () => {
      const incident = manager.createIncident({
        severity: 'critical',
        type: 'breach',
        description: 'Breach',
        detectedAt: baseDate,
      });

      const t1 = new Date('2024-06-01T12:00:00Z');
      const t2 = new Date('2024-06-01T13:00:00Z');
      const t3 = new Date('2024-06-01T14:00:00Z');

      // Add out of order
      manager.addTimelineEntry(incident.id, {
        description: 'Contained',
        author: 'admin',
        entryType: 'containment',
        timestamp: t3,
      });
      manager.addTimelineEntry(incident.id, {
        description: 'Detected',
        author: 'bot',
        entryType: 'detection',
        timestamp: t1,
      });
      manager.addTimelineEntry(incident.id, {
        description: 'Investigating',
        author: 'analyst',
        entryType: 'investigation',
        timestamp: t2,
      });

      const timeline = manager.getTimeline(incident.id);
      expect(timeline).toHaveLength(3);
      expect(timeline![0]!.entryType).toBe('detection');
      expect(timeline![1]!.entryType).toBe('investigation');
      expect(timeline![2]!.entryType).toBe('containment');
    });

    it('returns empty array for incident with no entries', () => {
      const incident = manager.createIncident({
        severity: 'low',
        type: 'vulnerability',
        description: 'Vuln',
        detectedAt: baseDate,
      });

      const timeline = manager.getTimeline(incident.id);
      expect(timeline).toEqual([]);
    });

    it('returns undefined for nonexistent incident', () => {
      expect(manager.getTimeline('nonexistent')).toBeUndefined();
    });

    it('returns copies (not references)', () => {
      const incident = manager.createIncident({
        severity: 'high',
        type: 'breach',
        description: 'Breach',
        detectedAt: baseDate,
      });

      manager.addTimelineEntry(incident.id, {
        description: 'Entry',
        author: 'admin',
        entryType: 'detection',
        timestamp: baseDate,
      });

      const a = manager.getTimeline(incident.id);
      const b = manager.getTimeline(incident.id);
      expect(a).toEqual(b);
      expect(a![0]).not.toBe(b![0]);
    });
  });

  // ─── Post-Incident Review (Requirement 10.4) ───

  describe('createPostIncidentReview()', () => {
    it('creates a review for an existing incident', () => {
      const incident = manager.createIncident({
        severity: 'critical',
        type: 'breach',
        description: 'Major breach',
        detectedAt: baseDate,
      });

      const review = manager.createPostIncidentReview(incident.id, {
        summary: 'A critical data breach occurred due to misconfigured firewall.',
        rootCause: 'Firewall rule misconfiguration during maintenance window.',
        lessonsLearned: [
          'Always verify firewall rules after maintenance.',
          'Implement automated config validation.',
        ],
        actionItems: [
          { description: 'Add firewall config tests', assignee: 'eng-team', status: 'open' },
          { description: 'Update runbook', assignee: 'security-lead', status: 'in_progress' },
        ],
        reviewDate: baseDate,
        reviewers: ['alice', 'bob'],
      });

      expect(review).toBeDefined();
      expect(review!.id).toBeDefined();
      expect(review!.incidentId).toBe(incident.id);
      expect(review!.summary).toBe(
        'A critical data breach occurred due to misconfigured firewall.',
      );
      expect(review!.rootCause).toBe('Firewall rule misconfiguration during maintenance window.');
      expect(review!.lessonsLearned).toHaveLength(2);
      expect(review!.actionItems).toHaveLength(2);
      expect(review!.actionItems[0]!.status).toBe('open');
      expect(review!.actionItems[1]!.status).toBe('in_progress');
      expect(review!.reviewDate).toEqual(baseDate);
      expect(review!.reviewers).toEqual(['alice', 'bob']);
    });

    it('returns undefined for nonexistent incident', () => {
      const result = manager.createPostIncidentReview('nonexistent', {
        summary: 'Summary',
        rootCause: 'Cause',
        lessonsLearned: [],
        actionItems: [],
        reviewers: ['admin'],
      });
      expect(result).toBeUndefined();
    });

    it('returns undefined if a review already exists for the incident', () => {
      const incident = manager.createIncident({
        severity: 'high',
        type: 'breach',
        description: 'Breach',
        detectedAt: baseDate,
      });

      manager.createPostIncidentReview(incident.id, {
        summary: 'First review',
        rootCause: 'Cause',
        lessonsLearned: ['Lesson 1'],
        actionItems: [],
        reviewers: ['admin'],
      });

      const duplicate = manager.createPostIncidentReview(incident.id, {
        summary: 'Second review',
        rootCause: 'Another cause',
        lessonsLearned: [],
        actionItems: [],
        reviewers: ['admin'],
      });

      expect(duplicate).toBeUndefined();
    });

    it('defaults reviewDate to current time when not provided', () => {
      const incident = manager.createIncident({
        severity: 'medium',
        type: 'vulnerability',
        description: 'Vuln',
        detectedAt: baseDate,
      });

      const before = new Date();
      const review = manager.createPostIncidentReview(incident.id, {
        summary: 'Summary',
        rootCause: 'Cause',
        lessonsLearned: [],
        actionItems: [],
        reviewers: ['admin'],
      });
      const after = new Date();

      expect(review!.reviewDate.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(review!.reviewDate.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('getPostIncidentReview()', () => {
    it('retrieves a previously created review', () => {
      const incident = manager.createIncident({
        severity: 'high',
        type: 'data_loss',
        description: 'Data loss',
        detectedAt: baseDate,
      });

      manager.createPostIncidentReview(incident.id, {
        summary: 'Data loss review',
        rootCause: 'Disk failure',
        lessonsLearned: ['Improve backup strategy'],
        actionItems: [{ description: 'Set up daily backups', assignee: 'ops', status: 'open' }],
        reviewDate: baseDate,
        reviewers: ['charlie'],
      });

      const review = manager.getPostIncidentReview(incident.id);
      expect(review).toBeDefined();
      expect(review!.summary).toBe('Data loss review');
      expect(review!.rootCause).toBe('Disk failure');
      expect(review!.lessonsLearned).toEqual(['Improve backup strategy']);
      expect(review!.actionItems).toHaveLength(1);
      expect(review!.reviewers).toEqual(['charlie']);
    });

    it('returns undefined for incident with no review', () => {
      const incident = manager.createIncident({
        severity: 'low',
        type: 'vulnerability',
        description: 'Vuln',
        detectedAt: baseDate,
      });

      expect(manager.getPostIncidentReview(incident.id)).toBeUndefined();
    });

    it('returns undefined for nonexistent incident', () => {
      expect(manager.getPostIncidentReview('nonexistent')).toBeUndefined();
    });

    it('returns a deep copy (not a reference)', () => {
      const incident = manager.createIncident({
        severity: 'high',
        type: 'breach',
        description: 'Breach',
        detectedAt: baseDate,
      });

      manager.createPostIncidentReview(incident.id, {
        summary: 'Review',
        rootCause: 'Cause',
        lessonsLearned: ['Lesson'],
        actionItems: [{ description: 'Fix it', assignee: 'dev', status: 'open' }],
        reviewDate: baseDate,
        reviewers: ['reviewer'],
      });

      const a = manager.getPostIncidentReview(incident.id);
      const b = manager.getPostIncidentReview(incident.id);
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
      expect(a!.lessonsLearned).not.toBe(b!.lessonsLearned);
      expect(a!.actionItems).not.toBe(b!.actionItems);
      expect(a!.reviewers).not.toBe(b!.reviewers);
    });
  });
});
