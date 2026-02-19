/**
 * Remediation Tracker for CashTrace Security & Compliance Module.
 *
 * Creates and tracks remediation tasks for detected vulnerabilities.
 * Enforces SLA deadlines based on severity and provides reporting.
 *
 * @module security/remediationTracker
 *
 * Requirement 9.3: Track vulnerability remediation status.
 */

import { randomUUID } from 'node:crypto';
import type {
  RemediationStatus,
  RemediationSummary,
  RemediationTask,
  VulnerabilitySeverity,
} from './types.js';

/** SLA deadlines in milliseconds by severity. */
const SLA_DEADLINES_MS: Record<VulnerabilitySeverity, number> = {
  critical: 24 * 60 * 60 * 1000,       // 24 hours
  high: 7 * 24 * 60 * 60 * 1000,       // 7 days
  medium: 30 * 24 * 60 * 60 * 1000,    // 30 days
  low: 90 * 24 * 60 * 60 * 1000,       // 90 days
};

export class RemediationTracker {
  /** In-memory store keyed by remediation task id. */
  private readonly tasks = new Map<string, RemediationTask>();

  /**
   * Create a remediation task for a vulnerability.
   *
   * Requirement 9.3: Track vulnerability remediation status.
   */
  createTask(
    vulnerabilityId: string,
    severity: VulnerabilitySeverity,
    assignee: string,
    now: Date = new Date(),
  ): RemediationTask {
    const slaMs = SLA_DEADLINES_MS[severity];
    const task: RemediationTask = {
      id: randomUUID(),
      vulnerabilityId,
      status: 'open',
      assignee,
      createdAt: now,
      updatedAt: now,
      slaDeadline: new Date(now.getTime() + slaMs),
    };
    this.tasks.set(task.id, task);
    return task;
  }

  /**
   * Update the status of a remediation task.
   * Returns the updated task, or undefined if not found.
   */
  updateStatus(
    taskId: string,
    newStatus: RemediationStatus,
    now: Date = new Date(),
  ): RemediationTask | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    const updated: RemediationTask = {
      ...task,
      status: newStatus,
      updatedAt: now,
      resolvedAt: newStatus === 'resolved' ? now : task.resolvedAt,
      verifiedAt: newStatus === 'verified' ? now : task.verifiedAt,
    };
    this.tasks.set(taskId, updated);
    return updated;
  }

  /**
   * Reassign a remediation task.
   * Returns the updated task, or undefined if not found.
   */
  reassign(
    taskId: string,
    newAssignee: string,
    now: Date = new Date(),
  ): RemediationTask | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    const updated: RemediationTask = { ...task, assignee: newAssignee, updatedAt: now };
    this.tasks.set(taskId, updated);
    return updated;
  }

  /**
   * Get a remediation task by id.
   */
  getTask(taskId: string): RemediationTask | undefined {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : undefined;
  }

  /**
   * Get all remediation tasks, optionally filtered by status.
   */
  getTasks(status?: RemediationStatus): RemediationTask[] {
    const all = [...this.tasks.values()];
    if (status) {
      return all.filter((t) => t.status === status);
    }
    return all;
  }

  /**
   * Get all remediation tasks linked to a specific vulnerability.
   */
  getTasksByVulnerability(vulnerabilityId: string): RemediationTask[] {
    return [...this.tasks.values()].filter((t) => t.vulnerabilityId === vulnerabilityId);
  }

  /**
   * Check whether a remediation task is overdue.
   * A task is overdue if it is not resolved/verified and past its SLA deadline.
   */
  isOverdue(taskId: string, now: Date = new Date()): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status === 'resolved' || task.status === 'verified') return false;
    return now > task.slaDeadline;
  }

  /**
   * Get all overdue remediation tasks.
   */
  getOverdueTasks(now: Date = new Date()): RemediationTask[] {
    return [...this.tasks.values()].filter(
      (t) =>
        t.status !== 'resolved' &&
        t.status !== 'verified' &&
        now > t.slaDeadline,
    );
  }

  /**
   * Get a summary of remediation tasks (counts by status + overdue).
   */
  getSummary(now: Date = new Date()): RemediationSummary {
    const all = [...this.tasks.values()];
    return {
      total: all.length,
      open: all.filter((t) => t.status === 'open').length,
      inProgress: all.filter((t) => t.status === 'in_progress').length,
      resolved: all.filter((t) => t.status === 'resolved').length,
      verified: all.filter((t) => t.status === 'verified').length,
      overdue: all.filter(
        (t) =>
          t.status !== 'resolved' &&
          t.status !== 'verified' &&
          now > t.slaDeadline,
      ).length,
    };
  }
}
