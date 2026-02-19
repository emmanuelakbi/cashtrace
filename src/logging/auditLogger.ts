/**
 * Audit Logger
 *
 * Provides tamper-evident audit logging for data access, data modifications,
 * and authentication events in CashTrace.
 *
 * Requirements: 10.1 (log all data access events), 10.2 (log all data modification
 * events with before/after values), 10.3 (log all authentication events)
 *
 * @module logging/auditLogger
 */

import { createHash, randomUUID } from 'node:crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuditEventType = 'data_access' | 'data_modify' | 'auth' | 'admin';
export type AuditAction = 'create' | 'read' | 'update' | 'delete' | 'login' | 'logout';

export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  eventType: AuditEventType;
  userId: string;
  businessId: string;
  resourceType: string;
  resourceId: string;
  action: AuditAction;
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
  correlationId: string;
  previousChecksum: string | null;
  checksum: string;
}

export interface IntegrityResult {
  valid: boolean;
  expected: string;
  actual: string;
}

export interface BulkIntegrityResult {
  valid: boolean;
  tamperedEntries: string[];
}

export interface ChainVerificationResult {
  valid: boolean;
  brokenAt: string | null;
}

export interface AccessParams {
  userId: string;
  businessId: string;
  resourceType: string;
  resourceId: string;
  ipAddress: string;
  userAgent: string;
  correlationId?: string;
}

export interface ModificationParams {
  userId: string;
  businessId: string;
  resourceType: string;
  resourceId: string;
  action: 'create' | 'update' | 'delete';
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
  correlationId?: string;
}

export interface AuthParams {
  userId: string;
  businessId: string;
  action: 'login' | 'logout';
  ipAddress: string;
  userAgent: string;
  correlationId?: string;
}

export interface AuditFilter {
  userId?: string;
  businessId?: string;
  eventType?: AuditEventType;
  resourceType?: string;
  resourceId?: string;
  action?: AuditAction;
  from?: Date;
  to?: Date;
}

export interface AuditRetentionConfig {
  /** Retention period in days (default: 2555 = ~7 years) */
  retentionDays: number;
}

export interface AuditRetentionPolicy {
  retentionDays: number;
  retentionMs: number;
}

