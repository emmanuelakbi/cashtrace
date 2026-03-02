import { describe, expect, it } from 'vitest';

import {
  calculatePeriodBounds,
  calculatePreviousPeriod,
  getCurrentTimeWAT,
  getStartOfDayWAT,
  getStartOfMonthWAT,
  getStartOfQuarterWAT,
  getStartOfWeekWAT,
  getStartOfYearWAT,
  toWAT,
  WAT_OFFSET_MS,
} from './periodService.js';

describe('WAT timezone utilities', () => {
  describe('WAT_OFFSET_MS', () => {
    it('should equal 1 hour in milliseconds', () => {
      expect(WAT_OFFSET_MS).toBe(3_600_000);
    });
  });

  describe('getCurrentTimeWAT', () => {
    it('should return a Date close to now', () => {
      const before = Date.now();
      const result = getCurrentTimeWAT();
      const after = Date.now();

      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe('toWAT', () => {
    it('should add 1 hour to a UTC date', () => {
      const utc = new Date('2024-06-15T12:00:00.000Z');
      const wat = toWAT(utc);

      expect(wat.getTime()).toBe(utc.getTime() + WAT_OFFSET_MS);
      expect(wat.getUTCHours()).toBe(13); // 12 UTC → 13 WAT
    });

    it('should roll over to the next day when UTC hour is 23', () => {
      const utc = new Date('2024-06-15T23:30:00.000Z');
      const wat = toWAT(utc);

      expect(wat.getUTCDate()).toBe(16);
      expect(wat.getUTCHours()).toBe(0);
      expect(wat.getUTCMinutes()).toBe(30);
    });

    it('should handle midnight UTC', () => {
      const utc = new Date('2024-01-01T00:00:00.000Z');
      const wat = toWAT(utc);

      expect(wat.getUTCHours()).toBe(1);
      expect(wat.getUTCDate()).toBe(1);
    });

    it('should preserve milliseconds', () => {
      const utc = new Date('2024-06-15T10:30:45.123Z');
      const wat = toWAT(utc);

      expect(wat.getUTCMilliseconds()).toBe(123);
      expect(wat.getUTCMinutes()).toBe(30);
      expect(wat.getUTCSeconds()).toBe(45);
    });
  });

  describe('getStartOfDayWAT', () => {
    it('should return 23:00 UTC for a midday WAT time', () => {
      // 2024-06-15T12:00:00Z → WAT is 13:00 on June 15
      // Midnight WAT June 15 = 2024-06-14T23:00:00Z
      const date = new Date('2024-06-15T12:00:00.000Z');
      const result = getStartOfDayWAT(date);

      expect(result.toISOString()).toBe('2024-06-14T23:00:00.000Z');
    });

    it('should handle times just after midnight WAT (early UTC hours)', () => {
      // 2024-06-15T00:30:00Z → WAT is 01:30 on June 15
      // Midnight WAT June 15 = 2024-06-14T23:00:00Z
      const date = new Date('2024-06-15T00:30:00.000Z');
      const result = getStartOfDayWAT(date);

      expect(result.toISOString()).toBe('2024-06-14T23:00:00.000Z');
    });

    it('should handle times just before midnight WAT (22:59 UTC)', () => {
      // 2024-06-14T22:59:00Z → WAT is 23:59 on June 14
      // Midnight WAT June 14 = 2024-06-13T23:00:00Z
      const date = new Date('2024-06-14T22:59:00.000Z');
      const result = getStartOfDayWAT(date);

      expect(result.toISOString()).toBe('2024-06-13T23:00:00.000Z');
    });

    it('should handle exactly midnight WAT (23:00 UTC)', () => {
      // 2024-06-14T23:00:00Z → WAT is 00:00 on June 15
      // Midnight WAT June 15 = 2024-06-14T23:00:00Z (same instant)
      const date = new Date('2024-06-14T23:00:00.000Z');
      const result = getStartOfDayWAT(date);

      expect(result.toISOString()).toBe('2024-06-14T23:00:00.000Z');
    });

    it('should handle year boundary', () => {
      // 2024-01-01T00:00:00Z → WAT is 01:00 on Jan 1
      // Midnight WAT Jan 1 = 2023-12-31T23:00:00Z
      const date = new Date('2024-01-01T00:00:00.000Z');
      const result = getStartOfDayWAT(date);

      expect(result.toISOString()).toBe('2023-12-31T23:00:00.000Z');
    });

    it('should handle month boundary', () => {
      // 2024-03-01T00:00:00Z → WAT is 01:00 on March 1
      // Midnight WAT March 1 = 2024-02-29T23:00:00Z (2024 is a leap year)
      const date = new Date('2024-03-01T00:00:00.000Z');
      const result = getStartOfDayWAT(date);

      expect(result.toISOString()).toBe('2024-02-29T23:00:00.000Z');
    });

    it('should always return a time with zero minutes, seconds, and milliseconds in WAT', () => {
      const date = new Date('2024-06-15T15:45:30.999Z');
      const result = getStartOfDayWAT(date);
      const resultWAT = toWAT(result);

      expect(resultWAT.getUTCHours()).toBe(0);
      expect(resultWAT.getUTCMinutes()).toBe(0);
      expect(resultWAT.getUTCSeconds()).toBe(0);
      expect(resultWAT.getUTCMilliseconds()).toBe(0);
    });
  });
});

describe('Period boundary calculations', () => {
  describe('getStartOfWeekWAT', () => {
    it('should return Monday for a Wednesday input', () => {
      // 2024-06-12 is a Wednesday in WAT
      // Monday June 10 midnight WAT = 2024-06-09T23:00:00Z
      const wednesday = new Date('2024-06-12T10:00:00.000Z');
      const result = getStartOfWeekWAT(wednesday);

      expect(result.toISOString()).toBe('2024-06-09T23:00:00.000Z');
    });

    it('should return previous Monday for a Sunday input', () => {
      // 2024-06-16 is a Sunday in WAT
      // Monday June 10 midnight WAT = 2024-06-09T23:00:00Z
      const sunday = new Date('2024-06-16T10:00:00.000Z');
      const result = getStartOfWeekWAT(sunday);

      expect(result.toISOString()).toBe('2024-06-09T23:00:00.000Z');
    });

    it('should return same Monday when input is Monday', () => {
      // 2024-06-10 is a Monday in WAT
      // Monday June 10 midnight WAT = 2024-06-09T23:00:00Z
      const monday = new Date('2024-06-10T14:00:00.000Z');
      const result = getStartOfWeekWAT(monday);

      expect(result.toISOString()).toBe('2024-06-09T23:00:00.000Z');
    });

    it('should handle week crossing month boundary', () => {
      // 2024-07-03 is a Wednesday in WAT → Monday is July 1
      // Monday July 1 midnight WAT = 2024-06-30T23:00:00Z
      const date = new Date('2024-07-03T12:00:00.000Z');
      const result = getStartOfWeekWAT(date);

      expect(result.toISOString()).toBe('2024-06-30T23:00:00.000Z');
    });

    it('should return midnight WAT (zero hours, minutes, seconds in WAT)', () => {
      const date = new Date('2024-06-13T15:45:30.999Z');
      const result = getStartOfWeekWAT(date);
      const resultWAT = toWAT(result);

      expect(resultWAT.getUTCHours()).toBe(0);
      expect(resultWAT.getUTCMinutes()).toBe(0);
      expect(resultWAT.getUTCSeconds()).toBe(0);
      expect(resultWAT.getUTCMilliseconds()).toBe(0);
    });
  });

  describe('getStartOfMonthWAT', () => {
    it('should return 1st of month for a mid-month date', () => {
      // 2024-06-15 in WAT → 1st June midnight WAT = 2024-05-31T23:00:00Z
      const date = new Date('2024-06-15T12:00:00.000Z');
      const result = getStartOfMonthWAT(date);

      expect(result.toISOString()).toBe('2024-05-31T23:00:00.000Z');
    });

    it('should return same day when input is 1st of month', () => {
      // 2024-06-01 in WAT → 1st June midnight WAT = 2024-05-31T23:00:00Z
      const date = new Date('2024-06-01T10:00:00.000Z');
      const result = getStartOfMonthWAT(date);

      expect(result.toISOString()).toBe('2024-05-31T23:00:00.000Z');
    });

    it('should handle year boundary (January 1st)', () => {
      // 2024-01-15 in WAT → 1st Jan midnight WAT = 2023-12-31T23:00:00Z
      const date = new Date('2024-01-15T12:00:00.000Z');
      const result = getStartOfMonthWAT(date);

      expect(result.toISOString()).toBe('2023-12-31T23:00:00.000Z');
    });

    it('should handle leap year February', () => {
      // 2024-02-29 in WAT → 1st Feb midnight WAT = 2024-01-31T23:00:00Z
      const date = new Date('2024-02-29T12:00:00.000Z');
      const result = getStartOfMonthWAT(date);

      expect(result.toISOString()).toBe('2024-01-31T23:00:00.000Z');
    });
  });

  describe('getStartOfQuarterWAT', () => {
    it('should return Jan 1 for a February date (Q1)', () => {
      // Feb 15 2024 in WAT → Q1 starts Jan 1 midnight WAT = 2023-12-31T23:00:00Z
      const date = new Date('2024-02-15T12:00:00.000Z');
      const result = getStartOfQuarterWAT(date);

      expect(result.toISOString()).toBe('2023-12-31T23:00:00.000Z');
    });

    it('should return Apr 1 for a May date (Q2)', () => {
      // May 20 2024 in WAT → Q2 starts Apr 1 midnight WAT = 2024-03-31T23:00:00Z
      const date = new Date('2024-05-20T12:00:00.000Z');
      const result = getStartOfQuarterWAT(date);

      expect(result.toISOString()).toBe('2024-03-31T23:00:00.000Z');
    });

    it('should return Jul 1 for an August date (Q3)', () => {
      // Aug 10 2024 in WAT → Q3 starts Jul 1 midnight WAT = 2024-06-30T23:00:00Z
      const date = new Date('2024-08-10T12:00:00.000Z');
      const result = getStartOfQuarterWAT(date);

      expect(result.toISOString()).toBe('2024-06-30T23:00:00.000Z');
    });

    it('should return Oct 1 for a November date (Q4)', () => {
      // Nov 25 2024 in WAT → Q4 starts Oct 1 midnight WAT = 2024-09-30T23:00:00Z
      const date = new Date('2024-11-25T12:00:00.000Z');
      const result = getStartOfQuarterWAT(date);

      expect(result.toISOString()).toBe('2024-09-30T23:00:00.000Z');
    });

    it('should return start of quarter when input is first day of quarter', () => {
      // Jul 1 2024 in WAT → Q3 starts Jul 1 midnight WAT = 2024-06-30T23:00:00Z
      const date = new Date('2024-07-01T10:00:00.000Z');
      const result = getStartOfQuarterWAT(date);

      expect(result.toISOString()).toBe('2024-06-30T23:00:00.000Z');
    });
  });

  describe('getStartOfYearWAT', () => {
    it('should return Jan 1 for any date in the year', () => {
      // Aug 15 2024 in WAT → Jan 1 midnight WAT = 2023-12-31T23:00:00Z
      const date = new Date('2024-08-15T12:00:00.000Z');
      const result = getStartOfYearWAT(date);

      expect(result.toISOString()).toBe('2023-12-31T23:00:00.000Z');
    });

    it('should return Jan 1 of same year for a January date', () => {
      // Jan 15 2024 in WAT → Jan 1 midnight WAT = 2023-12-31T23:00:00Z
      const date = new Date('2024-01-15T12:00:00.000Z');
      const result = getStartOfYearWAT(date);

      expect(result.toISOString()).toBe('2023-12-31T23:00:00.000Z');
    });

    it('should return Jan 1 for December 31 date', () => {
      // Dec 31 2024 in WAT → Jan 1 midnight WAT = 2023-12-31T23:00:00Z
      const date = new Date('2024-12-31T12:00:00.000Z');
      const result = getStartOfYearWAT(date);

      expect(result.toISOString()).toBe('2023-12-31T23:00:00.000Z');
    });

    it('should handle different years', () => {
      // Mar 5 2023 in WAT → Jan 1 midnight WAT = 2022-12-31T23:00:00Z
      const date = new Date('2023-03-05T12:00:00.000Z');
      const result = getStartOfYearWAT(date);

      expect(result.toISOString()).toBe('2022-12-31T23:00:00.000Z');
    });
  });
});

describe('calculatePeriodBounds', () => {
  it('should default to this_month when no period specified', () => {
    const result = calculatePeriodBounds();
    expect(result.periodType).toBe('this_month');
  });

  it('should return today bounds', () => {
    const result = calculatePeriodBounds('today');
    expect(result.periodType).toBe('today');
    expect(result.startDate.getTime()).toBeLessThanOrEqual(result.endDate.getTime());
    expect(result.daysInPeriod).toBeGreaterThanOrEqual(1);
  });

  it('should return this_week bounds', () => {
    const result = calculatePeriodBounds('this_week');
    expect(result.periodType).toBe('this_week');
    expect(result.daysInPeriod).toBeGreaterThanOrEqual(1);
    expect(result.daysInPeriod).toBeLessThanOrEqual(7);
  });

  it('should return this_month bounds', () => {
    const result = calculatePeriodBounds('this_month');
    expect(result.periodType).toBe('this_month');
    expect(result.daysInPeriod).toBeGreaterThanOrEqual(1);
    expect(result.daysInPeriod).toBeLessThanOrEqual(31);
  });

  it('should return this_quarter bounds', () => {
    const result = calculatePeriodBounds('this_quarter');
    expect(result.periodType).toBe('this_quarter');
    expect(result.daysInPeriod).toBeGreaterThanOrEqual(1);
    expect(result.daysInPeriod).toBeLessThanOrEqual(92);
  });

  it('should return this_year bounds', () => {
    const result = calculatePeriodBounds('this_year');
    expect(result.periodType).toBe('this_year');
    expect(result.daysInPeriod).toBeGreaterThanOrEqual(1);
    expect(result.daysInPeriod).toBeLessThanOrEqual(366);
  });

  it('should handle custom period with valid dates', () => {
    const start = new Date('2024-01-01T00:00:00.000Z');
    const end = new Date('2024-01-31T23:59:59.000Z');
    const result = calculatePeriodBounds('custom', start, end);

    expect(result.periodType).toBe('custom');
    expect(result.startDate).toBe(start);
    expect(result.endDate).toBe(end);
    expect(result.daysInPeriod).toBe(31);
  });

  it('should throw when custom period is missing start date', () => {
    const end = new Date('2024-01-31T00:00:00.000Z');
    expect(() => calculatePeriodBounds('custom', undefined, end)).toThrow(
      'Custom period requires both startDate and endDate',
    );
  });

  it('should throw when custom period is missing end date', () => {
    const start = new Date('2024-01-01T00:00:00.000Z');
    expect(() => calculatePeriodBounds('custom', start, undefined)).toThrow(
      'Custom period requires both startDate and endDate',
    );
  });

  it('should throw when start date is after end date', () => {
    const start = new Date('2024-02-01T00:00:00.000Z');
    const end = new Date('2024-01-01T00:00:00.000Z');
    expect(() => calculatePeriodBounds('custom', start, end)).toThrow(
      'startDate must be before or equal to endDate',
    );
  });

  it('should return daysInPeriod of at least 1', () => {
    const result = calculatePeriodBounds('today');
    expect(result.daysInPeriod).toBeGreaterThanOrEqual(1);
  });

  it('should handle same-day custom range', () => {
    const date = new Date('2024-06-15T12:00:00.000Z');
    const result = calculatePeriodBounds('custom', date, date);

    expect(result.daysInPeriod).toBe(1);
  });
});

describe('calculatePreviousPeriod', () => {
  it('should return a previous period that ends where the current period starts', () => {
    const bounds = calculatePeriodBounds(
      'custom',
      new Date('2024-06-10T00:00:00.000Z'),
      new Date('2024-06-20T00:00:00.000Z'),
    );
    const previous = calculatePreviousPeriod(bounds);

    expect(previous.endDate.getTime()).toBe(bounds.startDate.getTime());
  });

  it('should return a previous period with the same duration as the current period', () => {
    const bounds = calculatePeriodBounds(
      'custom',
      new Date('2024-06-10T00:00:00.000Z'),
      new Date('2024-06-20T00:00:00.000Z'),
    );
    const previous = calculatePreviousPeriod(bounds);

    const currentDuration = bounds.endDate.getTime() - bounds.startDate.getTime();
    const previousDuration = previous.endDate.getTime() - previous.startDate.getTime();

    expect(previousDuration).toBe(currentDuration);
  });

  it('should work for custom ranges', () => {
    const start = new Date('2024-03-01T00:00:00.000Z');
    const end = new Date('2024-03-15T00:00:00.000Z');
    const bounds = calculatePeriodBounds('custom', start, end);
    const previous = calculatePreviousPeriod(bounds);

    // Current is 14 days (Mar 1 → Mar 15), so previous is 14 days ending at Mar 1
    // Previous: Feb 16 → Mar 1
    expect(previous.endDate.toISOString()).toBe('2024-03-01T00:00:00.000Z');
    expect(previous.startDate.toISOString()).toBe('2024-02-16T00:00:00.000Z');
    expect(previous.periodType).toBe('custom');
  });

  it('should have daysInPeriod matching the current period', () => {
    const bounds = calculatePeriodBounds(
      'custom',
      new Date('2024-01-01T00:00:00.000Z'),
      new Date('2024-01-08T00:00:00.000Z'),
    );
    const previous = calculatePreviousPeriod(bounds);

    expect(previous.daysInPeriod).toBe(bounds.daysInPeriod);
  });

  it('should preserve the periodType from the input bounds', () => {
    const bounds = calculatePeriodBounds(
      'custom',
      new Date('2024-06-01T00:00:00.000Z'),
      new Date('2024-06-30T00:00:00.000Z'),
    );
    const previous = calculatePreviousPeriod(bounds);

    expect(previous.periodType).toBe(bounds.periodType);
  });

  it('should return daysInPeriod of at least 1 for zero-duration bounds', () => {
    const sameMoment = new Date('2024-06-15T12:00:00.000Z');
    const bounds: import('../types/index.js').PeriodBounds = {
      startDate: sameMoment,
      endDate: sameMoment,
      periodType: 'today',
      daysInPeriod: 1,
    };
    const previous = calculatePreviousPeriod(bounds);

    expect(previous.daysInPeriod).toBeGreaterThanOrEqual(1);
    // Zero duration means previous start === previous end === bounds.startDate
    expect(previous.startDate.getTime()).toBe(previous.endDate.getTime());
  });
});
