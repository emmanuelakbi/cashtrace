/**
 * Log Export
 *
 * Supports exporting log entries in JSON, CSV, and NDJSON formats
 * with filtering by time range, user_id, and correlation_id.
 *
 * Requirements: 8.5 (support log export for compliance requests)
 *
 * @module logging/logExport
 */

import type { LogEntry } from './logger.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExportFormat = 'json' | 'csv' | 'ndjson';

export interface ExportFilter {
  startTime?: string;
  endTime?: string;
  userId?: string;
  correlationId?: string;
}

export interface ExportMetadata {
  exportedAt: string;
  format: ExportFormat;
  entryCount: number;
  filter: ExportFilter;
}

export interface ExportResult {
  data: string;
  metadata: ExportMetadata;
}

export interface LogExporter {
  export(entries: LogEntry[], format: ExportFormat, filter?: ExportFilter): ExportResult;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function applyFilter(entries: LogEntry[], filter: ExportFilter): LogEntry[] {
  return entries.filter((entry) => {
    if (filter.startTime && entry.timestamp < filter.startTime) return false;
    if (filter.endTime && entry.timestamp > filter.endTime) return false;
    if (filter.userId && entry.userId !== filter.userId) return false;
    if (filter.correlationId && entry.correlationId !== filter.correlationId) return false;
    return true;
  });
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const CSV_HEADERS = [
  'timestamp',
  'level',
  'message',
  'service',
  'correlationId',
  'userId',
  'businessId',
  'metadata',
] as const;

function entryToCsvRow(entry: LogEntry): string {
  const fields = [
    entry.timestamp,
    entry.level,
    entry.message,
    entry.service,
    entry.correlationId,
    entry.userId ?? '',
    entry.businessId ?? '',
    entry.metadata ? JSON.stringify(entry.metadata) : '',
  ];
  return fields.map(escapeCsvField).join(',');
}

function toJson(entries: LogEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

function toCsv(entries: LogEntry[]): string {
  const header = CSV_HEADERS.join(',');
  const rows = entries.map(entryToCsvRow);
  return [header, ...rows].join('\n');
}

function toNdjson(entries: LogEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join('\n');
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createLogExporter(): LogExporter {
  return {
    export(entries: LogEntry[], format: ExportFormat, filter: ExportFilter = {}): ExportResult {
      const filtered = applyFilter(entries, filter);

      const formatters: Record<ExportFormat, (e: LogEntry[]) => string> = {
        json: toJson,
        csv: toCsv,
        ndjson: toNdjson,
      };

      const data = formatters[format](filtered);

      return {
        data,
        metadata: {
          exportedAt: new Date().toISOString(),
          format,
          entryCount: filtered.length,
          filter,
        },
      };
    },
  };
}
