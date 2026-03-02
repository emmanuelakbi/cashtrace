import { describe, expect, it } from 'vitest';

import { BusinessSector } from '../types/index.js';

import { validateBusinessSector } from './sectorValidator.js';

describe('validateBusinessSector', () => {
  describe('valid sectors', () => {
    const allSectors = Object.values(BusinessSector);

    it.each(allSectors)('should accept valid sector: %s', (sector) => {
      const result = validateBusinessSector(sector);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept all 11 predefined sectors', () => {
      expect(allSectors).toHaveLength(11);
      for (const sector of allSectors) {
        expect(validateBusinessSector(sector).valid).toBe(true);
      }
    });
  });

  describe('invalid sectors', () => {
    it('should reject an empty string', () => {
      const result = validateBusinessSector('');
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Valid options:');
    });

    it('should reject a random string', () => {
      const result = validateBusinessSector('INVALID_SECTOR');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Valid options:');
    });

    it('should be case-sensitive (lowercase rejected)', () => {
      const result = validateBusinessSector('retail_trading');
      expect(result.valid).toBe(false);
    });

    it('should be case-sensitive (mixed case rejected)', () => {
      const result = validateBusinessSector('Retail_Trading');
      expect(result.valid).toBe(false);
    });

    it('should reject sector with extra whitespace', () => {
      const result = validateBusinessSector(' RETAIL_TRADING ');
      expect(result.valid).toBe(false);
    });

    it('should list all valid options in error message', () => {
      const result = validateBusinessSector('NOPE');
      expect(result.valid).toBe(false);
      for (const sector of Object.values(BusinessSector)) {
        expect(result.errors[0]).toContain(sector);
      }
    });
  });
});
