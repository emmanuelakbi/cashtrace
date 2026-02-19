import { describe, it, expect, beforeEach } from 'vitest';
import { SecurityAssessor } from './securityAssessor.js';
import type { AssessmentRecommendation } from './types.js';

const baseDate = new Date('2024-06-01T12:00:00Z');

describe('SecurityAssessor', () => {
  let assessor: SecurityAssessor;

  beforeEach(() => {
    assessor = new SecurityAssessor();
  });

  // ─── createAssessment ───

  describe('createAssessment()', () => {
    it('creates an assessment with all provided fields', () => {
      const result = assessor.createAssessment('vendor-1', {
        assessor: 'security-team',
        date: baseDate,
        score: 85,
        findings: ['Uses TLS 1.3', 'SOC2 certified'],
        recommendation: 'approve',
        conditions: [],
      });

      expect(result.id).toBeDefined();
      expect(result.vendorId).toBe('vendor-1');
      expect(result.assessor).toBe('security-team');
      expect(result.date).toEqual(baseDate);
      expect(result.score).toBe(85);
      expect(result.findings).toEqual(['Uses TLS 1.3', 'SOC2 certified']);
      expect(result.recommendation).toBe('approve');
      expect(result.conditions).toEqual([]);
    });

    it('defaults date to now when not provided', () => {
      const before = new Date();
      const result = assessor.createAssessment('vendor-1', {
        assessor: 'team',
        score: 50,
        findings: [],
        recommendation: 'reject',
      });
      const after = new Date();

      expect(result.date.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.date.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('defaults conditions to empty array', () => {
      const result = assessor.createAssessment('vendor-1', {
        assessor: 'team',
        score: 70,
        findings: [],
        recommendation: 'approve',
      });
      expect(result.conditions).toEqual([]);
    });

    it('assigns unique ids to each assessment', () => {
      const a = assessor.createAssessment('vendor-1', {
        assessor: 'team',
        score: 80,
        findings: [],
        recommendation: 'approve',
      });
      const b = assessor.createAssessment('vendor-1', {
        assessor: 'team',
        score: 60,
        findings: [],
        recommendation: 'reject',
      });
      expect(a.id).not.toBe(b.id);
    });

    it('throws for score below 0', () => {
      expect(() =>
        assessor.createAssessment('vendor-1', {
          assessor: 'team',
          score: -1,
          findings: [],
          recommendation: 'reject',
        }),
      ).toThrow('Assessment score must be between 0 and 100');
    });

    it('throws for score above 100', () => {
      expect(() =>
        assessor.createAssessment('vendor-1', {
          assessor: 'team',
          score: 101,
          findings: [],
          recommendation: 'reject',
        }),
      ).toThrow('Assessment score must be between 0 and 100');
    });

    it('accepts boundary scores 0 and 100', () => {
      const low = assessor.createAssessment('v1', {
        assessor: 'team',
        score: 0,
        findings: [],
        recommendation: 'reject',
      });
      const high = assessor.createAssessment('v2', {
        assessor: 'team',
        score: 100,
        findings: [],
        recommendation: 'approve',
      });
      expect(low.score).toBe(0);
      expect(high.score).toBe(100);
    });

    it('returns a copy (not a reference)', () => {
      const result = assessor.createAssessment('vendor-1', {
        assessor: 'team',
        score: 75,
        findings: ['finding-1'],
        recommendation: 'conditional',
        conditions: ['fix encryption'],
      });
      result.findings.push('mutated');
      result.conditions.push('mutated');

      const retrieved = assessor.getAssessment('vendor-1');
      expect(retrieved!.findings).toEqual(['finding-1']);
      expect(retrieved!.conditions).toEqual(['fix encryption']);
    });
  });

  // ─── getAssessment ───

  describe('getAssessment()', () => {
    it('returns the latest assessment for a vendor', () => {
      assessor.createAssessment('vendor-1', {
        assessor: 'team',
        date: new Date('2024-01-01'),
        score: 40,
        findings: ['weak encryption'],
        recommendation: 'reject',
      });
      assessor.createAssessment('vendor-1', {
        assessor: 'team',
        date: new Date('2024-06-01'),
        score: 85,
        findings: ['improved encryption'],
        recommendation: 'approve',
      });

      const latest = assessor.getAssessment('vendor-1');
      expect(latest).toBeDefined();
      expect(latest!.score).toBe(85);
      expect(latest!.recommendation).toBe('approve');
    });

    it('returns undefined for unknown vendor', () => {
      expect(assessor.getAssessment('nonexistent')).toBeUndefined();
    });

    it('returns a copy (not a reference)', () => {
      assessor.createAssessment('vendor-1', {
        assessor: 'team',
        score: 70,
        findings: ['ok'],
        recommendation: 'approve',
      });

      const a = assessor.getAssessment('vendor-1');
      const b = assessor.getAssessment('vendor-1');
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
      expect(a!.findings).not.toBe(b!.findings);
    });
  });

  // ─── isApproved ───

  describe('isApproved()', () => {
    it('returns true when latest assessment is approved', () => {
      assessor.createAssessment('vendor-1', {
        assessor: 'team',
        score: 90,
        findings: [],
        recommendation: 'approve',
      });
      expect(assessor.isApproved('vendor-1')).toBe(true);
    });

    it('returns false when latest assessment is rejected', () => {
      assessor.createAssessment('vendor-1', {
        assessor: 'team',
        score: 30,
        findings: ['critical issues'],
        recommendation: 'reject',
      });
      expect(assessor.isApproved('vendor-1')).toBe(false);
    });

    it('returns false when latest assessment is conditional', () => {
      assessor.createAssessment('vendor-1', {
        assessor: 'team',
        score: 60,
        findings: ['needs work'],
        recommendation: 'conditional',
        conditions: ['implement MFA'],
      });
      expect(assessor.isApproved('vendor-1')).toBe(false);
    });

    it('returns false for unknown vendor', () => {
      expect(assessor.isApproved('nonexistent')).toBe(false);
    });

    it('reflects the latest assessment, not earlier ones', () => {
      assessor.createAssessment('vendor-1', {
        assessor: 'team',
        score: 90,
        findings: [],
        recommendation: 'approve',
      });
      assessor.createAssessment('vendor-1', {
        assessor: 'team',
        score: 20,
        findings: ['regression'],
        recommendation: 'reject',
      });
      expect(assessor.isApproved('vendor-1')).toBe(false);
    });
  });

  // ─── Recommendation types ───

  describe('recommendation types', () => {
    const recommendations: AssessmentRecommendation[] = ['approve', 'reject', 'conditional'];

    it.each(recommendations)('supports %s recommendation', (rec) => {
      const result = assessor.createAssessment('vendor-1', {
        assessor: 'team',
        score: 50,
        findings: [],
        recommendation: rec,
      });
      expect(result.recommendation).toBe(rec);
    });
  });
});
