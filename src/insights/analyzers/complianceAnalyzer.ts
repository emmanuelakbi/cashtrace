/**
 * Compliance Analyzer for the Insights Engine.
 *
 * Tracks Nigerian regulatory deadlines (NDPR, CAC, FIRS) and generates
 * compliance-category insights with appropriate urgency based on days
 * until deadline. Integrates with existing FIRS deadline tracking.
 *
 * Key deadlines:
 * - NDPR annual data protection audit: anniversary of registration
 * - NDPR data breach notification: 72 hours from discovery
 * - CAC annual returns: within 42 days of AGM (reminder 60 days before)
 * - FIRS deadlines: delegated to firsDeadlines module
 *
 * **Validates: Requirements 6.1, 6.2, 6.3**
 *
 * @module insights/analyzers/complianceAnalyzer
 */

import { v4 as uuidv4 } from 'uuid';

import { toWAT, createWATDate, formatShortDateWAT } from '../../utils/timezone.js';
import type {
  ActionItem,
  AnalysisContext,
  BusinessProfile,
  DataRequirement,
  InsightCategory,
  NigerianSector,
  RawInsight,
} from '../types/index.js';
import {
  getDeadlinesNeedingReminder,
  getUpcomingFirsDeadlines,
  daysUntilDeadline,
  type FirsDeadline,
} from './firsDeadlines.js';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Number of days before a CAC deadline to generate a reminder. */
export const CAC_REMINDER_DAYS_BEFORE = 60;

/** Number of days before an NDPR audit deadline to generate a reminder. */
export const NDPR_REMINDER_DAYS_BEFORE = 60;

/** CAC annual return is due within 42 days of AGM. */
export const CAC_ANNUAL_RETURN_DAYS_AFTER_AGM = 42;

/**
 * Default AGM month (1-indexed). Nigerian companies typically hold AGMs
 * within 15 months of incorporation and subsequently every 12 months.
 * We default to the anniversary month of business creation.
 */
export const DEFAULT_AGM_MONTH = 6; // June

/** NDPR data breach notification window in hours. */
export const NDPR_BREACH_NOTIFICATION_HOURS = 72;

/** Regulatory resource URLs. */
export const REGULATORY_URLS = {
  ndpc: 'https://ndpc.gov.ng',
  cac: 'https://pre.cac.gov.ng',
  firs: 'https://firs.gov.ng',
  nafdac: 'https://nafdac.gov.ng',
  mdcn: 'https://mdcn.gov.ng',
  cbn: 'https://cbn.gov.ng',
  sec: 'https://sec.gov.ng',
  dpr: 'https://nuprc.gov.ng',
  trcn: 'https://trcn.gov.ng',
  nuc: 'https://nuc.edu.ng',
  son: 'https://son.gov.ng',
  nesrea: 'https://nesrea.gov.ng',
  ntdc: 'https://ntdc.gov.ng',
} as const;

// ─── Sector Compliance Rules ───────────────────────────────────────────────

export interface SectorComplianceRule {
  sector: NigerianSector;
  regulatoryBody: string;
  requirement: string;
  description: string;
  resourceUrl: string;
}

/**
 * Sector-specific compliance rules for regulated Nigerian business sectors.
 *
 * Only sectors with additional regulatory requirements beyond the standard
 * NDPR/CAC/FIRS obligations are included.
 *
 * **Validates: Requirement 6.4**
 */
export const SECTOR_COMPLIANCE_RULES: ReadonlyMap<NigerianSector, SectorComplianceRule[]> = new Map<
  NigerianSector,
  SectorComplianceRule[]
