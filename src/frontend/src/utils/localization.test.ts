import { describe, expect, it } from 'vitest';

import {
  formatNaira,
  formatNairaCompact,
  formatWATDate,
  formatWATDateTime,
  formatWATTime,
  koboToNaira,
  nairaToKobo,
} from './localization';

describe('WAT Date Formatting', () => {
  it('formats a Date object as DD/MM/YYYY in WAT', () => {
    // 2024-12-25 at noon UTC → 13:00 WAT, same day
    const date = new Date('2024-12-25T12:00:00Z');
    expect(formatWATDate(date)).toBe('25/12/2024');
  });

  it('formats an ISO string as DD/MM/YYYY in WAT', () => {
    expect(formatWATDate('2024-01-15T10:30:00Z')).toBe('15/01/2024');
  });

  it('formats a Unix ms timestamp as DD/MM/YYYY in WAT', () => {
    // 2024-06-01T00:00:00Z
    const ts = new Date('2024-06-01T00:00:00Z').getTime();
    expect(formatWATDate(ts)).toBe('01/06/2024');
  });

  it('handles date rollover at midnight UTC → WAT (UTC+1)', () => {
    // 2024-03-31T23:30:00Z → 2024-04-01 00:30 WAT
    expect(formatWATDate('2024-03-31T23:30:00Z')).toBe('01/04/2024');
  });

  it('formats epoch zero correctly in WAT', () => {
    // 1970-01-01T00:00:00Z → 01:00 WAT on 01/01/1970
    expect(formatWATDate(0)).toBe('01/01/1970');
  });
});

describe('WAT Time Formatting', () => {
  it('formats time as HH:MM in WAT', () => {
    // 12:00 UTC → 13:00 WAT
    expect(formatWATTime('2024-06-15T12:00:00Z')).toBe('13:00');
  });

  it('handles midnight UTC → 01:00 WAT', () => {
    expect(formatWATTime('2024-06-15T00:00:00Z')).toBe('01:00');
  });

  it('handles 23:00 UTC → 00:00 WAT next day', () => {
    expect(formatWATTime('2024-06-15T23:00:00Z')).toBe('00:00');
  });

  it('formats time from a Date object', () => {
    const date = new Date('2024-06-15T14:30:00Z');
    expect(formatWATTime(date)).toBe('15:30');
  });
});

describe('WAT DateTime Formatting', () => {
  it('formats full date+time as DD/MM/YYYY, HH:MM in WAT', () => {
    expect(formatWATDateTime('2024-12-25T12:00:00Z')).toBe('25/12/2024, 13:00');
  });

  it('handles date rollover in combined format', () => {
    expect(formatWATDateTime('2024-03-31T23:30:00Z')).toBe('01/04/2024, 00:30');
  });

  it('formats from Unix timestamp', () => {
    const ts = new Date('2024-01-01T00:00:00Z').getTime();
    expect(formatWATDateTime(ts)).toBe('01/01/2024, 01:00');
  });
});

describe('koboToNaira', () => {
  it('converts Kobo to Naira', () => {
    expect(koboToNaira(150000)).toBe(1500);
  });

  it('converts zero', () => {
    expect(koboToNaira(0)).toBe(0);
  });

  it('converts fractional Kobo amounts', () => {
    expect(koboToNaira(150)).toBe(1.5);
  });

  it('converts single Kobo', () => {
    expect(koboToNaira(1)).toBe(0.01);
  });

  it('handles negative amounts', () => {
    expect(koboToNaira(-5000)).toBe(-50);
  });
});

describe('nairaToKobo', () => {
  it('converts Naira to Kobo', () => {
    expect(nairaToKobo(1500)).toBe(150000);
  });

  it('converts zero', () => {
    expect(nairaToKobo(0)).toBe(0);
  });

  it('rounds fractional Kobo to nearest integer', () => {
    // 1.555 Naira = 155.5 Kobo → rounds to 156
    expect(nairaToKobo(1.555)).toBe(156);
  });

  it('handles negative amounts', () => {
    expect(nairaToKobo(-50)).toBe(-5000);
  });

  it('roundtrips with koboToNaira for whole Kobo', () => {
    expect(nairaToKobo(koboToNaira(12345))).toBe(12345);
  });
});

describe('formatNaira', () => {
  it('formats Kobo as Naira with ₦ symbol and 2 decimals', () => {
    expect(formatNaira(150000)).toBe('₦1,500.00');
  });

  it('formats zero Kobo', () => {
    expect(formatNaira(0)).toBe('₦0.00');
  });

  it('formats fractional Kobo amounts', () => {
    expect(formatNaira(150050)).toBe('₦1,500.50');
  });

  it('formats single Kobo', () => {
    expect(formatNaira(1)).toBe('₦0.01');
  });

  it('formats large amounts with thousands separators', () => {
    // 10,000,000 Kobo = ₦100,000.00
    expect(formatNaira(10000000)).toBe('₦100,000.00');
  });

  it('formats negative amounts', () => {
    expect(formatNaira(-150000)).toBe('-₦1,500.00');
  });
});

describe('formatNairaCompact', () => {
  it('omits decimals for whole Naira amounts', () => {
    expect(formatNairaCompact(150000)).toBe('₦1,500');
  });

  it('shows decimals for fractional Kobo amounts', () => {
    expect(formatNairaCompact(150050)).toBe('₦1,500.5');
  });

  it('formats zero without decimals', () => {
    expect(formatNairaCompact(0)).toBe('₦0');
  });

  it('formats single Kobo with decimals', () => {
    expect(formatNairaCompact(1)).toBe('₦0.01');
  });

  it('formats large whole amounts without decimals', () => {
    expect(formatNairaCompact(10000000)).toBe('₦100,000');
  });

  it('formats negative whole amounts without decimals', () => {
    expect(formatNairaCompact(-150000)).toBe('-₦1,500');
  });
});
