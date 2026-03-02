import { describe, expect, it } from 'vitest';

import { validateBusinessName } from './nameValidator.js';

describe('validateBusinessName', () => {
  describe('valid names', () => {
    it('should accept a 2-character name (minimum boundary)', () => {
      const result = validateBusinessName('Ab');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept a 100-character name (maximum boundary)', () => {
      const name = 'A'.repeat(100);
      const result = validateBusinessName(name);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept a typical Nigerian business name', () => {
      const result = validateBusinessName('Ade & Sons Trading');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept unicode characters', () => {
      const result = validateBusinessName('Ọlá Enterprises');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept names with numbers', () => {
      const result = validateBusinessName('247 Express Logistics');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('whitespace trimming', () => {
    it('should trim leading whitespace before validation', () => {
      const result = validateBusinessName('  Valid Name');
      expect(result.valid).toBe(true);
    });

    it('should trim trailing whitespace before validation', () => {
      const result = validateBusinessName('Valid Name   ');
      expect(result.valid).toBe(true);
    });

    it('should trim both ends before validation', () => {
      const result = validateBusinessName('  Valid Name  ');
      expect(result.valid).toBe(true);
    });

    it('should reject whitespace-only strings', () => {
      const result = validateBusinessName('   ');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Business name is required');
    });

    it('should validate length after trimming', () => {
      // 'A' with surrounding spaces — trimmed length is 1, should fail
      const result = validateBusinessName('  A  ');
      expect(result.valid).toBe(false);
    });
  });

  describe('invalid names', () => {
    it('should reject an empty string', () => {
      const result = validateBusinessName('');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Business name is required');
    });

    it('should reject a 1-character name (below minimum)', () => {
      const result = validateBusinessName('A');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('between 2 and 100');
    });

    it('should reject a 101-character name (above maximum)', () => {
      const name = 'A'.repeat(101);
      const result = validateBusinessName(name);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('between 2 and 100');
    });
  });
});