>([
  [
    'healthcare',
    [
      {
        sector: 'healthcare',
        regulatoryBody: 'NAFDAC',
        requirement: 'Product registration and facility compliance',
        description:
          'Healthcare businesses must register products with NAFDAC and maintain ' +
          'facility compliance standards.',
        resourceUrl: REGULATORY_URLS.nafdac,
      },
      {
        sector: 'healthcare',
        regulatoryBody: 'MDCN',
        requirement: 'Medical practitioner licensing',
        description:
          'Medical practitioners must maintain valid MDCN registration and ' +
          'renew licences annually.',
        resourceUrl: REGULATORY_URLS.mdcn,
      },
    ],
  ],
  [
    'education',
    [
      {
        sector: 'education',
        regulatoryBody: 'TRCN',
        requirement: 'Teacher registration and certification',
        description:
          'Education businesses must ensure all teaching staff hold valid TRCN ' + 'certification.',
        resourceUrl: REGULATORY_URLS.trcn,
      },
      {
        sector: 'education',
        regulatoryBody: 'NUC',
        requirement: 'Institutional accreditation',
        description:
          'Higher education institutions require NUC accreditation for ' + 'programmes offered.',
        resourceUrl: REGULATORY_URLS.nuc,
      },
    ],
  ],
  [
    'manufacturing',
    [
      {
        sector: 'manufacturing',
        regulatoryBody: 'SON',
        requirement: 'Product standards certification',
        description:
          'Manufactured products must meet SON quality standards and carry the ' +
          'MANCAP mark where applicable.',
        resourceUrl: REGULATORY_URLS.son,
      },
      {
        sector: 'manufacturing',
        regulatoryBody: 'NESREA',
        requirement: 'Environmental compliance',
        description:
          'Manufacturing facilities must comply with NESREA environmental ' +
          'regulations and obtain required permits.',
        resourceUrl: REGULATORY_URLS.nesrea,
      },
    ],
  ],
  [
    'hospitality',
    [
      {
        sector: 'hospitality',
        regulatoryBody: 'NTDC',
        requirement: 'Tourism and hospitality licensing',
        description:
          'Hospitality businesses must register with NTDC and maintain ' +
          'required grading and licensing.',
        resourceUrl: REGULATORY_URLS.ntdc,
      },
      {
        sector: 'hospitality',
        regulatoryBody: 'NAFDAC',
        requirement: 'Food safety compliance',
        description:
          'Food service operations must comply with NAFDAC food safety ' +
          'regulations and hygiene standards.',
        resourceUrl: REGULATORY_URLS.nafdac,
      },
    ],
  ],
  [
    'technology',
    [
      {
        sector: 'technology',
        regulatoryBody: 'NDPC',
        requirement: 'Enhanced data protection compliance',
        description:
          'Technology businesses handling personal data must conduct regular ' +
          'Data Protection Impact Assessments (DPIA) and appoint a Data ' +
          'Protection Officer.',
        resourceUrl: REGULATORY_URLS.ndpc,
      },
    ],
  ],
]);

/**
 * Returns the sector-specific compliance rules for a given sector,
 * or an empty array if the sector has no additional requirements.
 */
export function getSectorComplianceRules(sector: NigerianSector): SectorComplianceRule[] {
  return SECTOR_COMPLIANCE_RULES.get(sector) ?? [];
}

// ─── Deadline Types ────────────────────────────────────────────────────────

export type ComplianceDeadlineType =
  | 'ndpr_annual_audit'
  | 'ndpr_breach_notification'
  | 'cac_annual_return';

export interface ComplianceDeadline {
  type: ComplianceDeadlineType;
  label: string;
  deadlineDate: Date;
  deadlineShortDate: string;
  daysUntilDeadline: number;
  isWithinReminderWindow: boolean;
  regulatoryBody: 'NDPC' | 'CAC';
  resourceUrl: string;
}

// ─── Deadline Calculation ──────────────────────────────────────────────────

/**
 * Calculate the next NDPR annual data protection audit deadline.
 *
 * The audit is due on the anniversary of the business registration date each year.
 * If the anniversary has passed this year, the next deadline is next year.
 */
export function getNextNdprAuditDeadline(referenceDate: Date, businessCreatedAt: Date): Date {
  const refWAT = toWAT(referenceDate);
  const createdWAT = toWAT(businessCreatedAt);

  const refYear = refWAT.getUTCFullYear();
  const createdMonth = createdWAT.getUTCMonth() + 1; // 1-indexed
  const createdDay = createdWAT.getUTCDate();

  // Try this year's anniversary first
  const thisYearDeadline = createWATDate(refYear, createdMonth, createdDay);
  const daysUntil = daysUntilDeadline(referenceDate, thisYearDeadline);

  if (daysUntil > 0) {
    return thisYearDeadline;
  }

  // Anniversary has passed, use next year
  return createWATDate(refYear + 1, createdMonth, createdDay);
}

/**
 * Calculate the next CAC annual return deadline.
 *
 * CAC annual returns are due within 42 days of the AGM.
 * We estimate the AGM date as the anniversary month of business creation.
 * The deadline is AGM date + 42 days.
 */
export function getNextCacAnnualReturnDeadline(referenceDate: Date, businessCreatedAt: Date): Date {
  const refWAT = toWAT(referenceDate);
  const createdWAT = toWAT(businessCreatedAt);

  const refYear = refWAT.getUTCFullYear();
  const agmMonth = createdWAT.getUTCMonth() + 1; // 1-indexed
  const agmDay = createdWAT.getUTCDate();

  // AGM this year + 42 days
  const thisYearAgm = createWATDate(refYear, agmMonth, agmDay);
  const thisYearDeadline = new Date(
    thisYearAgm.getTime() + CAC_ANNUAL_RETURN_DAYS_AFTER_AGM * 24 * 60 * 60 * 1000,
  );

  const daysUntil = daysUntilDeadline(referenceDate, thisYearDeadline);

  if (daysUntil > 0) {
    return thisYearDeadline;
  }

  // Deadline has passed, use next year
  const nextYearAgm = createWATDate(refYear + 1, agmMonth, agmDay);
  return new Date(nextYearAgm.getTime() + CAC_ANNUAL_RETURN_DAYS_AFTER_AGM * 24 * 60 * 60 * 1000);
}

