import { describe, it, expect, beforeEach } from 'vitest';
import { createMetricsCollector, type MetricsCollector } from './collector.js';
import {
  createBusinessMetrics,
  normalizeTransactionType,
  normalizeTransactionStatus,
  normalizeDocumentType,
  normalizeDocumentStatus,
  type BusinessMetrics,
} from './businessMetrics.js';
import { loadPrometheusConfig } from './prometheusConfig.js';

describe('BusinessMetrics', () => {
  let collector: MetricsCollector;
  let businessMetrics: BusinessMetrics;

  beforeEach(() => {
    collector = createMetricsCollector(loadPrometheusConfig());
    businessMetrics = createBusinessMetrics(collector);
  });

  describe('normalizeTransactionType', () => {
    it('normalizes valid types to lowercase', () => {
      expect(normalizeTransactionType('payment')).toBe('payment');
      expect(normalizeTransactionType('TRANSFER')).toBe('transfer');
      expect(normalizeTransactionType('Withdrawal')).toBe('withdrawal');
      expect(normalizeTransactionType('DEPOSIT')).toBe('deposit');
      expect(normalizeTransactionType('Refund')).toBe('refund');
    });

    it('returns other for unrecognized types', () => {
      expect(normalizeTransactionType('wire')).toBe('other');
      expect(normalizeTransactionType('')).toBe('other');
    });
  });

  describe('normalizeTransactionStatus', () => {
    it('normalizes valid statuses to lowercase', () => {
      expect(normalizeTransactionStatus('success')).toBe('success');
      expect(normalizeTransactionStatus('FAILURE')).toBe('failure');
      expect(normalizeTransactionStatus('Pending')).toBe('pending');
    });

    it('returns unknown for unrecognized statuses', () => {
      expect(normalizeTransactionStatus('cancelled')).toBe('unknown');
      expect(normalizeTransactionStatus('')).toBe('unknown');
    });
  });

  describe('normalizeDocumentType', () => {
    it('normalizes valid types to lowercase', () => {
      expect(normalizeDocumentType('invoice')).toBe('invoice');
      expect(normalizeDocumentType('RECEIPT')).toBe('receipt');
      expect(normalizeDocumentType('Statement')).toBe('statement');
      expect(normalizeDocumentType('REPORT')).toBe('report');
    });

    it('returns other for unrecognized types', () => {
      expect(normalizeDocumentType('memo')).toBe('other');
      expect(normalizeDocumentType('')).toBe('other');
    });
  });

  describe('normalizeDocumentStatus', () => {
    it('normalizes valid statuses to lowercase', () => {
      expect(normalizeDocumentStatus('success')).toBe('success');
      expect(normalizeDocumentStatus('FAILURE')).toBe('failure');
    });

    it('returns unknown for unrecognized statuses', () => {
      expect(normalizeDocumentStatus('partial')).toBe('unknown');
      expect(normalizeDocumentStatus('')).toBe('unknown');
    });
  });

  describe('recordTransaction', () => {
    it('increments transaction counter with type and status labels', async () => {
      businessMetrics.recordTransaction({ type: 'payment', status: 'success' });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('business_transactions_total');
      expect(output).toContain('type="payment"');
      expect(output).toContain('status="success"');
    });

    it('normalizes type and status to lowercase', async () => {
      businessMetrics.recordTransaction({ type: 'TRANSFER', status: 'FAILURE' });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('type="transfer"');
      expect(output).toContain('status="failure"');
    });

    it('classifies unknown types as other', async () => {
      businessMetrics.recordTransaction({ type: 'wire', status: 'success' });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('type="other"');
    });

    it('classifies unknown statuses as unknown', async () => {
      businessMetrics.recordTransaction({ type: 'payment', status: 'cancelled' });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('status="unknown"');
    });

    it('tracks multiple transaction types', async () => {
      businessMetrics.recordTransaction({ type: 'payment', status: 'success' });
      businessMetrics.recordTransaction({ type: 'transfer', status: 'success' });
      businessMetrics.recordTransaction({ type: 'deposit', status: 'pending' });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('type="payment"');
      expect(output).toContain('type="transfer"');
      expect(output).toContain('type="deposit"');
    });
  });

  describe('recordDocumentParse', () => {
    it('increments document parse counter with type and status labels', async () => {
      businessMetrics.recordDocumentParse({ type: 'invoice', status: 'success' });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('business_documents_parsed_total');
      expect(output).toContain('type="invoice"');
      expect(output).toContain('status="success"');
    });

    it('normalizes type and status to lowercase', async () => {
      businessMetrics.recordDocumentParse({ type: 'RECEIPT', status: 'FAILURE' });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('type="receipt"');
      expect(output).toContain('status="failure"');
    });

    it('classifies unknown document types as other', async () => {
      businessMetrics.recordDocumentParse({ type: 'memo', status: 'success' });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('type="other"');
    });

    it('classifies unknown statuses as unknown', async () => {
      businessMetrics.recordDocumentParse({ type: 'invoice', status: 'partial' });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('status="unknown"');
    });

    it('tracks multiple document types', async () => {
      businessMetrics.recordDocumentParse({ type: 'invoice', status: 'success' });
      businessMetrics.recordDocumentParse({ type: 'receipt', status: 'success' });
      businessMetrics.recordDocumentParse({ type: 'statement', status: 'failure' });

      const output = await collector.getMetricsOutput();
      expect(output).toContain('type="invoice"');
      expect(output).toContain('type="receipt"');
      expect(output).toContain('type="statement"');
    });
  });

  describe('accessor methods', () => {
    it('returns the transaction counter', () => {
      const counter = businessMetrics.getTransactionCounter();
      expect(counter).toBeDefined();
      expect(typeof counter.inc).toBe('function');
    });

    it('returns the document parse counter', () => {
      const counter = businessMetrics.getDocumentParseCounter();
      expect(counter).toBeDefined();
      expect(typeof counter.inc).toBe('function');
    });
  });
});
