/**
 * Unit tests for ComplianceAnalyzer.
 *
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.5**
 *
 * @module insights/analyzers/complianceAnalyzer.test
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { createWATDate } from '../../utils/timezone.js';
import { makeAnalysisContext, makeBusinessProfile } from '../test/fixtures.js';

import {
  CAC_ANNUAL_RETURN_DAYS_AFTER_AGM,
  CAC_REMINDER_DAYS_BEFORE,
  calculateDeadlineUrgency,
  ComplianceAnalyzer,
  getNextCacAnnualReturnDeadline,
  getNextNdprAuditDeadline,
  getSectorComplianceRules,
  getUpcomingComplianceDeadlines,
  NDPR_REMINDER_DAYS_BEFORE,
  REGULATORY_URLS,
  SECTOR_COMPLIANCE_RULES,
} from './complianceAnalyzer.js';
import { daysUntilDeadline } from './firsDeadlines.js';

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('ComplianceAnalyzer', () => {
  let analyzer: ComplianceAnalyzer;

  beforeEach(() => {
    analyzer = new ComplianceAnalyzer();
  });

  // ── getCategory() ──────────────────────────────────────────────────────

  describe('getCategory()', () => {
    it('returns "compliance"', () => {
      expect(analyzer.getCategory()).toBe('compliance');
    });
  });

  // ── getRequiredData() ──────────────────────────────────────────────────

  describe('getRequiredData()', () => {
    it('requires business-management data', () => {
      const requirements = analyzer.getRequiredData();
      expect(requirements).toHaveLength(1);
      expect(requirements[0]!.source).toBe('business-management');
      expect(requirements[0]!.required).toBe(true);
    });

    it('requires registration and sector fields', () => {
      const fields = analyzer.getRequiredData()[0]!.fields;
      expect(fields).toContain('registeredWithCac');
      expect(fields).toContain('registeredWithFirs');
      expect(fields).toContain('createdAt');
      expect(fields).toContain('sector');
    });
  });

  // ── analyze() — Requirement 6.1 (NDPR reminders) ──────────────────────

  describe('analyze() — NDPR compliance reminders (Req 6.1)', () => {
    it('generates NDPR audit reminder when within 60-day window', async () => {
      // Business created Jan 15 2023, reference date is Dec 1 2024
      // Next NDPR audit anniversary: Jan 15 2025 → 45 days away → within 60-day window
      const businessProfile = makeBusinessProfile({
        createdAt: new Date('2023-01-15T09:00:00+01:00'),
        registeredWithCac: false,
        registeredWithFirs: false,
      });

      const ctx = makeAnalysisContext({
        businessProfile,
        dateRange: {
          start: new Date('2024-11-01T00:00:00+01:00'),
          end: new Date('2024-12-01T00:00:00+01:00'),
        },
        transactions: [],
      });

      const insights = await analyzer.analyze(ctx);
      const ndprInsights = insights.filter(
        (i) => (i.data as Record<string, unknown>).deadlineType === 'ndpr_annual_audit',
      );
      expect(ndprInsights).toHaveLength(1);
      expect(ndprInsights[0]!.category).toBe('compliance');
      expect(ndprInsights[0]!.type).toBe('compliance_deadline');
    });

    it('does not generate NDPR reminder when outside 60-day window', async () => {
      // Business created Jan 15 2023, reference date is June 1 2024
      // Next NDPR audit: Jan 15 2025 → ~228 days away → outside window
      const businessProfile = makeBusinessProfile({
        createdAt: new Date('2023-01-15T09:00:00+01:00'),
        registeredWithCac: false,
        registeredWithFirs: false,
      });

      const ctx = makeAnalysisContext({
        businessProfile,
        dateRange: {
          start: new Date('2024-05-01T00:00:00+01:00'),
          end: new Date('2024-06-01T00:00:00+01:00'),
        },
        transactions: [],
      });

      const insights = await analyzer.analyze(ctx);
      const ndprInsights = insights.filter(
        (i) => (i.data as Record<string, unknown>).deadlineType === 'ndpr_annual_audit',
      );
      expect(ndprInsights).toHaveLength(0);
    });

    it('includes NDPC portal link in action items', async () => {
      const businessProfile = makeBusinessProfile({
        createdAt: new Date('2023-01-15T09:00:00+01:00'),
        registeredWithCac: false,
        registeredWithFirs: false,
      });

      const ctx = makeAnalysisContext({
        businessProfile,
        dateRange: {
          start: new Date('2024-11-01T00:00:00+01:00'),
          end: new Date('2024-12-01T00:00:00+01:00'),
        },
        transactions: [],
      });

      const insights = await analyzer.analyze(ctx);
      const ndprInsight = insights.find(
        (i) => (i.data as Record<string, unknown>).deadlineType === 'ndpr_annual_audit',
      );
      expect(ndprInsight).toBeDefined();

      const externalLinks = ndprInsight!.actionItems.filter(
        (a) => a.actionType === 'external_link',
      );
      expect(externalLinks.length).toBeGreaterThanOrEqual(1);
      expect(
        externalLinks.some(
          (a) => (a.actionData as Record<string, unknown>).url === REGULATORY_URLS.ndpc,
        ),
      ).toBe(true);
    });
  });

  // ── analyze() — Requirement 6.2 (CAC reminders) ───────────────────────

  describe('analyze() — CAC annual return reminders (Req 6.2)', () => {
    it('generates CAC reminder when registered and within 60-day window', async () => {
      // Business created March 1 2023, registered with CAC
      // AGM anniversary: March 1 2025, CAC deadline: March 1 + 42 days = April 12 2025
      // Reference date: Feb 15 2025 → ~56 days away → within 60-day window
      const businessProfile = makeBusinessProfile({
        createdAt: new Date('2023-03-01T09:00:00+01:00'),
        registeredWithCac: true,
        registeredWithFirs: false,
      });

      const ctx = makeAnalysisContext({
        businessProfile,
        dateRange: {
          start: new Date('2025-01-15T00:00:00+01:00'),
          end: new Date('2025-02-15T00:00:00+01:00'),
        },
        transactions: [],
      });

      const insights = await analyzer.analyze(ctx);
      const cacInsights = insights.filter(
        (i) => (i.data as Record<string, unknown>).deadlineType === 'cac_annual_return',
      );
      expect(cacInsights).toHaveLength(1);
      expect(cacInsights[0]!.category).toBe('compliance');
    });

    it('does not generate CAC reminder when not registered with CAC', async () => {
      const businessProfile = makeBusinessProfile({
        createdAt: new Date('2023-03-01T09:00:00+01:00'),
        registeredWithCac: false,
        registeredWithFirs: false,
      });

      const ctx = makeAnalysisContext({
        businessProfile,
        dateRange: {
          start: new Date('2025-01-15T00:00:00+01:00'),
          end: new Date('2025-02-15T00:00:00+01:00'),
        },
        transactions: [],
      });

      const insights = await analyzer.analyze(ctx);
      const cacInsights = insights.filter(
        (i) => (i.data as Record<string, unknown>).deadlineType === 'cac_annual_return',
      );
      expect(cacInsights).toHaveLength(0);
    });

    it('includes CAC portal link in action items', async () => {
      const businessProfile = makeBusinessProfile({
        createdAt: new Date('2023-03-01T09:00:00+01:00'),
        registeredWithCac: true,
        registeredWithFirs: false,
      });

      const ctx = makeAnalysisContext({
        businessProfile,
        dateRange: {
          start: new Date('2025-01-15T00:00:00+01:00'),
          end: new Date('2025-02-15T00:00:00+01:00'),
        },
        transactions: [],
      });

      const insights = await analyzer.analyze(ctx);
      const cacInsight = insights.find(
        (i) => (i.data as Record<string, unknown>).deadlineType === 'cac_annual_return',
      );
      expect(cacInsight).toBeDefined();

      const externalLinks = cacInsight!.actionItems.filter((a) => a.actionType === 'external_link');
      expect(
        externalLinks.some(
          (a) => (a.actionData as Record<string, unknown>).url === REGULATORY_URLS.cac,
        ),
      ).toBe(true);
    });
  });

  // ── analyze() — Requirement 6.3 (FIRS reminders) ──────────────────────

  describe('analyze() — FIRS deadline reminders (Req 6.3)', () => {
    it('generates FIRS reminders when registered with FIRS', async () => {
      // Reference date: June 5 2025 → monthly VAT due June 21 (16 days) → within 30-day window
      const businessProfile = makeBusinessProfile({
        createdAt: new Date('2023-01-15T09:00:00+01:00'),
        registeredWithCac: false,
        registeredWithFirs: true,
      });

      const ctx = makeAnalysisContext({
        businessProfile,
        dateRange: {
          start: new Date('2025-05-05T00:00:00+01:00'),
          end: new Date('2025-06-05T00:00:00+01:00'),
        },
        transactions: [],
      });

      const insights = await analyzer.analyze(ctx);
      const firsInsights = insights.filter(
        (i) => (i.data as Record<string, unknown>).regulatoryBody === 'FIRS',
      );
      expect(firsInsights.length).toBeGreaterThanOrEqual(1);
    });

    it('does not generate FIRS reminders when not registered with FIRS', async () => {
      const businessProfile = makeBusinessProfile({
        createdAt: new Date('2023-01-15T09:00:00+01:00'),
        registeredWithCac: false,
        registeredWithFirs: false,
      });

      const ctx = makeAnalysisContext({
        businessProfile,
        dateRange: {
          start: new Date('2025-05-05T00:00:00+01:00'),
          end: new Date('2025-06-05T00:00:00+01:00'),
        },
        transactions: [],
      });

      const insights = await analyzer.analyze(ctx);
      const firsInsights = insights.filter(
        (i) => (i.data as Record<string, unknown>).regulatoryBody === 'FIRS',
      );
      expect(firsInsights).toHaveLength(0);
    });

    it('includes FIRS portal link in FIRS insight action items', async () => {
      const businessProfile = makeBusinessProfile({
        createdAt: new Date('2023-01-15T09:00:00+01:00'),
        registeredWithCac: false,
        registeredWithFirs: true,
      });

      const ctx = makeAnalysisContext({
        businessProfile,
        dateRange: {
          start: new Date('2025-05-05T00:00:00+01:00'),
          end: new Date('2025-06-05T00:00:00+01:00'),
        },
        transactions: [],
      });

      const insights = await analyzer.analyze(ctx);
      const firsInsight = insights.find(
        (i) => (i.data as Record<string, unknown>).regulatoryBody === 'FIRS',
      );
      expect(firsInsight).toBeDefined();

      const externalLinks = firsInsight!.actionItems.filter(
        (a) => a.actionType === 'external_link',
      );
      expect(
        externalLinks.some(
          (a) => (a.actionData as Record<string, unknown>).url === REGULATORY_URLS.firs,
        ),
      ).toBe(true);
    });
  });

  // ── analyze() — combined registration ──────────────────────────────────

  describe('analyze() — combined registrations', () => {
    it('generates insights for all applicable regulatory bodies', async () => {
      // Business created Jan 15 2023, registered with both CAC and FIRS
      // Reference: Dec 1 2024
      // NDPR audit: Jan 15 2025 → 45 days → within window
      // CAC: Jan 15 + 42 = Feb 26 2025 → 87 days → outside 60-day window
      // FIRS: monthly VAT due Dec 21 → 20 days → within 30-day window
      const businessProfile = makeBusinessProfile({
        createdAt: new Date('2023-01-15T09:00:00+01:00'),
        registeredWithCac: true,
        registeredWithFirs: true,
      });

      const ctx = makeAnalysisContext({
        businessProfile,
        dateRange: {
          start: new Date('2024-11-01T00:00:00+01:00'),
          end: new Date('2024-12-01T00:00:00+01:00'),
        },
        transactions: [],
      });

      const insights = await analyzer.analyze(ctx);
      // Should have at least NDPR + FIRS insights
      expect(insights.length).toBeGreaterThanOrEqual(2);

      const bodies = insights.map((i) => (i.data as Record<string, unknown>).regulatoryBody);
      expect(bodies).toContain('NDPC');
      expect(bodies).toContain('FIRS');
    });
  });

  // ── analyze() — Requirement 6.4 (sector-specific compliance) ────────────

  describe('analyze() — sector-specific compliance tips (Req 6.4)', () => {
    it('generates sector-specific insights for healthcare businesses', async () => {
      const businessProfile = makeBusinessProfile({
        sector: 'healthcare',
        registeredWithCac: false,
        registeredWithFirs: false,
        createdAt: new Date('2023-06-15T09:00:00+01:00'),
      });

      const ctx = makeAnalysisContext({
        businessProfile,
        dateRange: {
          start: new Date('2024-01-01T00:00:00+01:00'),
          end: new Date('2024-01-15T00:00:00+01:00'),
        },
        transactions: [],
      });

      const insights = await analyzer.analyze(ctx);
      const sectorInsights = insights.filter((i) => i.type === 'sector_compliance');
      expect(sectorInsights).toHaveLength(2);

      const bodies = sectorInsights.map((i) => (i.data as Record<string, unknown>).regulatoryBody);
      expect(bodies).toContain('NAFDAC');
      expect(bodies).toContain('MDCN');
    });

    it('generates sector-specific insights for education businesses', async () => {
      const businessProfile = makeBusinessProfile({
        sector: 'education',
        registeredWithCac: false,
        registeredWithFirs: false,
        createdAt: new Date('2023-06-15T09:00:00+01:00'),
      });

      const ctx = makeAnalysisContext({
        businessProfile,
        dateRange: {
          start: new Date('2024-01-01T00:00:00+01:00'),
          end: new Date('2024-01-15T00:00:00+01:00'),
        },
        transactions: [],
      });

      const insights = await analyzer.analyze(ctx);
      const sectorInsights = insights.filter((i) => i.type === 'sector_compliance');
      expect(sectorInsights).toHaveLength(2);

      const bodies = sectorInsights.map((i) => (i.data as Record<string, unknown>).regulatoryBody);
      expect(bodies).toContain('TRCN');
      expect(bodies).toContain('NUC');
    });

    it('generates sector-specific insights for manufacturing businesses', async () => {
      const businessProfile = makeBusinessProfile({
        sector: 'manufacturing',
        registeredWithCac: false,
        registeredWithFirs: false,
        createdAt: new Date('2023-06-15T09:00:00+01:00'),
      });

      const ctx = makeAnalysisContext({
        businessProfile,
        dateRange: {
          start: new Date('2024-01-01T00:00:00+01:00'),
          end: new Date('2024-01-15T00:00:00+01:00'),
        },
        transactions: [],
      });

      const insights = await analyzer.analyze(ctx);
      const sectorInsights = insights.filter((i) => i.type === 'sector_compliance');
      expect(sectorInsights).toHaveLength(2);

      const bodies = sectorInsights.map((i) => (i.data as Record<string, unknown>).regulatoryBody);
      expect(bodies).toContain('SON');
      expect(bodies).toContain('NESREA');
    });

    it('does not generate sector-specific insights for unregulated sectors', async () => {
      const businessProfile = makeBusinessProfile({
        sector: 'retail',
        registeredWithCac: false,
        registeredWithFirs: false,
        createdAt: new Date('2023-06-15T09:00:00+01:00'),
      });

      const ctx = makeAnalysisContext({
        businessProfile,
        dateRange: {
          start: new Date('2024-01-01T00:00:00+01:00'),
          end: new Date('2024-01-15T00:00:00+01:00'),
        },
        transactions: [],
      });

      const insights = await analyzer.analyze(ctx);
      const sectorInsights = insights.filter((i) => i.type === 'sector_compliance');
      expect(sectorInsights).toHaveLength(0);
    });

    it('includes regulatory body portal link in action items', async () => {
      const businessProfile = makeBusinessProfile({
        sector: 'healthcare',
        registeredWithCac: false,
        registeredWithFirs: false,
        createdAt: new Date('2023-06-15T09:00:00+01:00'),
      });

      const ctx = makeAnalysisContext({
        businessProfile,
        dateRange: {
          start: new Date('2024-01-01T00:00:00+01:00'),
          end: new Date('2024-01-15T00:00:00+01:00'),
        },
        transactions: [],
      });

      const insights = await analyzer.analyze(ctx);
      const sectorInsights = insights.filter((i) => i.type === 'sector_compliance');

      for (const insight of sectorInsights) {
        const externalLinks = insight.actionItems.filter((a) => a.actionType === 'external_link');
        expect(externalLinks.length).toBeGreaterThanOrEqual(1);
        const resourceUrl = (insight.data as Record<string, unknown>).resourceUrl;
        expect(
          externalLinks.some((a) => (a.actionData as Record<string, unknown>).url === resourceUrl),
        ).toBe(true);
      }
    });

    it('sector compliance insights have correct category and type', async () => {
      const businessProfile = makeBusinessProfile({
        sector: 'hospitality',
        registeredWithCac: false,
        registeredWithFirs: false,
        createdAt: new Date('2023-06-15T09:00:00+01:00'),
      });

      const ctx = makeAnalysisContext({
        businessProfile,
        dateRange: {
          start: new Date('2024-01-01T00:00:00+01:00'),
          end: new Date('2024-01-15T00:00:00+01:00'),
        },
        transactions: [],
      });

      const insights = await analyzer.analyze(ctx);
      const sectorInsights = insights.filter((i) => i.type === 'sector_compliance');
      expect(sectorInsights.length).toBeGreaterThan(0);

      for (const insight of sectorInsights) {
        expect(insight.category).toBe('compliance');
        expect(insight.type).toBe('sector_compliance');
        expect(insight.financialImpact).toBe(0);
        expect(insight.confidence).toBe(90);
      }
    });

    it('sector compliance insights include sector in data', async () => {
      const businessProfile = makeBusinessProfile({
        sector: 'technology',
        registeredWithCac: false,
        registeredWithFirs: false,
        createdAt: new Date('2023-06-15T09:00:00+01:00'),
      });

      const ctx = makeAnalysisContext({
        businessProfile,
        dateRange: {
          start: new Date('2024-01-01T00:00:00+01:00'),
          end: new Date('2024-01-15T00:00:00+01:00'),
        },
        transactions: [],
      });

      const insights = await analyzer.analyze(ctx);
      const sectorInsights = insights.filter((i) => i.type === 'sector_compliance');
      expect(sectorInsights).toHaveLength(1);

      const data = sectorInsights[0]!.data as Record<string, unknown>;
      expect(data.sector).toBe('technology');
      expect(data.regulatoryBody).toBe('NDPC');
    });
  });

  // ── analyze() — insight structure ──────────────────────────────────────

  describe('analyze() — insight structure', () => {
    it('all insights have compliance category', async () => {
      const businessProfile = makeBusinessProfile({
        createdAt: new Date('2023-01-15T09:00:00+01:00'),
        registeredWithCac: true,
        registeredWithFirs: true,
      });

      const ctx = makeAnalysisContext({
        businessProfile,
        dateRange: {
          start: new Date('2024-11-01T00:00:00+01:00'),
          end: new Date('2024-12-01T00:00:00+01:00'),
        },
        transactions: [],
      });

      const insights = await analyzer.analyze(ctx);
      for (const insight of insights) {
        expect(insight.category).toBe('compliance');
      }
    });

    it('all insights have compliance_deadline type', async () => {
      const businessProfile = makeBusinessProfile({
        createdAt: new Date('2023-01-15T09:00:00+01:00'),
        registeredWithCac: false,
        registeredWithFirs: true,
      });

      const ctx = makeAnalysisContext({
        businessProfile,
        dateRange: {
          start: new Date('2025-05-05T00:00:00+01:00'),
          end: new Date('2025-06-05T00:00:00+01:00'),
        },
        transactions: [],
      });

      const insights = await analyzer.analyze(ctx);
      for (const insight of insights) {
        expect(insight.type).toBe('compliance_deadline');
      }
    });

    it('all insights have zero financial impact', async () => {
      const businessProfile = makeBusinessProfile({
        createdAt: new Date('2023-01-15T09:00:00+01:00'),
        registeredWithCac: true,
        registeredWithFirs: true,
      });

      const ctx = makeAnalysisContext({
        businessProfile,
        dateRange: {
          start: new Date('2024-11-01T00:00:00+01:00'),
          end: new Date('2024-12-01T00:00:00+01:00'),
        },
        transactions: [],
      });

      const insights = await analyzer.analyze(ctx);
      for (const insight of insights) {
        expect(insight.financialImpact).toBe(0);
      }
    });

    it('all insights have high confidence', async () => {
      const businessProfile = makeBusinessProfile({
        createdAt: new Date('2023-01-15T09:00:00+01:00'),
        registeredWithCac: true,
        registeredWithFirs: true,
      });

      const ctx = makeAnalysisContext({
        businessProfile,
        dateRange: {
          start: new Date('2024-11-01T00:00:00+01:00'),
          end: new Date('2024-12-01T00:00:00+01:00'),
        },
        transactions: [],
      });

      const insights = await analyzer.analyze(ctx);
      for (const insight of insights) {
        expect(insight.confidence).toBe(95);
      }
    });
  });
});

// ─── Pure helper tests ─────────────────────────────────────────────────────

describe('getNextNdprAuditDeadline()', () => {
  it('returns this year anniversary when it has not passed', () => {
    // Business created Jan 15, reference is Jan 1 → next audit Jan 15 this year
    const ref = createWATDate(2025, 1, 1);
    const created = createWATDate(2023, 1, 15);
    const deadline = getNextNdprAuditDeadline(ref, created);
    const days = daysUntilDeadline(ref, deadline);
    expect(days).toBe(14);
  });

  it('returns next year anniversary when this year has passed', () => {
    // Business created Jan 15, reference is Feb 1 → next audit Jan 15 next year
    const ref = createWATDate(2025, 2, 1);
    const created = createWATDate(2023, 1, 15);
    const deadline = getNextNdprAuditDeadline(ref, created);
    const days = daysUntilDeadline(ref, deadline);
    expect(days).toBe(348); // Feb 1 2025 → Jan 15 2026
  });

  it('returns next year when reference is on the anniversary day', () => {
    // On the exact anniversary day, daysUntil = 0 which is not > 0
    const ref = createWATDate(2025, 1, 15);
    const created = createWATDate(2023, 1, 15);
    const deadline = getNextNdprAuditDeadline(ref, created);
    const days = daysUntilDeadline(ref, deadline);
    expect(days).toBe(365); // Next year
  });
});

describe('getNextCacAnnualReturnDeadline()', () => {
  it('returns AGM date + 42 days when deadline has not passed', () => {
    // Business created March 1, reference Jan 1 2025
    // AGM: March 1 2025, deadline: March 1 + 42 = April 12 2025
    const ref = createWATDate(2025, 1, 1);
    const created = createWATDate(2023, 3, 1);
    const deadline = getNextCacAnnualReturnDeadline(ref, created);
    const days = daysUntilDeadline(ref, deadline);
    // Jan 1 → April 12 = 31 (Jan) + 28 (Feb) + 31 (Mar) + 12 (Apr) - 1 = 101 days
    expect(days).toBe(101);
  });

  it('returns next year deadline when this year has passed', () => {
    // Business created March 1, reference May 1 2025
    // This year deadline: March 1 + 42 = April 12 2025 → already passed
    // Next year: March 1 2026 + 42 = April 12 2026
    const ref = createWATDate(2025, 5, 1);
    const created = createWATDate(2023, 3, 1);
    const deadline = getNextCacAnnualReturnDeadline(ref, created);
    const days = daysUntilDeadline(ref, deadline);
    expect(days).toBeGreaterThan(300);
  });

  it('adds exactly 42 days to AGM date', () => {
    const ref = createWATDate(2025, 1, 1);
    const created = createWATDate(2023, 6, 15); // AGM June 15
    const deadline = getNextCacAnnualReturnDeadline(ref, created);
    // AGM: June 15 2025, deadline: June 15 + 42 = July 27 2025
    const agmDate = createWATDate(2025, 6, 15);
    const expectedDeadline = new Date(
      agmDate.getTime() + CAC_ANNUAL_RETURN_DAYS_AFTER_AGM * 24 * 60 * 60 * 1000,
    );
    expect(deadline.getTime()).toBe(expectedDeadline.getTime());
  });
});

describe('getUpcomingComplianceDeadlines()', () => {
  it('always includes NDPR deadline', () => {
    const ref = createWATDate(2025, 1, 1);
    const profile = makeBusinessProfile({
      createdAt: createWATDate(2023, 3, 15),
      registeredWithCac: false,
    });
    const deadlines = getUpcomingComplianceDeadlines(ref, profile);
    const ndpr = deadlines.filter((d) => d.type === 'ndpr_annual_audit');
    expect(ndpr).toHaveLength(1);
    expect(ndpr[0]!.regulatoryBody).toBe('NDPC');
    expect(ndpr[0]!.resourceUrl).toBe(REGULATORY_URLS.ndpc);
  });

  it('includes CAC deadline only when registered', () => {
    const ref = createWATDate(2025, 1, 1);
    const registered = makeBusinessProfile({
      createdAt: createWATDate(2023, 3, 15),
      registeredWithCac: true,
    });
    const unregistered = makeBusinessProfile({
      createdAt: createWATDate(2023, 3, 15),
      registeredWithCac: false,
    });

    const withCac = getUpcomingComplianceDeadlines(ref, registered);
    const withoutCac = getUpcomingComplianceDeadlines(ref, unregistered);

    expect(withCac.some((d) => d.type === 'cac_annual_return')).toBe(true);
    expect(withoutCac.some((d) => d.type === 'cac_annual_return')).toBe(false);
  });

  it('correctly marks reminder window for NDPR', () => {
    // Business created Feb 15, reference Jan 1 → NDPR due Feb 15 → 45 days → within 60-day window
    const ref = createWATDate(2025, 1, 1);
    const profile = makeBusinessProfile({
      createdAt: createWATDate(2023, 2, 15),
      registeredWithCac: false,
    });
    const deadlines = getUpcomingComplianceDeadlines(ref, profile);
    const ndpr = deadlines.find((d) => d.type === 'ndpr_annual_audit');
    expect(ndpr!.isWithinReminderWindow).toBe(true);
    expect(ndpr!.daysUntilDeadline).toBe(45);
  });

  it('correctly marks outside reminder window', () => {
    // Business created Sept 15, reference Jan 1 → NDPR due Sept 15 → 257 days → outside window
    const ref = createWATDate(2025, 1, 1);
    const profile = makeBusinessProfile({
      createdAt: createWATDate(2023, 9, 15),
      registeredWithCac: false,
    });
    const deadlines = getUpcomingComplianceDeadlines(ref, profile);
    const ndpr = deadlines.find((d) => d.type === 'ndpr_annual_audit');
    expect(ndpr!.isWithinReminderWindow).toBe(false);
  });
});

describe('calculateDeadlineUrgency()', () => {
  it('returns 100 for overdue deadlines', () => {
    expect(calculateDeadlineUrgency(0)).toBe(100);
    expect(calculateDeadlineUrgency(-5)).toBe(100);
  });

  it('returns 95 for deadlines within 7 days', () => {
    expect(calculateDeadlineUrgency(1)).toBe(95);
    expect(calculateDeadlineUrgency(7)).toBe(95);
  });

  it('returns 85 for deadlines within 14 days', () => {
    expect(calculateDeadlineUrgency(8)).toBe(85);
    expect(calculateDeadlineUrgency(14)).toBe(85);
  });

  it('returns 75 for deadlines within 30 days', () => {
    expect(calculateDeadlineUrgency(15)).toBe(75);
    expect(calculateDeadlineUrgency(30)).toBe(75);
  });

  it('returns 60 for deadlines within 60 days', () => {
    expect(calculateDeadlineUrgency(31)).toBe(60);
    expect(calculateDeadlineUrgency(60)).toBe(60);
  });

  it('returns 40 for deadlines beyond 60 days', () => {
    expect(calculateDeadlineUrgency(61)).toBe(40);
    expect(calculateDeadlineUrgency(365)).toBe(40);
  });
});

describe('getSectorComplianceRules()', () => {
  it('returns rules for healthcare sector', () => {
    const rules = getSectorComplianceRules('healthcare');
    expect(rules).toHaveLength(2);
    expect(rules.map((r) => r.regulatoryBody)).toContain('NAFDAC');
    expect(rules.map((r) => r.regulatoryBody)).toContain('MDCN');
  });

  it('returns rules for education sector', () => {
    const rules = getSectorComplianceRules('education');
    expect(rules).toHaveLength(2);
    expect(rules.map((r) => r.regulatoryBody)).toContain('TRCN');
    expect(rules.map((r) => r.regulatoryBody)).toContain('NUC');
  });

  it('returns rules for manufacturing sector', () => {
    const rules = getSectorComplianceRules('manufacturing');
    expect(rules).toHaveLength(2);
    expect(rules.map((r) => r.regulatoryBody)).toContain('SON');
    expect(rules.map((r) => r.regulatoryBody)).toContain('NESREA');
  });

  it('returns rules for hospitality sector', () => {
    const rules = getSectorComplianceRules('hospitality');
    expect(rules).toHaveLength(2);
    expect(rules.map((r) => r.regulatoryBody)).toContain('NTDC');
    expect(rules.map((r) => r.regulatoryBody)).toContain('NAFDAC');
  });

  it('returns rules for technology sector', () => {
    const rules = getSectorComplianceRules('technology');
    expect(rules).toHaveLength(1);
    expect(rules[0]!.regulatoryBody).toBe('NDPC');
  });

  it('returns empty array for sectors without additional rules', () => {
    expect(getSectorComplianceRules('retail')).toHaveLength(0);
    expect(getSectorComplianceRules('services')).toHaveLength(0);
    expect(getSectorComplianceRules('agriculture')).toHaveLength(0);
    expect(getSectorComplianceRules('logistics')).toHaveLength(0);
  });

  it('all rules have valid resource URLs', () => {
    for (const [_sector, rules] of SECTOR_COMPLIANCE_RULES) {
      for (const rule of rules) {
        expect(rule.resourceUrl).toMatch(/^https:\/\//);
      }
    }
  });

  it('all rules have non-empty descriptions', () => {
    for (const [_sector, rules] of SECTOR_COMPLIANCE_RULES) {
      for (const rule of rules) {
        expect(rule.description.length).toBeGreaterThan(0);
        expect(rule.requirement.length).toBeGreaterThan(0);
        expect(rule.regulatoryBody.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('ComplianceAnalyzer constants', () => {
  it('CAC reminder window is 60 days', () => {
    expect(CAC_REMINDER_DAYS_BEFORE).toBe(60);
  });

  it('NDPR reminder window is 60 days', () => {
    expect(NDPR_REMINDER_DAYS_BEFORE).toBe(60);
  });

  it('CAC annual return is 42 days after AGM', () => {
    expect(CAC_ANNUAL_RETURN_DAYS_AFTER_AGM).toBe(42);
  });

  it('has correct regulatory URLs', () => {
    expect(REGULATORY_URLS.ndpc).toBe('https://ndpc.gov.ng');
    expect(REGULATORY_URLS.cac).toBe('https://pre.cac.gov.ng');
    expect(REGULATORY_URLS.firs).toBe('https://firs.gov.ng');
  });
});