// ─── Compliance Deadline Helpers ───────────────────────────────────────────

/**
 * Get all upcoming compliance deadlines (NDPR + CAC) for a business.
 */
export function getUpcomingComplianceDeadlines(
  referenceDate: Date,
  businessProfile: BusinessProfile,
): ComplianceDeadline[] {
  const deadlines: ComplianceDeadline[] = [];

  // NDPR annual audit — applies to all businesses
  const ndprDate = getNextNdprAuditDeadline(referenceDate, businessProfile.createdAt);
  const ndprDays = daysUntilDeadline(referenceDate, ndprDate);
  deadlines.push({
    type: 'ndpr_annual_audit',
    label: 'NDPR Annual Data Protection Audit',
    deadlineDate: ndprDate,
    deadlineShortDate: formatShortDateWAT(ndprDate),
    daysUntilDeadline: ndprDays,
    isWithinReminderWindow: ndprDays >= 0 && ndprDays <= NDPR_REMINDER_DAYS_BEFORE,
    regulatoryBody: 'NDPC',
    resourceUrl: REGULATORY_URLS.ndpc,
  });

  // CAC annual return — only for CAC-registered businesses
  if (businessProfile.registeredWithCac) {
    const cacDate = getNextCacAnnualReturnDeadline(referenceDate, businessProfile.createdAt);
    const cacDays = daysUntilDeadline(referenceDate, cacDate);
    deadlines.push({
      type: 'cac_annual_return',
      label: 'CAC Annual Return Filing',
      deadlineDate: cacDate,
      deadlineShortDate: formatShortDateWAT(cacDate),
      daysUntilDeadline: cacDays,
      isWithinReminderWindow: cacDays >= 0 && cacDays <= CAC_REMINDER_DAYS_BEFORE,
      regulatoryBody: 'CAC',
      resourceUrl: REGULATORY_URLS.cac,
    });
  }

  return deadlines;
}

// ─── Urgency Calculation ───────────────────────────────────────────────────

/**
 * Calculate urgency (0–100) based on days until a deadline.
 * Closer deadlines get higher urgency.
 */
export function calculateDeadlineUrgency(daysUntil: number): number {
  if (daysUntil <= 0) return 100;
  if (daysUntil <= 7) return 95;
  if (daysUntil <= 14) return 85;
  if (daysUntil <= 30) return 75;
  if (daysUntil <= 60) return 60;
  return 40;
}

// ─── ComplianceAnalyzer ────────────────────────────────────────────────────

export class ComplianceAnalyzer {
  /**
   * Analyse business context and produce compliance-related insights.
   *
   * Tracks NDPR, CAC, and FIRS deadlines and generates reminders
   * when deadlines fall within the reminder window. Also generates
   * sector-specific compliance tips for regulated sectors.
   *
   * **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
   */
  async analyze(context: AnalysisContext): Promise<RawInsight[]> {
    const insights: RawInsight[] = [];
    const referenceDate = context.dateRange.end;
    const { businessProfile } = context;

    // Requirement 6.1 — NDPR compliance reminders
    // Requirement 6.2 — CAC annual return reminders (60 days before)
    const complianceDeadlines = getUpcomingComplianceDeadlines(referenceDate, businessProfile);

    for (const deadline of complianceDeadlines) {
      if (deadline.isWithinReminderWindow) {
        insights.push(this.buildComplianceDeadlineInsight(deadline));
      }
    }

    // Requirement 6.3 — FIRS tax filing deadline reminders
    if (businessProfile.registeredWithFirs) {
      const firsDeadlines = getUpcomingFirsDeadlines(referenceDate);
      const firsNeedingReminder = firsDeadlines.filter((d) => d.isWithinReminderWindow);
      for (const deadline of firsNeedingReminder) {
        insights.push(this.buildFirsComplianceInsight(deadline));
      }
    }

    // Requirement 6.4 — Sector-specific compliance tips
    const sectorRules = getSectorComplianceRules(businessProfile.sector);
    for (const rule of sectorRules) {
      insights.push(this.buildSectorComplianceInsight(rule));
    }

    return insights;
  }

  /** Return the insight category this analyzer covers. */
  getCategory(): InsightCategory {
    return 'compliance';
  }