export interface AuditLogger {
  logAccess(params: AccessParams): AuditLogEntry;
  logModification(params: ModificationParams): AuditLogEntry;
  logAuth(params: AuthParams): AuditLogEntry;
  getEntries(filter?: AuditFilter): AuditLogEntry[];
  getEntry(id: string): AuditLogEntry | undefined;
  getRetentionPolicy(): AuditRetentionPolicy;
  getExpiredEntries(now?: Date): AuditLogEntry[];
  purgeExpired(now?: Date): number;
  verifyIntegrity(id: string): IntegrityResult;
  verifyAll(): BulkIntegrityResult;
  verifyChain(): ChainVerificationResult;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeChecksum(entry: Omit<AuditLogEntry, 'checksum'>): string {
  const payload = JSON.stringify({
    id: entry.id,
    timestamp: entry.timestamp.toISOString(),
    eventType: entry.eventType,
    userId: entry.userId,
    businessId: entry.businessId,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    action: entry.action,
    previousValue: entry.previousValue,
    newValue: entry.newValue,
    ipAddress: entry.ipAddress,
    userAgent: entry.userAgent,
    correlationId: entry.correlationId,
    previousChecksum: entry.previousChecksum,
  });
  return createHash('sha256').update(payload).digest('hex');
}

function matchesFilter(entry: AuditLogEntry, filter: AuditFilter): boolean {
  if (filter.userId && entry.userId !== filter.userId) return false;
  if (filter.businessId && entry.businessId !== filter.businessId) return false;
  if (filter.eventType && entry.eventType !== filter.eventType) return false;
  if (filter.resourceType && entry.resourceType !== filter.resourceType) return false;
  if (filter.resourceId && entry.resourceId !== filter.resourceId) return false;
  if (filter.action && entry.action !== filter.action) return false;
  if (filter.from && entry.timestamp < filter.from) return false;
  if (filter.to && entry.timestamp > filter.to) return false;
  return true;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createAuditLogger(overrides: Partial<AuditRetentionConfig> = {}): AuditLogger {
  const retentionDays = overrides.retentionDays ?? 2555;
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  const entries: AuditLogEntry[] = [];

  function buildEntry(
    eventType: AuditEventType,
    action: AuditAction,
    params: {
      userId: string;
      businessId: string;
      resourceType: string;
      resourceId: string;
      ipAddress: string;
      userAgent: string;
      correlationId?: string;
      previousValue?: Record<string, unknown>;
      newValue?: Record<string, unknown>;
    },
  ): AuditLogEntry {
    const lastEntry = entries.length > 0 ? entries[entries.length - 1] : undefined;
    const previousChecksum = lastEntry ? lastEntry.checksum : null;
    const partial: Omit<AuditLogEntry, 'checksum'> = {
      id: randomUUID(),
      timestamp: new Date(),
      eventType,
      userId: params.userId,
      businessId: params.businessId,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      action,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      correlationId: params.correlationId ?? randomUUID(),
      previousChecksum,
    };
    if (params.previousValue !== undefined) partial.previousValue = params.previousValue;
    if (params.newValue !== undefined) partial.newValue = params.newValue;

    return { ...partial, checksum: computeChecksum(partial) };
  }

  return {
    logAccess(params: AccessParams): AuditLogEntry {
      const entry = buildEntry('data_access', 'read', {
        ...params,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
      });
      entries.push(entry);
      return entry;
    },

    logModification(params: ModificationParams): AuditLogEntry {
      const entry = buildEntry('data_modify', params.action, {
        ...params,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        previousValue: params.previousValue,
        newValue: params.newValue,
      });
      entries.push(entry);
      return entry;
    },

    logAuth(params: AuthParams): AuditLogEntry {
      const entry = buildEntry('auth', params.action, {
        ...params,
        resourceType: 'session',
        resourceId: params.userId,
      });
      entries.push(entry);
      return entry;
    },

    getEntries(filter?: AuditFilter): AuditLogEntry[] {
      if (!filter) return [...entries];
      return entries.filter((e) => matchesFilter(e, filter));
    },

    getEntry(id: string): AuditLogEntry | undefined {
      return entries.find((e) => e.id === id);
    },

    getRetentionPolicy(): AuditRetentionPolicy {
      return { retentionDays, retentionMs };
    },

    getExpiredEntries(now?: Date): AuditLogEntry[] {
      const ref = now ?? new Date();
      const cutoff = ref.getTime() - retentionMs;
      return entries.filter((e) => e.timestamp.getTime() < cutoff);
    },

    purgeExpired(now?: Date): number {
      const ref = now ?? new Date();
      const cutoff = ref.getTime() - retentionMs;
      let removed = 0;
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i]!.timestamp.getTime() < cutoff) {
          entries.splice(i, 1);
          removed++;
        }
      }
      return removed;
    },

    verifyIntegrity(id: string): IntegrityResult {
      const entry = entries.find((e) => e.id === id);
      if (!entry) {
        return { valid: false, expected: '', actual: '' };
      }
      const { checksum: stored, ...rest } = entry;
      const recomputed = computeChecksum(rest);
      return { valid: stored === recomputed, expected: stored, actual: recomputed };
    },

    verifyAll(): BulkIntegrityResult {
      const tamperedEntries: string[] = [];
      for (const entry of entries) {
        const { checksum: stored, ...rest } = entry;
        if (stored !== computeChecksum(rest)) {
          tamperedEntries.push(entry.id);
        }
      }
      return { valid: tamperedEntries.length === 0, tamperedEntries };
    },

    verifyChain(): ChainVerificationResult {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        const expectedPrev = i === 0 ? null : entries[i - 1]!.checksum;
        if (entry.previousChecksum !== expectedPrev) {
          return { valid: false, brokenAt: entry.id };
        }
        const { checksum: stored, ...rest } = entry;
        if (stored !== computeChecksum(rest)) {
          return { valid: false, brokenAt: entry.id };
        }
      }
      return { valid: true, brokenAt: null };
    },
  };
}
