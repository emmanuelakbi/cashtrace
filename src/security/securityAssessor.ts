/**
 * Security Assessor for CashTrace Security & Compliance Module.
 *
 * Assesses third-party vendor security posture before integration.
 *
 * @module security/securityAssessor
 *
 * Requirement 12.2: Assess third-party security posture before integration.
 */

import { randomUUID } from 'node:crypto';
import type { SecurityAssessment, AssessmentRecommendation } from './types.js';

export class SecurityAssessor {
  /** Assessments keyed by vendor id → array of assessments (chronological). */
  private readonly assessments = new Map<string, SecurityAssessment[]>();

  /**
   * Create a security assessment for a vendor.
   *
   * Requirement 12.2: Assess third-party security posture before integration.
   */
  createAssessment(
    vendorId: string,
    assessment: {
      assessor: string;
      date?: Date;
      score: number;
      findings: string[];
      recommendation: AssessmentRecommendation;
      conditions?: string[];
    },
  ): SecurityAssessment {
    if (assessment.score < 0 || assessment.score > 100) {
      throw new Error('Assessment score must be between 0 and 100');
    }

    const record: SecurityAssessment = {
      id: randomUUID(),
      vendorId,
      assessor: assessment.assessor,
      date: assessment.date ?? new Date(),
      score: assessment.score,
      findings: [...assessment.findings],
      recommendation: assessment.recommendation,
      conditions: [...(assessment.conditions ?? [])],
    };

    const existing = this.assessments.get(vendorId) ?? [];
    existing.push(record);
    this.assessments.set(vendorId, existing);

    return { ...record, findings: [...record.findings], conditions: [...record.conditions] };
  }

  /**
   * Get the latest assessment for a vendor.
   * Returns undefined if no assessment exists.
   */
  getAssessment(vendorId: string): SecurityAssessment | undefined {
    const list = this.assessments.get(vendorId);
    if (!list || list.length === 0) return undefined;

    const latest = list[list.length - 1];
    if (!latest) return undefined;
    return { ...latest, findings: [...latest.findings], conditions: [...latest.conditions] };
  }

  /**
   * Check if a vendor has an approved assessment.
   * A vendor is approved if the latest assessment recommendation is 'approve'.
   */
  isApproved(vendorId: string): boolean {
    const latest = this.getAssessment(vendorId);
    return latest?.recommendation === 'approve';
  }
}
