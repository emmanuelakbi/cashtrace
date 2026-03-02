import { describe, expect, it } from 'vitest';

import {
  formatNigerianPhone,
  isValidNigerianPhone,
  NIGERIAN_PHONE_REGEX,
} from './phoneValidation';

describe('NIGERIAN_PHONE_REGEX', () => {
  it('matches local format without separators', () => {
    expect(NIGERIAN_PHONE_REGEX.test('08031234567')).toBe(true);
  });

  it('matches international format without separators', () => {
    expect(NIGERIAN_PHONE_REGEX.test('+2348031234567')).toBe(true);
  });

  it('matches with space separators', () => {
    expect(NIGERIAN_PHONE_REGEX.test('0803 123 4567')).toBe(true);
    expect(NIGERIAN_PHONE_REGEX.test('+234 803 123 4567')).toBe(true);
  });

  it('matches with hyphen separators', () => {
    expect(NIGERIAN_PHONE_REGEX.test('0803-123-4567')).toBe(true);
  });

  it('rejects invalid prefixes', () => {
    expect(NIGERIAN_PHONE_REGEX.test('06012345678')).toBe(false);
  });
});

describe('isValidNigerianPhone', () => {
  describe('valid local numbers', () => {
    it.each([
      ['08031234567', '080X (MTN)'],
      ['08131234567', '081X (MTN/Glo)'],
      ['07031234567', '070X (MTN/Glo)'],
      ['09031234567', '090X (Airtel/MTN)'],
      ['09131234567', '091X (9mobile)'],
    ])('accepts %s (%s)', (phone) => {
      expect(isValidNigerianPhone(phone)).toBe(true);
    });
  });

  describe('valid international numbers', () => {
    it.each([
      ['+2348031234567', '+234 080X'],
      ['+2348131234567', '+234 081X'],
      ['+2347031234567', '+234 070X'],
      ['+2349031234567', '+234 090X'],
      ['+2349131234567', '+234 091X'],
    ])('accepts %s (%s)', (phone) => {
      expect(isValidNigerianPhone(phone)).toBe(true);
    });
  });

  describe('numbers with separators', () => {
    it('accepts spaces', () => {
      expect(isValidNigerianPhone('0803 123 4567')).toBe(true);
    });

    it('accepts hyphens', () => {
      expect(isValidNigerianPhone('0803-123-4567')).toBe(true);
    });

    it('accepts dots', () => {
      expect(isValidNigerianPhone('0803.123.4567')).toBe(true);
    });

    it('accepts international with spaces', () => {
      expect(isValidNigerianPhone('+234 803 123 4567')).toBe(true);
    });
  });

  describe('invalid numbers', () => {
    it('rejects empty string', () => {
      expect(isValidNigerianPhone('')).toBe(false);
    });

    it('rejects non-string input', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(isValidNigerianPhone(null as any)).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(isValidNigerianPhone(undefined as any)).toBe(false);
    });

    it('rejects too short numbers', () => {
      expect(isValidNigerianPhone('080312345')).toBe(false);
    });

    it('rejects too long numbers', () => {
      expect(isValidNigerianPhone('080312345678')).toBe(false);
    });

    it('rejects invalid prefixes', () => {
      expect(isValidNigerianPhone('06012345678')).toBe(false);
      expect(isValidNigerianPhone('05012345678')).toBe(false);
    });

    it('rejects numbers without leading 0 or +234', () => {
      expect(isValidNigerianPhone('8031234567')).toBe(false);
    });

    it('rejects non-Nigerian international codes', () => {
      expect(isValidNigerianPhone('+4478031234567')).toBe(false);
      expect(isValidNigerianPhone('+18031234567')).toBe(false);
    });

    it('rejects alphabetic characters', () => {
      expect(isValidNigerianPhone('0803abc4567')).toBe(false);
    });
  });
});

describe('formatNigerianPhone', () => {
  describe('local to international conversion', () => {
    it('converts local format to +234 format', () => {
      expect(formatNigerianPhone('08031234567')).toBe('+2348031234567');
    });

    it('converts all valid prefixes', () => {
      expect(formatNigerianPhone('07031234567')).toBe('+2347031234567');
      expect(formatNigerianPhone('08131234567')).toBe('+2348131234567');
      expect(formatNigerianPhone('09031234567')).toBe('+2349031234567');
      expect(formatNigerianPhone('09131234567')).toBe('+2349131234567');
    });
  });

  describe('international passthrough', () => {
    it('keeps already-international numbers unchanged', () => {
      expect(formatNigerianPhone('+2348031234567')).toBe('+2348031234567');
    });
  });

  describe('strips formatting', () => {
    it('removes spaces from local numbers', () => {
      expect(formatNigerianPhone('0803 123 4567')).toBe('+2348031234567');
    });

    it('removes hyphens from local numbers', () => {
      expect(formatNigerianPhone('0803-123-4567')).toBe('+2348031234567');
    });

    it('removes spaces from international numbers', () => {
      expect(formatNigerianPhone('+234 803 123 4567')).toBe('+2348031234567');
    });

    it('removes dots', () => {
      expect(formatNigerianPhone('0803.123.4567')).toBe('+2348031234567');
    });
  });

  describe('error handling', () => {
    it('throws for invalid numbers', () => {
      expect(() => formatNigerianPhone('invalid')).toThrow('Invalid Nigerian phone number');
    });

    it('throws for empty string', () => {
      expect(() => formatNigerianPhone('')).toThrow('Invalid Nigerian phone number');
    });
  });
});
