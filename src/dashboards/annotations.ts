/**
 * Dashboard Annotations Module
 *
 * Manages deployment and incident annotations for Grafana dashboards.
 * Supports marking deployments, incidents, rollbacks, and config changes
 * with rich metadata for dashboard visualization.
 *
 * Requirements:
 *   7.5 - Support dashboard annotations for deployments and incidents
 */

// --- Types ---

export type AnnotationType = 'deployment' | 'incident' | 'rollback' | 'config_change';

export type IncidentSeverity = 'critical' | 'major' | 'minor' | 'warning';
export type IncidentStatus = 'triggered' | 'acknowledged' | 'resolved';

export interface DeploymentMetadata {
  version: string;
  commitHash: string;
  deployer: string;
  environment?: string;
}

export interface IncidentMetadata {
  severity: IncidentSeverity;
  status: IncidentStatus;
}

export interface Annotation {
  id: string;
  timestamp: number;
  type: AnnotationType;
  title: string;
  description?: string;
  tags: string[];
  deployment?: DeploymentMetadata;
  incident?: IncidentMetadata;
}

export interface GrafanaAnnotationPayload {
  time: number;
  timeEnd?: number;
  tags: string[];
  text: string;
}

export interface AnnotationDisplayEntry {
  time: string;
  type: AnnotationType;
  title: string;
  details: string;
}

export interface AnnotationManager {
  /** Add an annotation and return its generated id */
  add(input: Omit<Annotation, 'id'>): Annotation;
  /** Get all stored annotations */
  getAll(): Annotation[];
  /** Query annotations by optional time range and/or type */
  query(filter?: { startTime?: number; endTime?: number; type?: AnnotationType }): Annotation[];
  /** Generate Grafana annotation API payloads for matching annotations */
  toGrafanaPayloads(filter?: {
    startTime?: number;
    endTime?: number;
    type?: AnnotationType;
  }): GrafanaAnnotationPayload[];
  /** Format annotations for dashboard display */
  toDisplayEntries(filter?: {
    startTime?: number;
    endTime?: number;
    type?: AnnotationType;
  }): AnnotationDisplayEntry[];
}

// --- Helpers ---

let idCounter = 0;

function generateId(): string {
  idCounter += 1;
  return `ann-${Date.now()}-${idCounter}`;
}

function buildText(annotation: Annotation): string {
  const parts: string[] = [`<b>${annotation.title}</b>`];
  if (annotation.description) parts.push(annotation.description);
  if (annotation.deployment) {
    const d = annotation.deployment;
    parts.push(`Version: ${d.version} | Commit: ${d.commitHash} | Deployer: ${d.deployer}`);
  }
  if (annotation.incident) {
    const i = annotation.incident;
    parts.push(`Severity: ${i.severity} | Status: ${i.status}`);
  }
  return parts.join('\n');
}

function matchesFilter(
  annotation: Annotation,
  filter?: { startTime?: number; endTime?: number; type?: AnnotationType },
): boolean {
  if (!filter) return true;
  if (filter.type && annotation.type !== filter.type) return false;
  if (filter.startTime !== undefined && annotation.timestamp < filter.startTime) return false;
  if (filter.endTime !== undefined && annotation.timestamp > filter.endTime) return false;
  return true;
}

// --- Factory ---

export function createAnnotationManager(): AnnotationManager {
  const annotations: Annotation[] = [];

  return {
    add(input): Annotation {
      const annotation: Annotation = { ...input, id: generateId() };
      annotations.push(annotation);
      return annotation;
    },

    getAll(): Annotation[] {
      return [...annotations];
    },

    query(filter): Annotation[] {
      return annotations.filter((a) => matchesFilter(a, filter));
    },

    toGrafanaPayloads(filter): GrafanaAnnotationPayload[] {
      return this.query(filter).map((a) => ({
        time: a.timestamp,
        tags: [a.type, ...a.tags],
        text: buildText(a),
      }));
    },

    toDisplayEntries(filter): AnnotationDisplayEntry[] {
      return this.query(filter).map((a) => ({
        time: new Date(a.timestamp).toISOString(),
        type: a.type,
        title: a.title,
        details: buildText(a),
      }));
    },
  };
}
