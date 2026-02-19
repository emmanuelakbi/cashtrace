/**
 * Consent Manager for CashTrace Security & Compliance Module.
 *
 * Tracks consent for all data processing activities as required
 * by NDPR. Supports recording, revoking, querying, and exporting
 * consent records per user.
 *
 * @module compliance/consentManager
 *
 * Requirement 7.1: Track consent for all data processing activities.
 */

import { randomUUID } from 'node:crypto';
import type { ConsentRecord, ConsentType, ConsentExport } from './types.js';

export class ConsentManager {
  /** In-memory consent store keyed by record id. */
  private readonly consents = new Map<string, ConsentRecord>();

  /**
   * Record a new consent grant for a user.
   *
   * If the user already has an active (non-revoked) consent of the same type,
   * the existing consent is revoked before the new one is recorded, ensuring
   * only one active consent per type per user.
   *
   * @param consent - Partial consent record; `id` and `grantedAt` are auto-generated if missing.
   */
  async recordConsent(
    consent: Omit<ConsentRecord, 'id' | 'grantedAt'> & { id?: string; grantedAt?: Date },
  ): Promise<ConsentRecord> {
    // Revoke any existing active consent of the same type for this user
    for (const existing of this.consents.values()) {
      if (
        existing.userId === consent.userId &&
        existing.consentType === consent.consentType &&
        !existing.revokedAt
      ) {
        existing.revokedAt = new Date();
      }
    }

    const record: ConsentRecord = {
      id: consent.id ?? randomUUID(),
      userId: consent.userId,
      consentType: consent.consentType,
      version: consent.version,
      grantedAt: consent.grantedAt ?? new Date(),
      revokedAt: consent.revokedAt,
      ipAddress: consent.ipAddress,
      userAgent: consent.userAgent,
    };

    this.consents.set(record.id, record);
    return record;
  }

  /**
   * Revoke an active consent of the given type for a user.
   *
   * @returns true if an active consent was found and revoked, false otherwise.
   */
  async revokeConsent(userId: string, consentType: ConsentType): Promise<boolean> {
    for (const record of this.consents.values()) {
      if (record.userId === userId && record.consentType === consentType && !record.revokedAt) {
        record.revokedAt = new Date();
        return true;
      }
    }
    return false;
  }

  /**
   * Get all consent records for a user (both active and revoked).
   */
  async getConsents(userId: string): Promise<ConsentRecord[]> {
    const results: ConsentRecord[] = [];
    for (const record of this.consents.values()) {
      if (record.userId === userId) {
        results.push(record);
      }
    }
    return results;
  }

  /**
   * Check whether a user currently has active (non-revoked) consent
   * for the given consent type.
   */
  async hasConsent(userId: string, consentType: ConsentType): Promise<boolean> {
    for (const record of this.consents.values()) {
      if (record.userId === userId && record.consentType === consentType && !record.revokedAt) {
        return true;
      }
    }
    return false;
  }

  /**
   * Export all consent records for a user in a portable format.
   * Used for DSAR portability requests.
   */
  async exportConsents(userId: string): Promise<ConsentExport> {
    const consents = await this.getConsents(userId);
    return {
      userId,
      exportedAt: new Date(),
      consents,
    };
  }
}
