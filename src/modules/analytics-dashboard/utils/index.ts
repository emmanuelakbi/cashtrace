/**
 * Barrel file for analytics-dashboard utility modules.
 *
 * @module modules/analytics-dashboard/utils
 */

export {
  koboToNaira,
  formatAsNaira,
  formatAsNairaWithSign,
  formatPercentage,
  formatPercentageChange,
  createAmountDisplay,
} from './formatterService.js';

export {
  WAT_OFFSET_MS,
  getCurrentTimeWAT,
  toWAT,
  getStartOfDayWAT,
  getStartOfWeekWAT,
  getStartOfMonthWAT,
  getStartOfQuarterWAT,
  getStartOfYearWAT,
  calculatePeriodBounds,
  calculatePreviousPeriod,
} from './periodService.js';
