/**
 * FIRS (Federal Inland Revenue Service) deadline tracking for Nigerian tax compliance.
 *
 * Tracks key FIRS filing deadlines in WAT timezone and generates reminder insights
 * 30 days before each deadline.
 *
 * Key deadlines:
 * - Monthly VAT returns: 21st of the following month
 * - Annual company tax returns: June 30th
 * - Annual individual tax returns: March 31st
 * - Withholding tax remittance: 21st of the following month
 *
 * **Validates: Requirements 1.5, 1.7**
 *
 * @module insights/analyzers/firsDeadlines
 */

import { toWAT, createWATDate, formatDateWAT, formatShortDateWAT } from '../../utils/timezone.js';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Number of days before a deadline to generate a reminder. */
export const REMINDER_DAYS_BEFORE = 30;

/** Day of month for monthly VAT and WHT returns. */
export const MONTHLY_FILING_DAY = 21;

/** Month (1-indexed) for annual company tax return deadline. */
export const COMPANY_TAX_RETURN_MONTH = 6;

/** Day for annual company tax return deadline (June 30). */
export const COMPANY_TAX_RETURN_DAY = 30;

/** Month (1-indexed) for annual individual tax return deadline. */
export const INDIVIDUAL_TAX_RETURN_MONTH = 3;

/** Day for annual individual tax return deadline (March 31). */
export const INDIVIDUAL_TAX_RETURN_DAY = 31;

// ─── Types ─────────────────────────────────────────────────────────────────

export type FirsDeadlineType =
  | 'monthly_vat_return'
  | 'annual_company_tax_return'
  | 'annual_individual_tax_return'
  | 'withholding_tax_remittance';

export interface FirsDeadline {
  type: FirsDeadlineType;
  label: string;
  deadlineDate: Date;
  deadlineDateWAT: string;
  deadlineShortDate: string;
  daysUntilDeadline: number;
  isWithinReminderWindow: boolean;
}

// ─── Deadline Calculation ──────────────────────────────────────────────────

/**
 * Get the next monthly VAT return deadline from a reference date.
 *
 * VAT returns are due on the 21st of the following month.
 * If today is past the 21st of this month, the next deadline is the 21st of next month.
 */
export function getNextMonthlyVatDeadline(referenceDate: Date): Date {
  const wat = toWAT(referenceDate);
  const year = wat.getUTCFullYear();
  const month = wat.getUTCMonth() + 1; // 1-indexed
  const day = wat.getUTCDate();

  // The VAT return for the previous month is due on the 21st of the current month.
  // If we haven't passed the 21st yet, the next deadline is this month's 21st.
  // If we have passed it, the next deadline is next month's 21st.
  if (day < MONTHLY_FILING_DAY) {
    return createWATDate(year, month, MONTHLY_FILING_DAY);
  }

  // Move to next month
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return createWATDate(nextYear, nextMonth, MONTHLY_FILING_DAY);
}

/**
 * Get the next withholding tax remittance deadline from a reference date.
 *
 * WHT remittance is due on the 21st of the following month (same schedule as VAT).
 */
export function getNextWithholdingTaxDeadline(referenceDate: Date): Date {
  // Same schedule as monthly VAT
  return getNextMonthlyVatDeadline(referenceDate);
}

/**
 * Get the next annual company tax return deadline from a reference date.
 *
 * Company tax returns are due June 30th each year.
 */
export function getNextCompanyTaxDeadline(referenceDate: Date): Date {
  const wat = toWAT(referenceDate);
  const year = wat.getUTCFullYear();
  const month = wat.getUTCMonth() + 1;
  const day = wat.getUTCDate();

  // If we haven't passed June 30 this year, deadline is this year
  if (
    month < COMPANY_TAX_RETURN_MONTH ||
    (month === COMPANY_TAX_RETURN_MONTH && day <= COMPANY_TAX_RETURN_DAY)
  ) {
    return createWATDate(year, COMPANY_TAX_RETURN_MONTH, COMPANY_TAX_RETURN_DAY);
  }

  // Otherwise, next year
  return createWATDate(year + 1, COMPANY_TAX_RETURN_MONTH, COMPANY_TAX_RETURN_DAY);
}

/**
 * Get the next annual individual tax return deadline from a reference date.
 *
 * Individual tax returns are due March 31st each year.
 */
