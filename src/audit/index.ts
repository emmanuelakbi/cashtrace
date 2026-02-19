/**
 * Audit Module for CashTrace Security & Compliance
 *
 * Provides append-only, tamper-evident audit trail with
 * comprehensive logging of all data access and modifications.
 *
 * @module audit
 */

export type {
  AuditEvent,
  AuditEntry,
  AuditFilter,
  AuditEventType,
  AuditAction,
  ExportFormat,
  IntegrityResult,
  ChainIntegrityResult,
  RetentionStatus,
} from './types.js';

export { AuditServiceImpl } from './auditService.js';
export type { AuditContext } from './auditService.js';
