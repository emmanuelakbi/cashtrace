import { describe, it, expect, beforeEach } from 'vitest';
import type { LogEntry } from './logger.js';
import { createLogExporter, type LogExporter } from './logExport.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: '2024-01-15T10:00:00.000Z',
    level: 'info',
    message: 'test message',
    service: 'cashtrace',
    correlationId: 'corr-1',
    ...overrides,
  };
}

const sampleEntries: LogEntry[] = [
  makeEntry({ timestamp: '2024-01-15T08:00:00.000Z', userId: 'user-1', correlationId: 'corr-1' }),
  makeEntry({
    timestamp: '2024-01-15T10:00:00.000Z',
    userId: 'user-2',
    correlationId: 'corr-2',
    level: 'warn',
    message: 'warning msg',
  }),
  makeEntry({
    timestamp: '2024-01-15T12:00:00.000Z',
    userId: 'user-1',
    correlationId: 'corr-3',
    level: 'error',
    message: 'error msg',
  }),
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LogExporter', () => {
  let exporter: LogExporter;

  beforeEach(() => {
    exporter = createLogExporter();
  });

  describe('JSON export', () => {
    it('exports entries as formatted JSON', () => {
      const result = exporter.export(sampleEntries, 'json');
      const parsed = JSON.parse(result.data);
      expect(parsed).toHaveLength(3);
      expect(parsed[0].timestamp).toBe('2024-01-15T08:00:00.000Z');
    });

    it('exports empty array as JSON', () => {
      const result = exporter.export([], 'json');
      expect(JSON.parse(result.data)).toEqual([]);
      expect(result.metadata.entryCount).toBe(0);
    });
  });

  describe('CSV export', () => {
    it('exports entries with header row', () => {
      const result = exporter.export(sampleEntries, 'csv');
      const lines = result.data.split('\n');
      expect(lines[0]).toBe(
        'timestamp,level,message,service,correlationId,userId,businessId,metadata',
      );
      expect(lines).toHaveLength(4); // header + 3 rows
    });

    it('escapes commas in fields', () => {
      const entry = makeEntry({ message: 'hello, world' });
      const result = exporter.export([entry], 'csv');
      const dataRow = result.data.split('\n')[1];
      expect(dataRow).toContain('"hello, world"');
    });

    it('escapes double quotes in fields', () => {
      const entry = makeEntry({ message: 'say "hi"' });
      const result = exporter.export([entry], 'csv');
      const dataRow = result.data.split('\n')[1];
      expect(dataRow).toContain('"say ""hi"""');
    });

    it('escapes newlines in fields', () => {
      const entry = makeEntry({ message: 'line1\nline2' });
      const result = exporter.export([entry], 'csv');
      // The field should be quoted
      expect(result.data).toContain('"line1\nline2"');
    });

    it('handles empty optional fields', () => {
      const entry = makeEntry(); // no userId, businessId, metadata
      const result = exporter.export([entry], 'csv');
      const dataRow = result.data.split('\n')[1];
      // Should have empty fields for userId, businessId, metadata
      expect(dataRow).toMatch(/,,$/);
    });

    it('serializes metadata as JSON in CSV', () => {
      const entry = makeEntry({ metadata: { key: 'value' } });
      const result = exporter.export([entry], 'csv');
      const dataRow = result.data.split('\n')[1];
      // JSON contains quotes, so CSV escaping wraps it and doubles internal quotes
      expect(dataRow).toContain('{""key"":""value""}');
    });
  });

  describe('NDJSON export', () => {
    it('exports one JSON object per line', () => {
      const result = exporter.export(sampleEntries, 'ndjson');
      const lines = result.data.split('\n');
      expect(lines).toHaveLength(3);
      lines.forEach((line) => {
        expect(() => JSON.parse(line)).not.toThrow();
      });
    });

    it('exports empty string for no entries', () => {
      const result = exporter.export([], 'ndjson');
      expect(result.data).toBe('');
    });
  });

  describe('filtering', () => {
    it('filters by time range', () => {
      const result = exporter.export(sampleEntries, 'json', {
        startTime: '2024-01-15T09:00:00.000Z',
        endTime: '2024-01-15T11:00:00.000Z',
      });
      const parsed = JSON.parse(result.data);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].timestamp).toBe('2024-01-15T10:00:00.000Z');
    });

    it('filters by userId', () => {
      const result = exporter.export(sampleEntries, 'json', { userId: 'user-1' });
      const parsed = JSON.parse(result.data);
      expect(parsed).toHaveLength(2);
      parsed.forEach((e: LogEntry) => expect(e.userId).toBe('user-1'));
    });

    it('filters by correlationId', () => {
      const result = exporter.export(sampleEntries, 'json', { correlationId: 'corr-2' });
      const parsed = JSON.parse(result.data);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].correlationId).toBe('corr-2');
    });

    it('combines multiple filters', () => {
      const result = exporter.export(sampleEntries, 'json', {
        userId: 'user-1',
        startTime: '2024-01-15T11:00:00.000Z',
      });
      const parsed = JSON.parse(result.data);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].level).toBe('error');
    });

    it('returns empty when no entries match filter', () => {
      const result = exporter.export(sampleEntries, 'json', { userId: 'nonexistent' });
      expect(JSON.parse(result.data)).toEqual([]);
      expect(result.metadata.entryCount).toBe(0);
    });
  });

  describe('export metadata', () => {
    it('includes export timestamp', () => {
      const before = new Date().toISOString();
      const result = exporter.export(sampleEntries, 'json');
      const after = new Date().toISOString();
      expect(result.metadata.exportedAt >= before).toBe(true);
      expect(result.metadata.exportedAt <= after).toBe(true);
    });

    it('includes format', () => {
      expect(exporter.export([], 'csv').metadata.format).toBe('csv');
      expect(exporter.export([], 'ndjson').metadata.format).toBe('ndjson');
    });

    it('includes entry count after filtering', () => {
      const result = exporter.export(sampleEntries, 'json', { userId: 'user-1' });
      expect(result.metadata.entryCount).toBe(2);
    });

    it('includes filter criteria', () => {
      const filter = { userId: 'user-1', startTime: '2024-01-15T00:00:00.000Z' };
      const result = exporter.export(sampleEntries, 'json', filter);
      expect(result.metadata.filter).toEqual(filter);
    });

    it('includes empty filter when none provided', () => {
      const result = exporter.export(sampleEntries, 'json');
      expect(result.metadata.filter).toEqual({});
    });
  });
});