export function getNextIndividualTaxDeadline(referenceDate: Date): Date {
  const wat = toWAT(referenceDate);
  const year = wat.getUTCFullYear();
  const month = wat.getUTCMonth() + 1;
  const day = wat.getUTCDate();

  // If we haven't passed March 31 this year, deadline is this year
  if (
    month < INDIVIDUAL_TAX_RETURN_MONTH ||
    (month === INDIVIDUAL_TAX_RETURN_MONTH && day <= INDIVIDUAL_TAX_RETURN_DAY)
  ) {
    return createWATDate(year, INDIVIDUAL_TAX_RETURN_MONTH, INDIVIDUAL_TAX_RETURN_DAY);
  }

  // Otherwise, next year
  return createWATDate(year + 1, INDIVIDUAL_TAX_RETURN_MONTH, INDIVIDUAL_TAX_RETURN_DAY);
}

// ─── Days Until Calculation ────────────────────────────────────────────────

/**
 * Calculate the number of calendar days between a reference date and a deadline,
 * both evaluated in WAT timezone.
 */
export function daysUntilDeadline(referenceDate: Date, deadlineDate: Date): number {
  const refWAT = toWAT(referenceDate);
  const dlWAT = toWAT(deadlineDate);

  // Normalize to start of day in WAT (zero out time components)
  const refDay = Date.UTC(refWAT.getUTCFullYear(), refWAT.getUTCMonth(), refWAT.getUTCDate());
  const dlDay = Date.UTC(dlWAT.getUTCFullYear(), dlWAT.getUTCMonth(), dlWAT.getUTCDate());

  const diffMs = dlDay - refDay;
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Get all upcoming FIRS deadlines relative to a reference date, with reminder status.
 *
 * Returns deadlines for:
 * - Monthly VAT return (21st of following month)
 * - Annual company tax return (June 30)
 * - Annual individual tax return (March 31)
 * - Withholding tax remittance (21st of following month)
 *
 * Each deadline includes whether it falls within the 30-day reminder window.
 *
 * **Validates: Requirements 1.5, 1.7**
 */
export function getUpcomingFirsDeadlines(referenceDate: Date): FirsDeadline[] {
  const deadlines: FirsDeadline[] = [];

  const vatDate = getNextMonthlyVatDeadline(referenceDate);
  const vatDays = daysUntilDeadline(referenceDate, vatDate);
  deadlines.push({
    type: 'monthly_vat_return',
    label: 'Monthly VAT Return',
    deadlineDate: vatDate,
    deadlineDateWAT: formatDateWAT(vatDate),
    deadlineShortDate: formatShortDateWAT(vatDate),
    daysUntilDeadline: vatDays,
    isWithinReminderWindow: vatDays >= 0 && vatDays <= REMINDER_DAYS_BEFORE,
  });

  const companyDate = getNextCompanyTaxDeadline(referenceDate);
  const companyDays = daysUntilDeadline(referenceDate, companyDate);
  deadlines.push({
    type: 'annual_company_tax_return',
    label: 'Annual Company Tax Return',
    deadlineDate: companyDate,
    deadlineDateWAT: formatDateWAT(companyDate),
    deadlineShortDate: formatShortDateWAT(companyDate),
    daysUntilDeadline: companyDays,
    isWithinReminderWindow: companyDays >= 0 && companyDays <= REMINDER_DAYS_BEFORE,
  });

  const individualDate = getNextIndividualTaxDeadline(referenceDate);
  const individualDays = daysUntilDeadline(referenceDate, individualDate);
  deadlines.push({
    type: 'annual_individual_tax_return',
    label: 'Annual Individual Tax Return',
    deadlineDate: individualDate,
    deadlineDateWAT: formatDateWAT(individualDate),
    deadlineShortDate: formatShortDateWAT(individualDate),
    daysUntilDeadline: individualDays,
    isWithinReminderWindow: individualDays >= 0 && individualDays <= REMINDER_DAYS_BEFORE,
  });

  const whtDate = getNextWithholdingTaxDeadline(referenceDate);
  const whtDays = daysUntilDeadline(referenceDate, whtDate);
  deadlines.push({
    type: 'withholding_tax_remittance',
    label: 'Withholding Tax Remittance',
    deadlineDate: whtDate,
    deadlineDateWAT: formatDateWAT(whtDate),
    deadlineShortDate: formatShortDateWAT(whtDate),
    daysUntilDeadline: whtDays,
    isWithinReminderWindow: whtDays >= 0 && whtDays <= REMINDER_DAYS_BEFORE,
  });

  return deadlines;
}

/**
 * Get only the FIRS deadlines that fall within the 30-day reminder window.
 *
 * **Validates: Requirement 1.7**
 */
export function getDeadlinesNeedingReminder(referenceDate: Date): FirsDeadline[] {
  return getUpcomingFirsDeadlines(referenceDate).filter((d) => d.isWithinReminderWindow);
}
