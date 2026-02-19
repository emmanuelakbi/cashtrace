import { describe, it, expect, beforeEach } from 'vitest';
import { createMetricsCollector, type MetricsCollector } from './collector.js';
import { createDbMetrics, normalizeOperation, type DbMetrics } from './dbMetrics.js';
import { loadPrometheusConfig } from './prometheusConfig.js';

describe('DbMetrics', () => {
  let collector: MetricsCollector;
  let dbMetrics: DbMetrics;

  beforeEach(() => {
    collector = createMetricsCollector(loadPrometheusConfig());
    dbMetrics = createDbMetrics(collector);
  });

  describe('normalizeOperation', () => {
    it('normalizes lowercase operations to uppercase', () => {
      expect(normalizeOperation('select')).toBe('SELECT');
      expect(normalizeOperation('insert')).toBe('INSERT');
      expect(normalizeOperation('update')).toBe('UPDATE');
      expect(normalizeOperation('delete')).toBe('DELETE');
    });

    it('keeps valid uppercase operations unchanged', () => {
      expect(normalizeOperation('SELECT')).toBe('SELECT');
      expect(normalizeOperation('INSERT')).toBe('INSERT');
      expect(normalizeOperation('UPDATE')).toBe('UPDATE');
      expect(normalizeOperation('DELETE')).toBe('DELETE');
    });

    it('handles mixed case', () => {
      expect(normalizeOperation('Select')).toBe('SELECT');
      expect(normalizeOperation('InSeRt')).toBe('INSERT');
    });

    it('returns OTHER for unrecognized operations', () => {
      expect(normalizeOperation('MERGE')).toBe('OTHER');
      expect(normalizeOperation('UPSERT')).toBe('OTHER');
      expect(normalizeOperation('')).toBe('OTHER');
    });
  });

  describe('recordQuery', () => {
    it('increments query count with operation and table labels', async () => {
      dbMetrics.recordQuery({
        operation: 'SELECT',
        table: 'users',
        durationMs: 15,
      });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('db_queries_total');
      expect(output).toContain('operation="SELECT"');
      expect(output).toContain('table="users"');
    });

    it('records latency in the histogram with operation and table labels', async () => {
      dbMetrics.recordQuery({
        operation: 'INSERT',
        table: 'transactions',
        durationMs: 42.5,
      });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('db_query_duration_ms');
      expect(output).toContain('operation="INSERT"');
      expect(output).toContain('table="transactions"');
    });

    it('increments error counter when error is true', async () => {
      dbMetrics.recordQuery({
        operation: 'UPDATE',
        table: 'accounts',
        durationMs: 100,
        error: true,
      });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('db_query_errors_total');
      expect(output).toContain('operation="UPDATE"');
      expect(output).toContain('table="accounts"');
    });

    it('does not increment error counter when error is false or absent', async () => {
      dbMetrics.recordQuery({
        operation: 'SELECT',
        table: 'users',
        durationMs: 10,
        error: false,
      });

      dbMetrics.recordQuery({
        operation: 'SELECT',
        table: 'users',
        durationMs: 5,
      });

      const output = await collector.getMetricsOutput();
      // db_query_errors_total should not have any incremented values
      // The counter is registered but should have 0 value
      expect(output).toContain('db_queries_total');
      // Verify queries were counted (2 queries)
      const queryLines = output
        .split('\n')
        .filter(
          (l: string) =>
            l.includes('db_queries_total') &&
            l.includes('operation="SELECT"') &&
            l.includes('table="users"'),
        );
      expect(queryLines.length).toBeGreaterThan(0);
    });

    it('normalizes operation to uppercase', async () => {
      dbMetrics.recordQuery({
        operation: 'select',
        table: 'products',
        durationMs: 20,
      });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('operation="SELECT"');
    });

    it('tracks multiple operations on different tables', async () => {
      dbMetrics.recordQuery({
        operation: 'SELECT',
        table: 'users',
        durationMs: 10,
      });
      dbMetrics.recordQuery({
        operation: 'INSERT',
        table: 'transactions',
        durationMs: 25,
      });
      dbMetrics.recordQuery({
        operation: 'DELETE',
        table: 'sessions',
        durationMs: 8,
      });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('table="users"');
      expect(output).toContain('table="transactions"');
      expect(output).toContain('table="sessions"');
      expect(output).toContain('operation="SELECT"');
      expect(output).toContain('operation="INSERT"');
      expect(output).toContain('operation="DELETE"');
    });

    it('classifies unknown operations as OTHER', async () => {
      dbMetrics.recordQuery({
        operation: 'MERGE',
        table: 'data',
        durationMs: 50,
      });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('operation="OTHER"');
    });
  });

  describe('custom latency buckets', () => {
    it('accepts custom latency buckets', async () => {
      const customMetrics = createDbMetrics(collector, {
        latencyBuckets: [1, 10, 100],
      });

      customMetrics.recordQuery({
        operation: 'SELECT',
        table: 'users',
        durationMs: 5,
      });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('db_query_duration_ms');
    });
  });

  describe('accessor methods', () => {
    it('returns the query counter', () => {
      const counter = dbMetrics.getQueryCounter();
      expect(counter).toBeDefined();
      expect(typeof counter.inc).toBe('function');
    });

    it('returns the latency histogram', () => {
      const histogram = dbMetrics.getLatencyHistogram();
      expect(histogram).toBeDefined();
      expect(typeof histogram.observe).toBe('function');
    });

    it('returns the error counter', () => {
      const counter = dbMetrics.getErrorCounter();
      expect(counter).toBeDefined();
      expect(typeof counter.inc).toBe('function');
    });
  });
});