  /** Declare the data this analyzer needs. */
  getRequiredData(): DataRequirement[] {
    return [
      {
        source: 'business-management',
        fields: ['registeredWithCac', 'registeredWithFirs', 'createdAt', 'sector'],
        required: true,
      },
    ];
  }

  // ── Private builders ───────────────────────────────────────────────────

  /**
   * Build a compliance insight for an upcoming NDPR or CAC deadline.
   *
   * **Validates: Requirements 6.1, 6.2, 6.5**
   */
  private buildComplianceDeadlineInsight(deadline: ComplianceDeadline): RawInsight {
    const actionItems: ActionItem[] = [
      {
        id: uuidv4(),
        description: `Visit the ${deadline.regulatoryBody} portal for filing requirements`,
        actionType: 'external_link',
        actionData: { url: deadline.resourceUrl },
        completed: false,
      },
      {
        id: uuidv4(),
        description: `Prepare documents for ${deadline.label}`,
        actionType: 'navigate',
        actionData: { screen: 'compliance_checklist' },
        completed: false,
      },
    ];

    const urgency = calculateDeadlineUrgency(deadline.daysUntilDeadline);

    return {
      category: 'compliance',
      type: 'compliance_deadline',
      title: `${deadline.label} due in ${deadline.daysUntilDeadline} days`,
      body:
        `Your ${deadline.label} is due on ${deadline.deadlineShortDate}. ` +
        `You have ${deadline.daysUntilDeadline} days remaining. ` +
        `Visit ${deadline.resourceUrl} for requirements and filing instructions.`,
      data: {
        deadlineType: deadline.type,
        deadlineDate: deadline.deadlineShortDate,
        daysUntilDeadline: deadline.daysUntilDeadline,
        regulatoryBody: deadline.regulatoryBody,
        resourceUrl: deadline.resourceUrl,
      },
      actionItems,
      financialImpact: 0,
      urgency,
      confidence: 95,
    };
  }

  /**
   * Build a compliance insight for an upcoming FIRS deadline.
   *
   * **Validates: Requirements 6.3, 6.5**
   */
  private buildFirsComplianceInsight(deadline: FirsDeadline): RawInsight {
    const actionItems: ActionItem[] = [
      {
        id: uuidv4(),
        description: `File your ${deadline.label} on the FIRS portal`,
        actionType: 'external_link',
        actionData: { url: REGULATORY_URLS.firs },
        completed: false,
      },
      {
        id: uuidv4(),
        description: 'Consult a tax professional for filing assistance',
        actionType: 'navigate',
        actionData: { screen: 'tax_advisors' },
        completed: false,
      },
    ];

    const urgency = calculateDeadlineUrgency(deadline.daysUntilDeadline);

    return {
      category: 'compliance',
      type: 'compliance_deadline',
      title: `${deadline.label} due in ${deadline.daysUntilDeadline} days`,
      body:
        `Your ${deadline.label} is due on ${deadline.deadlineShortDate}. ` +
        `You have ${deadline.daysUntilDeadline} days remaining to file. ` +
        `Visit ${REGULATORY_URLS.firs} for filing instructions.`,
      data: {
        deadlineType: deadline.type,
        deadlineDate: deadline.deadlineDateWAT,
        deadlineShortDate: deadline.deadlineShortDate,
        daysUntilDeadline: deadline.daysUntilDeadline,
        regulatoryBody: 'FIRS',
        resourceUrl: REGULATORY_URLS.firs,
      },
      actionItems,
      financialImpact: 0,
      urgency,
      confidence: 95,
    };
  }

  /**
   * Build a sector-specific compliance tip insight.
   *
   * **Validates: Requirements 6.4, 6.5**
   */
  private buildSectorComplianceInsight(rule: SectorComplianceRule): RawInsight {
    const actionItems: ActionItem[] = [
      {
        id: uuidv4(),
        description: `Visit the ${rule.regulatoryBody} portal for compliance details`,
        actionType: 'external_link',
        actionData: { url: rule.resourceUrl },
        completed: false,
      },
      {
        id: uuidv4(),
        description: `Review ${rule.regulatoryBody} requirements for your business`,
        actionType: 'navigate',
        actionData: { screen: 'compliance_checklist' },
        completed: false,
      },
    ];

    return {
      category: 'compliance',
      type: 'sector_compliance',
      title: `${rule.regulatoryBody}: ${rule.requirement}`,
      body: rule.description,
      data: {
        sector: rule.sector,
        regulatoryBody: rule.regulatoryBody,
        requirement: rule.requirement,
        resourceUrl: rule.resourceUrl,
      },
      actionItems,
      financialImpact: 0,
      urgency: 50,
      confidence: 90,
    };
  }
}
