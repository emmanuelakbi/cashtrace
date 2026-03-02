import { describe, expect, it } from 'vitest';

import {
  extractNigerianPhone,
  parseNigerianCurrency,
  parseNigerianDate,
} from './nigerian-formats.js';

describe('parseNigerianDate', () => {
  describe('DD/MM/YYYY format', () => {
    it('parses a standard date', () => {
      expect(parseNigerianDate('25/12/2024')).toBe('2024-12-25');
    });

    it('parses single-digit day and month', () => {
      expect(parseNigerianDate('1/2/2024')).toBe('2024-02-01');
    });

    it('parses first day of year', () => {
      expect(parseNigerianDate('01/01/2023')).toBe('2023-01-01');
    });

    it('parses last day of year', () => {
      expect(parseNigerianDate('31/12/2023')).toBe('2023-12-31');
    });
  });

  describe('DD-MM-YYYY format', () => {
    it('parses a standard date with dashes', () => {
      expect(parseNigerianDate('15-06-2024')).toBe('2024-06-15');
    });

    it('parses single-digit day with dashes', () => {
      expect(parseNigerianDate('5-11-2023')).toBe('2023-11-05');
    });
  });

  describe('DD/MMM/YYYY format', () => {
    it('parses abbreviated month name with slashes', () => {
      expect(parseNigerianDate('25/Dec/2024')).toBe('2024-12-25');
    });

    it('parses lowercase abbreviated month', () => {
      expect(parseNigerianDate('10/jan/2023')).toBe('2023-01-10');
    });

    it('parses uppercase abbreviated month', () => {
      expect(parseNigerianDate('03/MAR/2024')).toBe('2024-03-03');
    });
  });

  describe('DD-MMM-YYYY format', () => {
    it('parses abbreviated month name with dashes', () => {
      expect(parseNigerianDate('14-Feb-2024')).toBe('2024-02-14');
    });
  });

  describe('leap year handling', () => {
    it('accepts Feb 29 on a leap year', () => {
      expect(parseNigerianDate('29/02/2024')).toBe('2024-02-29');
    });

    it('rejects Feb 29 on a non-leap year', () => {
      expect(parseNigerianDate('29/02/2023')).toBeNull();
    });
  });

  describe('invalid inputs', () => {
    it('returns null for empty string', () => {
      expect(parseNigerianDate('')).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      expect(parseNigerianDate('   ')).toBeNull();
    });

    it('returns null for invalid month', () => {
      expect(parseNigerianDate('15/13/2024')).toBeNull();
    });

    it('returns null for invalid day', () => {
      expect(parseNigerianDate('32/01/2024')).toBeNull();
    });

    it('returns null for day 0', () => {
      expect(parseNigerianDate('00/01/2024')).toBeNull();
    });

    it('returns null for month 0', () => {
      expect(parseNigerianDate('15/00/2024')).toBeNull();
    });

    it('returns null for invalid month abbreviation', () => {
      expect(parseNigerianDate('15/Xyz/2024')).toBeNull();
    });

    it('returns null for YYYY-MM-DD format (not Nigerian)', () => {
      expect(parseNigerianDate('2024-12-25')).toBeNull();
    });

    it('returns null for non-date text', () => {
      expect(parseNigerianDate('hello world')).toBeNull();
    });

    it('returns null for Feb 30', () => {
      expect(parseNigerianDate('30/02/2024')).toBeNull();
    });

    it('returns null for Apr 31', () => {
      expect(parseNigerianDate('31/04/2024')).toBeNull();
    });
  });

  describe('whitespace handling', () => {
    it('trims leading and trailing whitespace', () => {
      expect(parseNigerianDate('  25/12/2024  ')).toBe('2024-12-25');
    });
  });
});

