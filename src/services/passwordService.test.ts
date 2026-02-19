/**
 * Unit tests for the password service.
 *
 * Tests bcrypt hashing with cost factor 12, password verification,
 * and password strength validation delegation.
 *
 * @module services/passwordService.test
 */

import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, validatePasswordStrength } from './passwordService.js';

describe('passwordService', () => {
  describe('hashPassword', () => {
    it('should return a bcrypt hash string', async () => {
      const hash = await hashPassword('securePass1');
      // bcrypt hashes start with $2b$ (or $2a$) and are 60 characters
      expect(hash).toMatch(/^\$2[ab]\$/);
      expect(hash.length).toBe(60);
    });

    it('should use cost factor 12', async () => {
      const hash = await hashPassword('securePass1');
      // bcrypt hash format: $2b$12$...
      expect(hash).toMatch(/^\$2[ab]\$12\$/);
    });

    it('should produce different hashes for the same password', async () => {
      const hash1 = await hashPassword('securePass1');
      const hash2 = await hashPassword('securePass1');
      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hashes for different passwords', async () => {
      const hash1 = await hashPassword('securePass1');
      const hash2 = await hashPassword('differentPass2');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyPassword', () => {
    it('should return true for correct password', async () => {
      const password = 'myPassword123';
      const hash = await hashPassword(password);
      const result = await verifyPassword(password, hash);
      expect(result).toBe(true);
    });

    it('should return false for incorrect password', async () => {
      const hash = await hashPassword('correctPass1');
      const result = await verifyPassword('wrongPass1', hash);
      expect(result).toBe(false);
    });

    it('should return false for empty string against a valid hash', async () => {
      const hash = await hashPassword('securePass1');
      const result = await verifyPassword('', hash);
      expect(result).toBe(false);
    });

    it('should handle passwords with special characters', async () => {
      const password = 'p@$$w0rd!#%^&*()';
      const hash = await hashPassword(password);
      const result = await verifyPassword(password, hash);
      expect(result).toBe(true);
    });

    it('should handle passwords with unicode characters', async () => {
      const password = 'pässwörd1ñ';
      const hash = await hashPassword(password);
      const result = await verifyPassword(password, hash);
      expect(result).toBe(true);
    });
  });

  describe('validatePasswordStrength', () => {
    it('should accept a valid password with 8+ chars and a digit', () => {
      const result = validatePasswordStrength('securePass1');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should reject a password shorter than 8 characters', () => {
      const result = validatePasswordStrength('short1');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters');
    });

    it('should reject a password without any digits', () => {
      const result = validatePasswordStrength('noDigitsHere');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least 1 number');
    });

    it('should reject a password that is both too short and has no digits', () => {
      const result = validatePasswordStrength('abc');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters');
      expect(result.errors).toContain('Password must contain at least 1 number');
    });

    it('should accept a password at exactly 8 characters with a digit', () => {
      const result = validatePasswordStrength('abcdefg1');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });
});
