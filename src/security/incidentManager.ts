/**
 * Incident Manager for CashTrace Security & Compliance Module.
 *
 * Manages security incidents with severity classification and
 * escalation procedures. Supports creating, updating, and querying
 * incidents, and triggering escalation based on severity.
 *
 * @module security/incidentManager
 *
 * Requirement 10.1: Define incident severity levels (critical, high, medium, low).
 * Requirement 10.2: Define escalation procedures per severity level.
 */

import { randomUUID } from 'node:crypto';
import type {
  ActionItem,
  EscalationProcedure,
  EscalationRecord,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
  PostIncidentReview,
  SecurityIncident,
  TimelineEntry,
  TimelineEntryType,
} from './types.js';

/** Milliseconds in one hour. */
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Default escalation procedures per severity level.
 *
 * Requirement 10.2: Define escalation procedures per severity level.
 * - critical → immediate executive notification
 * - high     → 1 hour, team lead notification
 * - medium   → 4 hours, team notification
 * - low      → next business day (8 hours)
 */
const DEFAULT_ESCALATION_PROCEDURES: Record<IncidentSeverity, EscalationProcedure> = {
  critical: {
    severity: 'critical',
    responseTimeMs: 0,
    notifyRoles: ['executive', 'security_lead', 'incident_commander'],
    description: 'Immediate executive notification and incident commander activation.',
  },
  high: {
    severity: 'high',
    responseTimeMs: 1 * MS_PER_HOUR,
    notifyRoles: ['security_lead', 'team_lead'],
    description: 'Notify team lead within 1 hour.',
  },
  medium: {
    severity: 'medium',
    responseTimeMs: 4 * MS_PER_HOUR,
    notifyRoles: ['security_team'],
    description: 'Notify security team within 4 hours.',
  },
  low: {
    severity: 'low',
    responseTimeMs: 8 * MS_PER_HOUR,
    notifyRoles: ['security_team'],
    description: 'Address on next business day.',
  },
};

export class IncidentManager {
  /** In-memory store keyed by incident id. */
  private readonly incidents = new Map<string, SecurityIncident>();

  /** Escalation records for incidents. */
  private readonly escalationRecords: EscalationRecord[] = [];

  /** Timeline entries keyed by incident id. Requirement 10.3. */
  private readonly timelines = new Map<string, TimelineEntry[]>();

  /** Post-incident reviews keyed by incident id. Requirement 10.4. */
  private readonly reviews = new Map<string, PostIncidentReview>();

  /** Escalation procedures by severity. */
  private readonly escalationProcedures: Record<IncidentSeverity, EscalationProcedure>;

  constructor(options?: { escalationProcedures?: Record<IncidentSeverity, EscalationProcedure> }) {
    this.escalationProcedures = options?.escalationProcedures ?? {
      ...DEFAULT_ESCALATION_PROCEDURES,
    };
  }

  /**
   * Create a new security incident.
   *
   * Requirement 10.1: Define incident severity levels.
   */
  createIncident(params: {
    severity: IncidentSeverity;
    type: IncidentType;
    description: string;
    affectedUsers?: string[];
    detectedAt?: Date;
  }): SecurityIncident {
    const incident: SecurityIncident = {
      id: randomUUID(),
      severity: params.severity,
      type: params.type,
      status: 'open',
      description: params.description,
      affectedUsers: params.affectedUsers ?? [],
      detectedAt: params.detectedAt ?? new Date(),
    };
    this.incidents.set(incident.id, incident);
    return { ...incident };
  }

  /**
   * Update an existing incident.
   * Returns the updated incident, or undefined if not found.
   */
  updateIncident(
    incidentId: string,
    updates: Partial<
      Pick<
        SecurityIncident,
        | 'severity'
        | 'status'
        | 'description'
        | 'affectedUsers'
        | 'containedAt'
        | 'resolvedAt'
        | 'notificationSentAt'
        | 'rootCause'
        | 'remediation'
      >
    >,
  ): SecurityIncident | undefined {
    const incident = this.incidents.get(incidentId);
    if (!incident) return undefined;

    const updated: SecurityIncident = { ...incident, ...updates };

    // Auto-set resolvedAt when status transitions to resolved
    if (updates.status === 'resolved' && !updated.resolvedAt) {
      updated.resolvedAt = new Date();
    }

    // Auto-set containedAt when status transitions to contained
    if (updates.status === 'contained' && !updated.containedAt) {
      updated.containedAt = new Date();
    }

    this.incidents.set(incidentId, updated);
    return { ...updated };
  }

  /**
   * Get a single incident by id.
   */
  getIncident(incidentId: string): SecurityIncident | undefined {
    const incident = this.incidents.get(incidentId);
    return incident ? { ...incident } : undefined;
  }

