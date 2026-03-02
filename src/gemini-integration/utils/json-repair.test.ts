// Gemini Integration - Unit tests for JSON repair utility
// Validates: Requirements 5.4

import { describe, expect, it } from 'vitest';

import { repairJson } from './json-repair.js';

describe('repairJson', () => {
  describe('valid JSON passthrough', () => {
    it('should return valid JSON object unchanged', () => {
      const input = '{"name": "test", "value": 42}';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({ name: 'test', value: 42 });
      expect(result.repairs).toEqual([]);
    });

    it('should return valid JSON array unchanged', () => {
      const input = '[1, 2, 3]';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual([1, 2, 3]);
      expect(result.repairs).toEqual([]);
    });

    it('should return nested valid JSON unchanged', () => {
      const input = '{"transactions": [{"date": "2024-01-01", "amount": 1000}]}';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({
        transactions: [{ date: '2024-01-01', amount: 1000 }],
      });
      expect(result.repairs).toEqual([]);
    });
  });

  describe('markdown code fences', () => {
    it('should strip ```json fences', () => {
      const input = '```json\n{"key": "value"}\n```';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({ key: 'value' });
      expect(result.repairs).toContain('Removed markdown code fences');
    });

    it('should strip ``` fences without language tag', () => {
      const input = '```\n{"key": "value"}\n```';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({ key: 'value' });
      expect(result.repairs).toContain('Removed markdown code fences');
    });

    it('should strip ```JSON fences (uppercase)', () => {
      const input = '```JSON\n{"key": "value"}\n```';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({ key: 'value' });
      expect(result.repairs).toContain('Removed markdown code fences');
    });
  });

  describe('JavaScript-style comments', () => {
    it('should remove single-line comments', () => {
      const input = '{\n  "key": "value" // this is a comment\n}';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({ key: 'value' });
      expect(result.repairs).toContain('Removed JavaScript-style comments');
    });

    it('should remove multi-line comments', () => {
      const input = '{\n  /* comment */\n  "key": "value"\n}';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({ key: 'value' });
      expect(result.repairs).toContain('Removed JavaScript-style comments');
    });

    it('should not remove // inside strings', () => {
      const input = '{"url": "https://example.com"}';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({ url: 'https://example.com' });
      expect(result.repairs).toEqual([]);
    });
  });

  describe('trailing commas', () => {
    it('should remove trailing comma in object', () => {
      const input = '{"a": 1, "b": 2,}';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({ a: 1, b: 2 });
      expect(result.repairs).toContain('Removed trailing commas');
    });

    it('should remove trailing comma in array', () => {
      const input = '[1, 2, 3,]';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual([1, 2, 3]);
      expect(result.repairs).toContain('Removed trailing commas');
    });

    it('should remove trailing comma with whitespace', () => {
      const input = '{"a": 1,\n  }';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({ a: 1 });
      expect(result.repairs).toContain('Removed trailing commas');
    });

    it('should not remove commas inside strings', () => {
      const input = '{"text": "hello, world,"}';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({ text: 'hello, world,' });
      expect(result.repairs).toEqual([]);
    });
  });

  describe('single-quoted strings', () => {
    it('should replace single-quoted keys and values', () => {
      const input = '{"key": \'value\'}';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({ key: 'value' });
      expect(result.repairs).toContain('Replaced single-quoted strings with double quotes');
    });

    it('should handle escaped single quotes within single-quoted strings', () => {
      const input = "{\"key\": 'it\\'s a test'}";
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({ key: "it's a test" });
    });

    it('should escape double quotes inside converted single-quoted strings', () => {
      const input = '{"key": \'say "hello"\'}';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({ key: 'say "hello"' });
    });
  });

  describe('unquoted keys', () => {
    it('should quote unquoted object keys', () => {
      const input = '{name: "value"}';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({ name: 'value' });
      expect(result.repairs).toContain('Added quotes to unquoted object keys');
    });

    it('should handle multiple unquoted keys', () => {
      const input = '{name: "test", age: 25}';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({ name: 'test', age: 25 });
    });

    it('should handle keys with underscores and dollar signs', () => {
      const input = '{my_key: "value", $special: true}';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({ my_key: 'value', $special: true });
    });

    it('should not quote boolean/null values', () => {
      const input = '{"key": true, "other": null}';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({ key: true, other: null });
      expect(result.repairs).toEqual([]);
    });
  });

  describe('missing closing brackets', () => {
    it('should add missing closing brace', () => {
      const input = '{"key": "value"';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({ key: 'value' });
      expect(result.repairs).toContain('Added missing closing brackets/braces');
    });

    it('should add missing closing bracket', () => {
      const input = '[1, 2, 3';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual([1, 2, 3]);
      expect(result.repairs).toContain('Added missing closing brackets/braces');
    });

    it('should add multiple missing closers', () => {
      const input = '{"data": [1, 2';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({ data: [1, 2] });
    });
  });

  describe('combined repairs', () => {
    it('should handle markdown fences with trailing commas', () => {
      const input = '```json\n{"a": 1, "b": 2,}\n```';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({ a: 1, b: 2 });
      expect(result.repairs.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle comments with trailing commas', () => {
      const input = '{\n  "a": 1, // first\n  "b": 2,\n}';
      const result = repairJson(input);

      expect(result.success).toBe(true);
      expect(result.repairedJson).toEqual({ a: 1, b: 2 });
    });
  });

  describe('failure cases', () => {
    it('should return failure for completely invalid input', () => {
      const result = repairJson('not json at all');

      expect(result.success).toBe(false);
      expect(result.repairedJson).toBeNull();
    });

    it('should return failure for empty string', () => {
      const result = repairJson('');

      expect(result.success).toBe(false);
      expect(result.repairedJson).toBeNull();
    });

    it('should return failure for primitive JSON values', () => {
      const result = repairJson('"just a string"');

      expect(result.success).toBe(false);
      expect(result.repairedJson).toBeNull();
    });

    it('should return failure for numeric JSON values', () => {
      const result = repairJson('42');

      expect(result.success).toBe(false);
      expect(result.repairedJson).toBeNull();
    });
  });
});
