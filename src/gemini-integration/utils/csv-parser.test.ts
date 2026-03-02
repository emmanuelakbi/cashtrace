// Gemini Integration - CSV parser unit tests
// Validates: Requirements 3.6

import { describe, expect, it } from 'vitest';

import { detectDialect, parse, validateStructure } from './csv-parser.js';

describe('CsvParser', () => {
  describe('detectDialect', () => {
    it('detects comma delimiter', () => {
      const csv = 'name,age,city\nAlice,30,Lagos\nBob,25,Abuja';
      const dialect = detectDialect(csv);
      expect(dialect.delimiter).toBe(',');
      expect(dialect.quoteChar).toBe('"');
      expect(dialect.escapeChar).toBe('"');
    });

    it('detects tab delimiter', () => {
      const csv = 'name\tage\tcity\nAlice\t30\tLagos';
      const dialect = detectDialect(csv);
      expect(dialect.delimiter).toBe('\t');
    });

    it('detects semicolon delimiter', () => {
      const csv = 'name;age;city\nAlice;30;Lagos\nBob;25;Abuja';
      const dialect = detectDialect(csv);
      expect(dialect.delimiter).toBe(';');
    });

    it('detects pipe delimiter', () => {
      const csv = 'name|age|city\nAlice|30|Lagos';
      const dialect = detectDialect(csv);
      expect(dialect.delimiter).toBe('|');
    });

    it('returns comma as default for empty content', () => {
      const dialect = detectDialect('');
      expect(dialect.delimiter).toBe(',');
    });

    it('ignores delimiters inside quoted fields', () => {
      const csv = '"name,full",age,city\n"Alice, Jr",30,Lagos';
      const dialect = detectDialect(csv);
      expect(dialect.delimiter).toBe(',');
    });
  });

  describe('validateStructure', () => {
    it('validates well-formed CSV', () => {
      const csv = 'name,age,city\nAlice,30,Lagos\nBob,25,Abuja';
      const result = validateStructure(csv);
      expect(result.valid).toBe(true);
      expect(result.rowCount).toBe(2);
      expect(result.columnCount).toBe(3);
      expect(result.errors).toHaveLength(0);
    });

    it('returns invalid for empty content', () => {
      const result = validateStructure('');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('CSV content is empty');
    });

    it('detects inconsistent column counts', () => {
      const csv = 'name,age,city\nAlice,30\nBob,25,Abuja';
      const result = validateStructure(csv);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('columns'))).toBe(true);
    });

    it('handles header-only CSV', () => {
      const csv = 'name,age,city';
      const result = validateStructure(csv);
      expect(result.valid).toBe(true);
      expect(result.rowCount).toBe(0);
      expect(result.columnCount).toBe(3);
    });

    it('handles CSV with Windows line endings', () => {
      const csv = 'name,age\r\nAlice,30\r\nBob,25';
      const result = validateStructure(csv);
      expect(result.valid).toBe(true);
      expect(result.rowCount).toBe(2);
    });
  });

  describe('parse', () => {
    it('parses CSV with headers', () => {
      const csv = 'name,age,city\nAlice,30,Lagos\nBob,25,Abuja';
      const result = parse(csv);
      expect(result.success).toBe(true);
      expect(result.headers).toEqual(['name', 'age', 'city']);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual({ name: 'Alice', age: '30', city: 'Lagos' });
      expect(result.rows[1]).toEqual({ name: 'Bob', age: '25', city: 'Abuja' });
    });

    it('parses CSV without headers', () => {
      const csv = 'Alice,30,Lagos\nBob,25,Abuja';
      const result = parse(csv, { hasHeader: false });
      expect(result.success).toBe(true);
      expect(result.headers).toEqual(['column_0', 'column_1', 'column_2']);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual({ column_0: 'Alice', column_1: '30', column_2: 'Lagos' });
    });

    it('returns failure for empty content', () => {
      const result = parse('');
      expect(result.success).toBe(false);
      expect(result.warnings).toContain('CSV content is empty');
    });

    it('handles quoted fields with commas', () => {
      const csv = 'name,description\n"Alice","Sells food, drinks"';
      const result = parse(csv);
      expect(result.success).toBe(true);
      expect(result.rows[0]?.description).toBe('Sells food, drinks');
    });

    it('handles quoted fields with newlines', () => {
      const csv = 'name,note\n"Alice","Line1\nLine2"';
      const result = parse(csv);
      expect(result.success).toBe(true);
      expect(result.rows[0]?.note).toBe('Line1\nLine2');
    });

    it('uses specified delimiter', () => {
      const csv = 'name;age;city\nAlice;30;Lagos';
      const result = parse(csv, { delimiter: ';' });
      expect(result.success).toBe(true);
      expect(result.headers).toEqual(['name', 'age', 'city']);
      expect(result.rows[0]).toEqual({ name: 'Alice', age: '30', city: 'Lagos' });
    });

    it('auto-detects delimiter when not specified', () => {
      const csv = 'name\tage\tcity\nAlice\t30\tLagos';
      const result = parse(csv);
      expect(result.success).toBe(true);
      expect(result.headers).toEqual(['name', 'age', 'city']);
    });

    it('trims header whitespace', () => {
      const csv = ' name , age , city \nAlice,30,Lagos';
      const result = parse(csv);
      expect(result.success).toBe(true);
      expect(result.headers).toEqual(['name', 'age', 'city']);
    });

    it('fills missing values with empty string', () => {
      const csv = 'name,age,city\nAlice,30';
      const result = parse(csv);
      expect(result.success).toBe(true);
      expect(result.rows[0]?.city).toBe('');
    });

    it('warns when header-only CSV is parsed', () => {
      const csv = 'name,age,city';
      const result = parse(csv);
      expect(result.success).toBe(true);
      expect(result.rows).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes('no data rows'))).toBe(true);
    });

    it('handles Nigerian POS export format', () => {
      const csv = [
        'Transaction ID,Date,Amount,Status,Terminal',
        'TXN001,15/03/2024,25000.00,Successful,POS-LAG-001',
        'TXN002,15/03/2024,5500.50,Successful,POS-LAG-001',
      ].join('\n');
      const result = parse(csv);
      expect(result.success).toBe(true);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]?.['Transaction ID']).toBe('TXN001');
      expect(result.rows[0]?.Amount).toBe('25000.00');
    });
  });
});