  /**
   * Get all incidents, optionally filtered by status or severity.
   */
  getIncidents(filter?: {
    status?: IncidentStatus;
    severity?: IncidentSeverity;
  }): SecurityIncident[] {
    let results = [...this.incidents.values()];
    if (filter?.status) {
      results = results.filter((i) => i.status === filter.status);
    }
    if (filter?.severity) {
      results = results.filter((i) => i.severity === filter.severity);
    }
    return results.map((i) => ({ ...i }));
  }

  /**
   * Get the escalation procedure for a given severity level.
   *
   * Requirement 10.2: Define escalation procedures per severity level.
   */
  getEscalationProcedure(severity: IncidentSeverity): EscalationProcedure {
    return { ...this.escalationProcedures[severity] };
  }

  /**
   * Trigger escalation for an incident based on its severity.
   * Returns the escalation record, or undefined if the incident is not found.
   *
   * Requirement 10.2: Define escalation procedures per severity level.
   */
  escalate(incidentId: string, now: Date = new Date()): EscalationRecord | undefined {
    const incident = this.incidents.get(incidentId);
    if (!incident) return undefined;

    const procedure = this.escalationProcedures[incident.severity];

    const record: EscalationRecord = {
      incidentId,
      severity: incident.severity,
      escalatedAt: now,
      notifiedRoles: [...procedure.notifyRoles],
      procedure: { ...procedure },
    };

    this.escalationRecords.push(record);
    return { ...record };
  }

  /**
   * Get all escalation records, optionally filtered by incident id.
   */
  getEscalationRecords(incidentId?: string): EscalationRecord[] {
    const records = incidentId
      ? this.escalationRecords.filter((r) => r.incidentId === incidentId)
      : [...this.escalationRecords];
    return records.map((r) => ({ ...r, procedure: { ...r.procedure } }));
  }

  // ─── Timeline Tracking (Requirement 10.3) ───

  /**
   * Add a timestamped entry to an incident's timeline.
   * Returns the created entry, or undefined if the incident does not exist.
   *
   * Requirement 10.3: Support incident documentation and timeline tracking.
   */
  addTimelineEntry(
    incidentId: string,
    entry: { timestamp?: Date; description: string; author: string; entryType: TimelineEntryType },
  ): TimelineEntry | undefined {
    if (!this.incidents.has(incidentId)) return undefined;

    const timelineEntry: TimelineEntry = {
      id: randomUUID(),
      incidentId,
      timestamp: entry.timestamp ?? new Date(),
      description: entry.description,
      author: entry.author,
      entryType: entry.entryType,
    };

    const entries = this.timelines.get(incidentId) ?? [];
    entries.push(timelineEntry);
    this.timelines.set(incidentId, entries);

    return { ...timelineEntry };
  }

  /**
   * Get the full timeline for an incident, sorted by timestamp ascending.
   * Returns undefined if the incident does not exist.
   *
   * Requirement 10.3: Support incident documentation and timeline tracking.
   */
  getTimeline(incidentId: string): TimelineEntry[] | undefined {
    if (!this.incidents.has(incidentId)) return undefined;

    const entries = this.timelines.get(incidentId) ?? [];
    return [...entries]
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .map((e) => ({ ...e }));
  }

  // ─── Post-Incident Review (Requirement 10.4) ───

  /**
   * Create a post-incident review for an incident.
   * Returns the created review, or undefined if the incident does not exist
   * or a review already exists for the incident.
   *
   * Requirement 10.4: Support post-incident review and lessons learned.
   */
  createPostIncidentReview(
    incidentId: string,
    review: {
      summary: string;
      rootCause: string;
      lessonsLearned: string[];
      actionItems: ActionItem[];
      reviewDate?: Date;
      reviewers: string[];
    },
  ): PostIncidentReview | undefined {
    if (!this.incidents.has(incidentId)) return undefined;
    if (this.reviews.has(incidentId)) return undefined;

    const postReview: PostIncidentReview = {
      id: randomUUID(),
      incidentId,
      summary: review.summary,
      rootCause: review.rootCause,
      lessonsLearned: [...review.lessonsLearned],
      actionItems: review.actionItems.map((ai) => ({ ...ai })),
      reviewDate: review.reviewDate ?? new Date(),
      reviewers: [...review.reviewers],
    };

    this.reviews.set(incidentId, postReview);
    return {
      ...postReview,
      lessonsLearned: [...postReview.lessonsLearned],
      actionItems: postReview.actionItems.map((ai) => ({ ...ai })),
      reviewers: [...postReview.reviewers],
    };
  }

  /**
   * Get the post-incident review for an incident.
   * Returns undefined if the incident does not exist or has no review.
   *
   * Requirement 10.4: Support post-incident review and lessons learned.
   */
  getPostIncidentReview(incidentId: string): PostIncidentReview | undefined {
    const review = this.reviews.get(incidentId);
    if (!review) return undefined;

    return {
      ...review,
      lessonsLearned: [...review.lessonsLearned],
      actionItems: review.actionItems.map((ai) => ({ ...ai })),
      reviewers: [...review.reviewers],
    };
  }
}