describe('parseNigerianCurrency', () => {
  describe('₦ prefix', () => {
    it('parses simple amount', () => {
      expect(parseNigerianCurrency('₦1000')).toBe(1000);
    });

    it('parses amount with commas', () => {
      expect(parseNigerianCurrency('₦1,234,567.89')).toBe(1234567.89);
    });

    it('parses amount with space after prefix', () => {
      expect(parseNigerianCurrency('₦ 500')).toBe(500);
    });
  });

  describe('NGN prefix', () => {
    it('parses simple amount', () => {
      expect(parseNigerianCurrency('NGN5000')).toBe(5000);
    });

    it('parses amount with space', () => {
      expect(parseNigerianCurrency('NGN 1,000.50')).toBe(1000.5);
    });

    it('parses lowercase ngn', () => {
      expect(parseNigerianCurrency('ngn 2500')).toBe(2500);
    });
  });

  describe('N prefix', () => {
    it('parses simple amount', () => {
      expect(parseNigerianCurrency('N10000')).toBe(10000);
    });

    it('parses amount with commas', () => {
      expect(parseNigerianCurrency('N1,500')).toBe(1500);
    });
  });

  describe('no prefix (plain number)', () => {
    it('parses plain integer', () => {
      expect(parseNigerianCurrency('5000')).toBe(5000);
    });

    it('parses plain decimal', () => {
      expect(parseNigerianCurrency('1234.56')).toBe(1234.56);
    });

    it('parses plain number with commas', () => {
      expect(parseNigerianCurrency('1,000,000')).toBe(1000000);
    });
  });

  describe('edge cases', () => {
    it('parses zero', () => {
      expect(parseNigerianCurrency('₦0')).toBe(0);
    });

    it('parses small decimal', () => {
      expect(parseNigerianCurrency('₦0.50')).toBe(0.5);
    });

    it('trims whitespace', () => {
      expect(parseNigerianCurrency('  ₦1000  ')).toBe(1000);
    });
  });

  describe('invalid inputs', () => {
    it('returns null for empty string', () => {
      expect(parseNigerianCurrency('')).toBeNull();
    });

    it('returns null for whitespace-only', () => {
      expect(parseNigerianCurrency('   ')).toBeNull();
    });

    it('returns null for prefix only', () => {
      expect(parseNigerianCurrency('₦')).toBeNull();
    });

    it('returns null for non-numeric text', () => {
      expect(parseNigerianCurrency('₦abc')).toBeNull();
    });

    it('returns null for negative amount', () => {
      expect(parseNigerianCurrency('₦-100')).toBeNull();
    });
  });
});

describe('extractNigerianPhone', () => {
  describe('local format (0XXXXXXXXXX)', () => {
    it('extracts a standard 080 number', () => {
      const result = extractNigerianPhone('Call me at 08012345678');
      expect(result).toHaveLength(1);
      expect(result[0].normalized).toBe('08012345678');
    });

    it('extracts 081 prefix', () => {
      const result = extractNigerianPhone('Phone: 08112345678');
      expect(result).toHaveLength(1);
      expect(result[0].normalized).toBe('08112345678');
    });

    it('extracts 070 prefix', () => {
      const result = extractNigerianPhone('Reach me on 07012345678');
      expect(result).toHaveLength(1);
      expect(result[0].normalized).toBe('07012345678');
    });

    it('extracts 090 prefix', () => {
      const result = extractNigerianPhone('Contact: 09012345678');
      expect(result).toHaveLength(1);
      expect(result[0].normalized).toBe('09012345678');
    });

    it('extracts 091 prefix', () => {
      const result = extractNigerianPhone('Number: 09112345678');
      expect(result).toHaveLength(1);
      expect(result[0].normalized).toBe('09112345678');
    });
  });

  describe('international format', () => {
    it('extracts +234 format', () => {
      const result = extractNigerianPhone('Call +2348012345678');
      expect(result).toHaveLength(1);
      expect(result[0].normalized).toBe('08012345678');
    });

    it('extracts 234 format without plus', () => {
      const result = extractNigerianPhone('Phone: 2348012345678');
      expect(result).toHaveLength(1);
      expect(result[0].normalized).toBe('08012345678');
    });

    it('extracts +234 with dashes', () => {
      const result = extractNigerianPhone('Call +234-801-234-5678');
      expect(result).toHaveLength(1);
      expect(result[0].normalized).toBe('08012345678');
    });

    it('extracts +234 with spaces', () => {
      const result = extractNigerianPhone('Call +234 801 234 5678');
      expect(result).toHaveLength(1);
      expect(result[0].normalized).toBe('08012345678');
    });
  });

  describe('multiple numbers', () => {
    it('extracts multiple different numbers', () => {
      const text = 'Call 08012345678 or 09087654321 for info';
      const result = extractNigerianPhone(text);
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.normalized)).toContain('08012345678');
      expect(result.map((r) => r.normalized)).toContain('09087654321');
    });

    it('deduplicates same number in different formats', () => {
      const text = 'Call 08012345678 or +2348012345678';
      const result = extractNigerianPhone(text);
      expect(result).toHaveLength(1);
      expect(result[0].normalized).toBe('08012345678');
    });
  });

  describe('no matches', () => {
    it('returns empty array for text without phone numbers', () => {
      expect(extractNigerianPhone('No phone numbers here')).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      expect(extractNigerianPhone('')).toEqual([]);
    });
  });

  describe('preserves original text', () => {
    it('includes the original matched text', () => {
      const result = extractNigerianPhone('Call +234-801-234-5678 now');
      expect(result).toHaveLength(1);
      expect(result[0].original).toBe('+234-801-234-5678');
    });
  });
});
