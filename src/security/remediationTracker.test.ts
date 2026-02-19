import { describe, it, expect, beforeEach } from 'vitest';
import { RemediationTracker } from './remediationTracker.js';
import type { VulnerabilitySeverity } from './types.js';

/** Helper: milliseconds per hour / day. */
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

describe('RemediationTracker', () => {
  let tracker: RemediationTracker;
  const now = new Date('2024-06-01T00:00:00Z');

  beforeEach(() => {
    tracker = new RemediationTracker();
  });

  // ─── Task Creation ───

  describe('createTask', () => {
    it('should create a remediation task linked to a vulnerability', () => {
      const task = tracker.createTask('CVE-2023-0001', 'critical', 'security-team', now);

      expect(task.id).toBeDefined();
      expect(task.vulnerabilityId).toBe('CVE-2023-0001');
      expect(task.status).toBe('open');
      expect(task.assignee).toBe('security-team');
      expect(task.createdAt).toEqual(now);
      expect(task.updatedAt).toEqual(now);
    });

    it('should set SLA deadline to 24h for critical severity', () => {
      const task = tracker.createTask('CVE-1', 'critical', 'team-a', now);
      expect(task.slaDeadline.getTime()).toBe(now.getTime() + 24 * MS_PER_HOUR);
    });

    it('should set SLA deadline to 7 days for high severity', () => {
      const task = tracker.createTask('CVE-2', 'high', 'team-a', now);
      expect(task.slaDeadline.getTime()).toBe(now.getTime() + 7 * MS_PER_DAY);
    });

    it('should set SLA deadline to 30 days for medium severity', () => {
      const task = tracker.createTask('CVE-3', 'medium', 'team-a', now);
      expect(task.slaDeadline.getTime()).toBe(now.getTime() + 30 * MS_PER_DAY);
    });

    it('should set SLA deadline to 90 days for low severity', () => {
      const task = tracker.createTask('CVE-4', 'low', 'team-a', now);
      expect(task.slaDeadline.getTime()).toBe(now.getTime() + 90 * MS_PER_DAY);
    });
  });

  // ─── Status Updates ───

  describe('updateStatus', () => {
    it('should transition status from open to in_progress', () => {
      const task = tracker.createTask('CVE-1', 'high', 'team-a', now);
      const later = new Date(now.getTime() + MS_PER_HOUR);

      const updated = tracker.updateStatus(task.id, 'in_progress', later);

      expect(updated).toBeDefined();
      expect(updated!.status).toBe('in_progress');
      expect(updated!.updatedAt).toEqual(later);
    });

    it('should set resolvedAt when status becomes resolved', () => {
      const task = tracker.createTask('CVE-1', 'high', 'team-a', now);
      const resolveTime = new Date(now.getTime() + 2 * MS_PER_DAY);

      const updated = tracker.updateStatus(task.id, 'resolved', resolveTime);

      expect(updated!.status).toBe('resolved');
      expect(updated!.resolvedAt).toEqual(resolveTime);
    });

    it('should set verifiedAt when status becomes verified', () => {
      const task = tracker.createTask('CVE-1', 'high', 'team-a', now);
      tracker.updateStatus(task.id, 'resolved', new Date(now.getTime() + MS_PER_DAY));
      const verifyTime = new Date(now.getTime() + 2 * MS_PER_DAY);

      const updated = tracker.updateStatus(task.id, 'verified', verifyTime);

      expect(updated!.status).toBe('verified');
      expect(updated!.verifiedAt).toEqual(verifyTime);
    });

    it('should return undefined for unknown task id', () => {
      expect(tracker.updateStatus('nonexistent', 'resolved')).toBeUndefined();
    });
  });

  // ─── Reassignment ───

  describe('reassign', () => {
    it('should change the assignee', () => {
      const task = tracker.createTask('CVE-1', 'high', 'team-a', now);
      const later = new Date(now.getTime() + MS_PER_HOUR);

      const updated = tracker.reassign(task.id, 'team-b', later);

      expect(updated!.assignee).toBe('team-b');
      expect(updated!.updatedAt).toEqual(later);
    });

    it('should return undefined for unknown task id', () => {
      expect(tracker.reassign('nonexistent', 'team-b')).toBeUndefined();
    });
  });

  // ─── Queries ───

  describe('getTask', () => {
    it('should return a copy of the task', () => {
      const task = tracker.createTask('CVE-1', 'high', 'team-a', now);
      const retrieved = tracker.getTask(task.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(task.id);
    });

    it('should return undefined for unknown id', () => {
      expect(tracker.getTask('nonexistent')).toBeUndefined();
    });
  });

  describe('getTasks', () => {
    it('should return all tasks when no filter is given', () => {
      tracker.createTask('CVE-1', 'critical', 'team-a', now);
      tracker.createTask('CVE-2', 'high', 'team-b', now);

      expect(tracker.getTasks()).toHaveLength(2);
    });

    it('should filter tasks by status', () => {
      const t1 = tracker.createTask('CVE-1', 'critical', 'team-a', now);
      tracker.createTask('CVE-2', 'high', 'team-b', now);
      tracker.updateStatus(t1.id, 'in_progress');

      expect(tracker.getTasks('in_progress')).toHaveLength(1);
      expect(tracker.getTasks('open')).toHaveLength(1);
    });
  });

  describe('getTasksByVulnerability', () => {
    it('should return tasks linked to a specific vulnerability', () => {
      tracker.createTask('CVE-1', 'critical', 'team-a', now);
      tracker.createTask('CVE-1', 'critical', 'team-b', now);
      tracker.createTask('CVE-2', 'high', 'team-a', now);

      const tasks = tracker.getTasksByVulnerability('CVE-1');
      expect(tasks).toHaveLength(2);
      expect(tasks.every((t) => t.vulnerabilityId === 'CVE-1')).toBe(true);
    });

    it('should return empty array for unknown vulnerability', () => {
      expect(tracker.getTasksByVulnerability('CVE-999')).toHaveLength(0);
    });
  });

  // ─── Overdue Detection ───

  describe('isOverdue', () => {
    it('should return true when open task is past SLA deadline', () => {
      const task = tracker.createTask('CVE-1', 'critical', 'team-a', now);
      const pastDeadline = new Date(now.getTime() + 25 * MS_PER_HOUR);

      expect(tracker.isOverdue(task.id, pastDeadline)).toBe(true);
    });

    it('should return false when open task is within SLA deadline', () => {
      const task = tracker.createTask('CVE-1', 'critical', 'team-a', now);
      const withinDeadline = new Date(now.getTime() + 12 * MS_PER_HOUR);

      expect(tracker.isOverdue(task.id, withinDeadline)).toBe(false);
    });

    it('should return false for resolved tasks even if past deadline', () => {
      const task = tracker.createTask('CVE-1', 'critical', 'team-a', now);
      tracker.updateStatus(task.id, 'resolved', new Date(now.getTime() + 12 * MS_PER_HOUR));
      const pastDeadline = new Date(now.getTime() + 25 * MS_PER_HOUR);

      expect(tracker.isOverdue(task.id, pastDeadline)).toBe(false);
    });

    it('should return false for verified tasks even if past deadline', () => {
      const task = tracker.createTask('CVE-1', 'critical', 'team-a', now);
      tracker.updateStatus(task.id, 'resolved', new Date(now.getTime() + 12 * MS_PER_HOUR));
      tracker.updateStatus(task.id, 'verified', new Date(now.getTime() + 20 * MS_PER_HOUR));
      const pastDeadline = new Date(now.getTime() + 25 * MS_PER_HOUR);

      expect(tracker.isOverdue(task.id, pastDeadline)).toBe(false);
    });

    it('should return true for in_progress task past SLA deadline', () => {
      const task = tracker.createTask('CVE-1', 'critical', 'team-a', now);
      tracker.updateStatus(task.id, 'in_progress');
      const pastDeadline = new Date(now.getTime() + 25 * MS_PER_HOUR);

      expect(tracker.isOverdue(task.id, pastDeadline)).toBe(true);
    });

    it('should return false for unknown task id', () => {
      expect(tracker.isOverdue('nonexistent', now)).toBe(false);
    });
  });

  describe('getOverdueTasks', () => {
    it('should return only overdue tasks', () => {
      tracker.createTask('CVE-1', 'critical', 'team-a', now); // 24h SLA
      tracker.createTask('CVE-2', 'low', 'team-b', now); // 90d SLA

      const checkTime = new Date(now.getTime() + 2 * MS_PER_DAY); // 2 days later
      const overdue = tracker.getOverdueTasks(checkTime);

      expect(overdue).toHaveLength(1);
      expect(overdue[0].vulnerabilityId).toBe('CVE-1');
    });
  });

  // ─── Summary / Reporting ───

  describe('getSummary', () => {
    it('should return correct counts by status', () => {
      const t1 = tracker.createTask('CVE-1', 'critical', 'team-a', now);
      const t2 = tracker.createTask('CVE-2', 'high', 'team-b', now);
      tracker.createTask('CVE-3', 'medium', 'team-c', now);

      tracker.updateStatus(t1.id, 'in_progress');
      tracker.updateStatus(t2.id, 'resolved');

      const summary = tracker.getSummary(now);

      expect(summary.total).toBe(3);
      expect(summary.open).toBe(1);
      expect(summary.inProgress).toBe(1);
      expect(summary.resolved).toBe(1);
      expect(summary.verified).toBe(0);
    });

    it('should include overdue count in summary', () => {
      tracker.createTask('CVE-1', 'critical', 'team-a', now); // 24h SLA

      const pastDeadline = new Date(now.getTime() + 2 * MS_PER_DAY);
      const summary = tracker.getSummary(pastDeadline);

      expect(summary.overdue).toBe(1);
    });

    it('should return all zeros for empty tracker', () => {
      const summary = tracker.getSummary(now);

      expect(summary.total).toBe(0);
      expect(summary.open).toBe(0);
      expect(summary.inProgress).toBe(0);
      expect(summary.resolved).toBe(0);
      expect(summary.verified).toBe(0);
      expect(summary.overdue).toBe(0);
    });
  });
});
