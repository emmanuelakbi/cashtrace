/**
 * Type definitions for the Audit module.
 */

export type AuditEventType =
  | 'data_access'
  | 'data_modify'
  | 'auth'
  | 'admin'
  | 'consent'
  | 'export';

export type AuditAction = 'create' | 'read' | 'update' | 'delete' | 'export' | 'grant' | 'revoke';

export type ExportFormat = 'json' | 'csv';

export interface AuditEvent {
  eventType: AuditEventType;
  userId: string;
  businessId: string;
  resourceType: string;
  resourceId: string;
  action: AuditAction;
  previousValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AuditEntry extends AuditEvent {
  id: string;
  timestamp: Date;
  ipAddress: string;
  userAgent: string;
  correlationId: string;
  checksum: string;
  previousChecksum: string;
}

export interface AuditFilter {
  userId?: string;
  businessId?: string;
  eventType?: AuditEventType;
  action?: AuditAction;
  resourceType?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface IntegrityResult {
  entryId: string;
  valid: boolean;
  expectedChecksum: string;
  actualChecksum: string;
}

export interface ChainIntegrityResult {
  valid: boolean;
  totalEntries: number;
  firstInvalidIndex: number | null;
  details: string;
}

export interface ChainIntegrityResult {
  valid: boolean;
  totalEntries: number;
  firstInvalidIndex: number | null;
  details: string;
}

export interface RetentionStatus {
  entryId: string;
  timestamp: Date;
  ageInDays: number;
  withinRetention: boolean;
  retentionPeriodDays: number;
}
