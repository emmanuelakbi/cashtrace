// Insights Engine - Analyzers
// Barrel file for insight analyzer exports

export const ANALYZER_CATEGORIES = [
  'tax',
  'compliance',
  'cashflow',
  'spending',
  'revenue',
] as const;

export {
  TaxAnalyzer,
  VAT_RATE,
  QUARTERLY_VAT_THRESHOLD_KOBO,
  ANNUAL_VAT_REGISTRATION_THRESHOLD_KOBO,
  VAT_REGISTRATION_WARNING_RATIO,
  calculateVatLiability,
  extrapolateAnnualRevenue,
} from './taxAnalyzer.js';

export {
  getUpcomingFirsDeadlines,
  getDeadlinesNeedingReminder,
  getNextMonthlyVatDeadline,
  getNextCompanyTaxDeadline,
  getNextIndividualTaxDeadline,
  getNextWithholdingTaxDeadline,
  daysUntilDeadline,
  REMINDER_DAYS_BEFORE,
  MONTHLY_FILING_DAY,
  COMPANY_TAX_RETURN_MONTH,
  COMPANY_TAX_RETURN_DAY,
  INDIVIDUAL_TAX_RETURN_MONTH,
  INDIVIDUAL_TAX_RETURN_DAY,
} from './firsDeadlines.js';

export type { FirsDeadline, FirsDeadlineType } from './firsDeadlines.js';

export {
  CashflowAnalyzer,
  PROJECTION_HORIZONS,
  MIN_TRANSACTIONS_FOR_ANALYSIS,
  SEASONAL_MULTIPLIERS,
  getSeasonalMultiplier,
  averageSeasonalMultiplier,
  detectRecurringPatterns,
  projectCashflow,
} from './cashflowAnalyzer.js';

export type { CashflowProjection, RecurringPattern } from './cashflowAnalyzer.js';

export {
  SpendingAnalyzer,
  PERSONAL_SPENDING_CATEGORIES,
  PERSONAL_SPENDING_THRESHOLD,
  BUSINESS_ENTERTAINMENT_KEYWORDS,
  isBusinessEntertainment,
  isPersonalSpending,
  calculatePersonalSpendingPercentage,
} from './spendingAnalyzer.js';

export type { PersonalSpendingCategory } from './spendingAnalyzer.js';

export {
  CostOptimizer,
  ABOVE_AVERAGE_MULTIPLIER,
  DUPLICATE_AMOUNT_TOLERANCE,
  MIN_RECURRING_COUNT,
  groupSpendingByCategory,
  calculateMeanCategorySpend,
  findAboveAverageCategories,
  findDuplicateSubscriptions,
} from './costOptimizer.js';

export type { DuplicateSubscription } from './costOptimizer.js';

export {
  ComplianceAnalyzer,
  CAC_REMINDER_DAYS_BEFORE,
  NDPR_REMINDER_DAYS_BEFORE,
  CAC_ANNUAL_RETURN_DAYS_AFTER_AGM,
  NDPR_BREACH_NOTIFICATION_HOURS,
  REGULATORY_URLS,
  SECTOR_COMPLIANCE_RULES,
  getNextNdprAuditDeadline,
  getNextCacAnnualReturnDeadline,
  getUpcomingComplianceDeadlines,
  calculateDeadlineUrgency,
  getSectorComplianceRules,
} from './complianceAnalyzer.js';

export type {
  ComplianceDeadline,
  ComplianceDeadlineType,
  SectorComplianceRule,
} from './complianceAnalyzer.js';

export {
  RevenueAnalyzer,
  MIN_REVENUE_TRANSACTIONS,
  TOP_PERFORMER_COUNT,
  PEAK_MONTH_MULTIPLIER,
  LOW_MONTH_MULTIPLIER,
  MIN_MONTHS_FOR_SEASONAL,
  HIGH_VALUE_CUSTOMER_COUNT,
  MIN_CUSTOMER_TRANSACTIONS,
  FREQUENCY_DECLINE_THRESHOLD,
  groupRevenueByCategory,
  groupRevenueByMonth,
  groupRevenueByCustomer,
  detectSeasonalPattern,
  detectDecliningFrequency,
} from './revenueAnalyzer.js';

export type {
  CategoryRevenue,
  MonthlyRevenue,
  CustomerRevenue,
  DecliningCustomer,
} from './revenueAnalyzer.js';
