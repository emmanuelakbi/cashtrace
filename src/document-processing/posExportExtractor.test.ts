/**
 * Unit tests for PosExportExtractor.
 *
 * Validates: Requirement 3.1
 * @module document-processing/posExportExtractor.test
 */

import { describe, expect, it } from 'vitest';

import { PosExportExtractor } from './posExportExtractor.js';
import type { Document } from './types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-001',
    businessId: 'biz-001',
    userId: 'user-001',
    filename: 'pos_export_doc-001.csv',
    originalFilename: 'pos_transactions.csv',
    documentType: 'POS_EXPORT',
    mimeType: 'text/csv',
    fileSize: 2048,
    s3Key: 'documents/biz-001/POS_EXPORT/2024/01/doc-001_pos.csv',
    s3Bucket: 'cashtrace-docs',
    status: 'PROCESSING',
    processingStartedAt: new Date('2024-01-15T10:00:00Z'),
    processingCompletedAt: null,
    processingDurationMs: null,
    transactionsExtracted: null,
    processingWarnings: [],
    processingErrors: [],
    idempotencyKey: null,
    uploadedAt: new Date('2024-01-15T09:00:00Z'),
    updatedAt: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

function csvToBuffer(csv: string): Buffer {
  return Buffer.from(csv, 'utf-8');
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PosExportExtractor', () => {
  const extractor = new PosExportExtractor();
  const document = makeDocument();

  describe('successful extraction from well-formed CSV', () => {
    it('should extract transactions from a standard POS export', async () => {
      const csv = [
        'date,description,amount,type,reference',
        '2024-03-01,POS Purchase - Shoprite Ikeja,15750.00,debit,TRM001',
        '2024-03-02,Card Payment Received,8500.00,credit,TRM002',
      ].join('\n');

      const result = await extractor.extract(csvToBuffer(csv), document);

      expect(result.transactions).toHaveLength(2);
      expect(result.confidence).toBe(1.0);
      expect(result.errors).toHaveLength(0);

      expect(result.transactions[0]!.description).toBe('POS Purchase - Shoprite Ikeja');
      expect(result.transactions[0]!.amount).toBe(1575000); // 15750 × 100
      expect(result.transactions[0]!.type).toBe('debit');
      expect(result.transactions[0]!.reference).toBe('TRM001');
      expect(result.transactions[0]!.date).toEqual(new Date('2024-03-01'));

      expect(result.transactions[1]!.description).toBe('Card Payment Received');
      expect(result.transactions[1]!.amount).toBe(850000);
      expect(result.transactions[1]!.type).toBe('credit');
    });
  });

  describe('handles various column name formats', () => {
    it('should match transaction_date, narration, value, transaction_type, ref', async () => {
      const csv = [
        'transaction_date,narration,value,transaction_type,ref',
        '2024-04-10,Airtime Purchase,500.00,debit,REF123',
      ].join('\n');

      const result = await extractor.extract(csvToBuffer(csv), document);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.description).toBe('Airtime Purchase');
      expect(result.transactions[0]!.amount).toBe(50000);
      expect(result.transactions[0]!.type).toBe('debit');
      expect(result.transactions[0]!.reference).toBe('REF123');
    });

    it('should match txn_date, details, total, txn_type, terminal_id', async () => {
      const csv = [
        'txn_date,details,total,txn_type,terminal_id',
        '2024-05-20,Fuel Station,12000.00,debit,POS-TERM-42',
      ].join('\n');

      const result = await extractor.extract(csvToBuffer(csv), document);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.description).toBe('Fuel Station');
      expect(result.transactions[0]!.amount).toBe(1200000);
      expect(result.transactions[0]!.reference).toBe('POS-TERM-42');
    });

    it('should match trans_date, memo, amount, dr_cr, ref_no', async () => {
      const csv = [
        'trans_date,memo,amount,dr_cr,ref_no',
        '2024-06-15,Grocery Store,3200.50,cr,RN-9988',
      ].join('\n');

      const result = await extractor.extract(csvToBuffer(csv), document);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.description).toBe('Grocery Store');
      expect(result.transactions[0]!.amount).toBe(320050);
      expect(result.transactions[0]!.type).toBe('credit');
      expect(result.transactions[0]!.reference).toBe('RN-9988');
    });
  });

  describe('converts Naira amounts to Kobo', () => {
    it('should multiply amounts by 100 and round to nearest integer', async () => {
      const csv = [
        'date,description,amount',
        '2024-01-10,Item A,99.99',
        '2024-01-11,Item B,0.50',
        '2024-01-12,Item C,500000',
      ].join('\n');

      const result = await extractor.extract(csvToBuffer(csv), document);

      expect(result.transactions).toHaveLength(3);
      expect(result.transactions[0]!.amount).toBe(9999);
      expect(result.transactions[1]!.amount).toBe(50);
      expect(result.transactions[2]!.amount).toBe(50000000);
    });

    it('should strip currency symbols and commas from amounts', async () => {
      const csv = ['date,description,amount', '2024-02-01,Transfer,"₦15,750.00"'].join('\n');

      const result = await extractor.extract(csvToBuffer(csv), document);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.amount).toBe(1575000);
    });
  });

  describe('handles empty CSV', () => {
    it('should return empty transactions with warning for completely empty content', async () => {
      const result = await extractor.extract(csvToBuffer(''), document);

      expect(result.transactions).toHaveLength(0);
      expect(result.warnings).toContain('CSV file is empty');
      expect(result.confidence).toBe(1.0);
    });

    it('should return empty transactions with warning for headers-only CSV', async () => {
      const csv = 'date,description,amount,type,reference';

      const result = await extractor.extract(csvToBuffer(csv), document);

      expect(result.transactions).toHaveLength(0);
      expect(result.warnings).toContain('CSV file contains only headers, no data rows');
    });
  });

  describe('handles missing columns with warnings', () => {
    it('should warn when date column is missing', async () => {
      const csv = ['description,amount,type', 'POS Sale,5000.00,credit'].join('\n');

      const result = await extractor.extract(csvToBuffer(csv), document);

      expect(result.warnings).toContain('Missing date column — transactions will use current date');
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.amount).toBe(500000);
    });

    it('should warn when amount column is missing', async () => {
      const csv = ['date,description,type', '2024-01-01,Some transaction,debit'].join('\n');

      const result = await extractor.extract(csvToBuffer(csv), document);

      expect(result.warnings).toContain(
        'Missing amount column — cannot extract transaction amounts',
      );
    });

    it('should warn when description column is missing', async () => {
      const csv = ['date,amount,type', '2024-01-01,1000.00,debit'].join('\n');

      const result = await extractor.extract(csvToBuffer(csv), document);

      expect(result.warnings).toContain('Missing description column');
      expect(result.transactions).toHaveLength(1);
      // Should use default description
      expect(result.transactions[0]!.description).toBe('POS transaction 2');
    });
  });

  describe('handles quoted fields with commas', () => {
    it('should parse quoted fields containing commas', async () => {
      const csv = [
        'date,description,amount,type',
        '2024-07-01,"Shoprite, Ikeja Mall",7500.00,debit',
      ].join('\n');

      const result = await extractor.extract(csvToBuffer(csv), document);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.description).toBe('Shoprite, Ikeja Mall');
    });

    it('should handle escaped quotes within quoted fields', async () => {
      const csv = ['date,description,amount', '2024-07-02,"Item ""Special"" Deal",2000.00'].join(
        '\n',
      );

      const result = await extractor.extract(csvToBuffer(csv), document);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.description).toBe('Item "Special" Deal');
    });

    it('should handle newlines within quoted fields', async () => {
      const csv = 'date,description,amount\n' + '2024-07-03,"Multi\nline\ndescription",3000.00';

      const result = await extractor.extract(csvToBuffer(csv), document);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.description).toBe('Multi\nline\ndescription');
    });
  });

  describe('infers credit/debit from amount sign when no type column', () => {
    it('should treat positive amounts as credit', async () => {
      const csv = ['date,description,amount', '2024-08-01,Card Payment Received,5000.00'].join(
        '\n',
      );

      const result = await extractor.extract(csvToBuffer(csv), document);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.type).toBe('credit');
      expect(result.transactions[0]!.amount).toBe(500000);
    });

    it('should treat negative amounts as debit', async () => {
      const csv = ['date,description,amount', '2024-08-02,POS Charge,-1500.00'].join('\n');

      const result = await extractor.extract(csvToBuffer(csv), document);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.type).toBe('debit');
      expect(result.transactions[0]!.amount).toBe(150000); // absolute value
    });
  });

  describe('skips unparseable rows with warnings', () => {
    it('should skip rows where both date and amount are unparseable', async () => {
      const csv = [
        'date,description,amount',
        'not-a-date,Good Row,abc',
        '2024-09-01,Valid Row,2000.00',
      ].join('\n');

      const result = await extractor.extract(csvToBuffer(csv), document);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.description).toBe('Valid Row');
      expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('skipped')]));
    });

    it('should still extract row if date is valid but amount is unparseable', async () => {
      const csv = ['date,description,amount', '2024-09-05,Partial Row,not-a-number'].join('\n');

      const result = await extractor.extract(csvToBuffer(csv), document);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.description).toBe('Partial Row');
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('could not parse amount')]),
      );
    });
  });

  describe('handles CRLF line endings', () => {
    it('should parse CSV with Windows-style line endings', async () => {
      const csv = 'date,description,amount\r\n2024-10-01,CRLF Row,1000.00\r\n';

      const result = await extractor.extract(csvToBuffer(csv), document);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]!.description).toBe('CRLF Row');
      expect(result.transactions[0]!.amount).toBe(100000);
    });
  });
});
