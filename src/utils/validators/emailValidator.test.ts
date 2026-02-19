/**
 * Unit tests for the email validator.
 *
 * Tests RFC 5322 email validation including edge cases for:
 * - Standard email formats
 * - International domains
 * - Special characters in local part
 * - Quoted local parts
 * - Length limits
 * - Invalid formats
 *
 * @module utils/validators/emailValidator.test
 */

import { describe, it, expect } from 'vitest';
import { validateEmail } from './emailValidator.js';

describe('validateEmail', () => {
  // ─── Valid Email Addresses ───────────────────────────────────────────

  describe('valid standard emails', () => {
    it('should accept a simple email', () => {
      const result = validateEmail('user@example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept email with dots in local part', () => {
      const result = validateEmail('first.last@example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept email with plus addressing', () => {
      const result = validateEmail('user+tag@example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept email with hyphens in local part', () => {
      const result = validateEmail('first-last@example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept email with underscores in local part', () => {
      const result = validateEmail('first_last@example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept email with numbers in local part', () => {
      const result = validateEmail('user123@example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept single character local part', () => {
      const result = validateEmail('a@example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('valid domain formats', () => {
    it('should accept email with subdomain', () => {
      const result = validateEmail('user@mail.example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept email with multiple subdomains', () => {
      const result = validateEmail('user@a.b.c.example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept email with hyphenated domain', () => {
      const result = validateEmail('user@my-domain.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept email with long TLD', () => {
      const result = validateEmail('user@example.museum');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept email with country code TLD', () => {
      const result = validateEmail('user@example.ng');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept email with multi-level TLD', () => {
      const result = validateEmail('user@example.co.uk');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept email with numeric domain labels', () => {
      const result = validateEmail('user@123.example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('valid special characters in local part', () => {
    it('should accept RFC 5322 special characters', () => {
      const result = validateEmail('user!def@example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept hash in local part', () => {
      const result = validateEmail('user#tag@example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept percent in local part', () => {
      const result = validateEmail('user%tag@example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept ampersand in local part', () => {
      const result = validateEmail('user&tag@example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept apostrophe in local part', () => {
      const result = validateEmail("o'connor@example.com");
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept equals sign in local part', () => {
      const result = validateEmail('user=tag@example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept backtick in local part', () => {
      const result = validateEmail('user`tag@example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept curly braces in local part', () => {
      const result = validateEmail('user{tag}@example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept pipe in local part', () => {
      const result = validateEmail('user|tag@example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept tilde in local part', () => {
      const result = validateEmail('user~tag@example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('valid quoted local parts', () => {
    it('should accept quoted local part with spaces', () => {
      const result = validateEmail('"john doe"@example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept quoted local part with special chars', () => {
      const result = validateEmail('"user@host"@example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept quoted local part with escaped characters', () => {
      const result = validateEmail('"user\\"name"@example.com');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  // ─── Invalid Email Addresses ─────────────────────────────────────────

  describe('empty and missing input', () => {
    it('should reject empty string', () => {
      const result = validateEmail('');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Email is required');
    });

    it('should reject whitespace-only string', () => {
      const result = validateEmail('   ');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Email is required');
    });
  });

  describe('missing @ symbol', () => {
    it('should reject email without @', () => {
      const result = validateEmail('userexample.com');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid email format');
    });

    it('should reject plain text', () => {
      const result = validateEmail('notanemail');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid email format');
    });
  });

  describe('invalid local part', () => {
    it('should reject email starting with dot', () => {
      const result = validateEmail('.user@example.com');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid email format');
    });

    it('should reject email ending with dot before @', () => {
      const result = validateEmail('user.@example.com');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid email format');
    });

    it('should reject email with consecutive dots', () => {
      const result = validateEmail('user..name@example.com');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid email format');
    });

    it('should reject email with empty local part', () => {
      const result = validateEmail('@example.com');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid email format');
    });

    it('should reject email with space in unquoted local part', () => {
      const result = validateEmail('user name@example.com');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid email format');
    });
  });

  describe('invalid domain part', () => {
    it('should reject email with empty domain', () => {
      const result = validateEmail('user@');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid email format');
    });

    it('should reject email with domain starting with hyphen', () => {
      const result = validateEmail('user@-example.com');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid email format');
    });

    it('should reject email with domain ending with hyphen', () => {
      const result = validateEmail('user@example-.com');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid email format');
    });

    it('should reject email with single character TLD', () => {
      const result = validateEmail('user@example.c');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid email format');
    });

    it('should reject email with no TLD', () => {
      const result = validateEmail('user@example');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid email format');
    });

    it('should reject email with numeric TLD', () => {
      const result = validateEmail('user@example.123');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid email format');
    });

    it('should reject email with double dots in domain', () => {
      const result = validateEmail('user@example..com');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid email format');
    });
  });

  describe('multiple @ symbols', () => {
    it('should reject email with multiple unquoted @ symbols', () => {
      const result = validateEmail('user@name@example.com');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid email format');
    });
  });

  describe('length limits', () => {
    it('should reject email exceeding 254 characters', () => {
      const longLocal = 'a'.repeat(64);
      const longDomain = 'b'.repeat(186) + '.com'; // 64 + 1 + 190 = 255
      const result = validateEmail(`${longLocal}@${longDomain}`);
      expect(result.valid).toBe(false);
    });

    it('should reject email with local part exceeding 64 characters', () => {
      const longLocal = 'a'.repeat(65);
      const result = validateEmail(`${longLocal}@example.com`);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('local part');
    });

    it('should accept email at exactly 64 character local part limit', () => {
      const maxLocal = 'a'.repeat(64);
      const result = validateEmail(`${maxLocal}@example.com`);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  // ─── Return Type Validation ──────────────────────────────────────────

  describe('return type', () => {
    it('should return ValidationResult with valid=true and empty errors for valid email', () => {
      const result = validateEmail('test@example.com');
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
      expect(result.valid).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should return ValidationResult with valid=false and non-empty errors for invalid email', () => {
      const result = validateEmail('invalid');
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
      expect(result.valid).toBe(false);
      expect(Array.isArray(result.errors)).toBe(true);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
