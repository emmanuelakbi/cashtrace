import { describe, expect, it } from 'vitest';

import {
  createAmountDisplay,
  formatAsNaira,
  formatAsNairaWithSign,
  formatPercentage,
  formatPercentageChange,
  koboToNaira,
} from './formatterService.js';

describe('koboToNaira', () => {
  it('converts positive kobo to naira', () => {
    expect(koboToNaira(123456)).toBe(1234.56);
  });

  it('converts zero', () => {
    expect(koboToNaira(0)).toBe(0);
  });

  it('converts negative kobo', () => {
    expect(koboToNaira(-50000)).toBe(-500);
  });

  it('converts single kobo', () => {
    expect(koboToNaira(1)).toBe(0.01);
  });
});

describe('formatAsNaira', () => {
  it('formats with ₦ symbol prefix', () => {
    expect(formatAsNaira(100)).toBe('₦1.00');
  });

  it('formats with thousands separators', () => {
    expect(formatAsNaira(123456789)).toBe('₦1,234,567.89');
  });

  it('formats with exactly 2 decimal places', () => {
    expect(formatAsNaira(500)).toBe('₦5.00');
  });

  it('formats zero', () => {
    expect(formatAsNaira(0)).toBe('₦0.00');
  });

  it('formats negative amounts with minus prefix before ₦', () => {
    expect(formatAsNaira(-123456)).toBe('-₦1,234.56');
  });

  it('formats large amounts', () => {
    expect(formatAsNaira(100000000000)).toBe('₦1,000,000,000.00');
  });
});

describe('formatAsNairaWithSign', () => {
  it('prefixes positive amounts with +', () => {
    expect(formatAsNairaWithSign(50000)).toBe('+₦500.00');
  });

  it('prefixes negative amounts with -', () => {
    expect(formatAsNairaWithSign(-50000)).toBe('-₦500.00');
  });

  it('formats zero without sign', () => {
    expect(formatAsNairaWithSign(0)).toBe('₦0.00');
  });
});

describe('formatPercentage', () => {
  it('formats with 1 decimal place and % suffix', () => {
    expect(formatPercentage(15.5)).toBe('15.5%');
  });

  it('formats zero', () => {
    expect(formatPercentage(0)).toBe('0.0%');
  });

  it('formats negative values', () => {
    expect(formatPercentage(-8.23)).toBe('-8.2%');
  });

  it('rounds to 1 decimal place', () => {
    expect(formatPercentage(33.3333)).toBe('33.3%');
  });
});

describe('formatPercentageChange', () => {
  it('prefixes positive changes with +', () => {
    expect(formatPercentageChange(15.5)).toBe('+15.5%');
  });

  it('formats negative changes with -', () => {
    expect(formatPercentageChange(-8.2)).toBe('-8.2%');
  });

  it('formats zero without sign', () => {
    expect(formatPercentageChange(0)).toBe('0.0%');
  });
});

describe('createAmountDisplay', () => {
  it('creates AmountDisplay with all fields', () => {
    const display = createAmountDisplay(123456);
    expect(display).toEqual({
      kobo: 123456,
      naira: 1234.56,
      formatted: '₦1,234.56',
    });
  });

  it('handles zero', () => {
    const display = createAmountDisplay(0);
    expect(display).toEqual({
      kobo: 0,
      naira: 0,
      formatted: '₦0.00',
    });
  });

  it('handles negative amounts', () => {
    const display = createAmountDisplay(-50000);
    expect(display).toEqual({
      kobo: -50000,
      naira: -500,
      formatted: '-₦500.00',
    });
  });
});
