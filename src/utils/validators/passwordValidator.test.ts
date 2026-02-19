/**
 * Unit tests for the password validator.
 *
 * Tests password validation including:
 * - Boundary conditions (7 chars, 8 chars)
 * - Various number positions (start, middle, end)
 * - Edge cases (empty, whitespace, special characters)
 * - Multiple validation errors reported together
 *
 * @module utils/validators/passwordValidator.test
 */

import { describe, it, expect } from 'vitest';
import { validatePassword } from './passwordValidator.js';

describe('validatePassword', () => {
  // ─── Valid Passwords ─────────────────────────────────────────────────

  describe('valid passwords', () => {
    it('should accept a password with 8 characters and a number', () => {
      const result = validatePassword('abcdefg1');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept a password longer than 8 characters', () => {
      const result = validatePassword('mySecurePassword123');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept a password with number at the start', () => {
      const result = validatePassword('1abcdefg');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept a password with number in the middle', () => {
      const result = validatePassword('abcd1efg');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept a password with number at the end', () => {
      const result = validatePassword('abcdefg1');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept a password with multiple numbers', () => {
      const result = validatePassword('abc12345');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept a password with only numbers if 8+ chars', () => {
      const result = validatePassword('12345678');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept a password with special characters and a number', () => {
      const result = validatePassword('p@ss!0rd');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept a password with spaces and a number', () => {
      const result = validatePassword('pass 1 word');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  // ─── Boundary Conditions ─────────────────────────────────────────────

  describe('boundary conditions', () => {
    it('should reject a password with exactly 7 characters (with number)', () => {
      const result = validatePassword('abcde1g');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters');
    });

    it('should accept a password with exactly 8 characters (with number)', () => {
      const result = validatePassword('abcdef1g');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept a password with exactly 9 characters (with number)', () => {
      const result = validatePassword('abcdefg1h');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept a very long password with a number', () => {
      const result = validatePassword('a'.repeat(100) + '1');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  // ─── Missing Number ──────────────────────────────────────────────────

  describe('missing number', () => {
    it('should reject a password with 8+ characters but no number', () => {
      const result = validatePassword('abcdefgh');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least 1 number');
    });

    it('should reject a long password without any number', () => {
      const result = validatePassword('abcdefghijklmnop');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least 1 number');
    });

    it('should reject a password with special characters but no number', () => {
      const result = validatePassword('p@ss!ord');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least 1 number');
    });
  });

  // ─── Too Short ───────────────────────────────────────────────────────

  describe('too short', () => {
    it('should reject a single character password', () => {
      const result = validatePassword('a');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters');
    });

    it('should reject a 7-character password with a number', () => {
      const result = validatePassword('abcde1f');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters');
    });

    it('should reject a short password that is only numbers', () => {
      const result = validatePassword('1234567');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters');
    });
  });

  // ─── Multiple Errors ─────────────────────────────────────────────────

  describe('multiple validation errors', () => {
    it('should report both errors when password is too short and has no number', () => {
      const result = validatePassword('short');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters');
      expect(result.errors).toContain('Password must contain at least 1 number');
      expect(result.errors).toHaveLength(2);
    });

    it('should report both errors for a single letter', () => {
      const result = validatePassword('a');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters');
      expect(result.errors).toContain('Password must contain at least 1 number');
      expect(result.errors).toHaveLength(2);
    });
  });

  // ─── Empty and Missing Input ─────────────────────────────────────────

  describe('empty and missing input', () => {
    it('should reject an empty string', () => {
      const result = validatePassword('');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password is required');
    });
  });

  // ─── Various Number Positions ────────────────────────────────────────

  describe('various number positions', () => {
    it('should accept number 0 in password', () => {
      const result = validatePassword('abcdefg0');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept number 9 in password', () => {
      const result = validatePassword('abcdefg9');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept all digits 0-9', () => {
      const result = validatePassword('0123456789');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  // ─── Return Type Validation ──────────────────────────────────────────

  describe('return type', () => {
    it('should return ValidationResult with valid=true and empty errors for valid password', () => {
      const result = validatePassword('validPass1');
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
      expect(result.valid).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should return ValidationResult with valid=false and non-empty errors for invalid password', () => {
      const result = validatePassword('bad');
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
      expect(result.valid).toBe(false);
      expect(Array.isArray(result.errors)).toBe(true);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
