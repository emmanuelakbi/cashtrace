/**
 * Processing Records Service for CashTrace Security & Compliance Module.
 *
 * Maintains records of all data processing activities as required by NDPR.
 * Supports creating, updating, querying, and listing processing records.
 *
 * @module compliance/processingRecords
 *
 * Requirement 7.5: Maintain records of processing activities.
 */

import { randomUUID } from 'node:crypto';
import type { ProcessingRecord, ProcessingRecordFilter, ProcessingRecordStatus } from './types.js';

export class ProcessingRecordsService {
  /** In-memory store of processing records keyed by record id. */
  private readonly records = new Map<string, ProcessingRecord>();

  /**
   * Create a new processing activity record.
   *
   * @param input - The processing record details (id, createdAt, updatedAt are auto-generated).
   * @returns The created processing record.
   * @throws Error if required fields are missing or invalid.
   */
  async createRecord(
    input: Omit<ProcessingRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'> & {
      status?: ProcessingRecordStatus;
    },
  ): Promise<ProcessingRecord> {
    if (!input.businessId) {
      throw new Error('Processing record requires a businessId');
    }
    if (!input.purpose) {
      throw new Error('Processing record requires a purpose');
    }
    if (!input.legalBasis) {
      throw new Error('Processing record requires a legalBasis');
    }
    if (!input.dataCategories || input.dataCategories.length === 0) {
      throw new Error('Processing record requires at least one data category');
    }
    if (!input.processors || input.processors.length === 0) {
      throw new Error('Processing record requires at least one processor');
    }

    const now = new Date();
    const record: ProcessingRecord = {
      id: randomUUID(),
      businessId: input.businessId,
      purpose: input.purpose,
      legalBasis: input.legalBasis,
      dataCategories: [...input.dataCategories],
      dataSubjects: [...(input.dataSubjects ?? [])],
      processors: [...input.processors],
      retentionPeriodDays: input.retentionPeriodDays,
      status: input.status ?? 'active',
      createdAt: now,
      updatedAt: now,
    };

    this.records.set(record.id, record);
    return record;
  }

  /**
   * Get a processing record by its ID.
   *
   * @returns The record, or undefined if not found.
   */
  async getRecord(recordId: string): Promise<ProcessingRecord | undefined> {
    return this.records.get(recordId);
  }

  /**
   * Update an existing processing record.
   *
   * @param recordId - The ID of the record to update.
   * @param updates - Partial fields to update.
   * @returns The updated record.
   * @throws Error if the record is not found.
   */
  async updateRecord(
    recordId: string,
    updates: Partial<
      Pick<
        ProcessingRecord,
        | 'purpose'
        | 'legalBasis'
        | 'dataCategories'
        | 'dataSubjects'
        | 'processors'
        | 'retentionPeriodDays'
        | 'status'
      >
    >,
  ): Promise<ProcessingRecord> {
    const existing = this.records.get(recordId);
    if (!existing) {
      throw new Error(`Processing record not found: ${recordId}`);
    }

    const updated: ProcessingRecord = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };

    this.records.set(recordId, updated);
    return updated;
  }

  /**
   * List processing records, optionally filtered.
   *
   * @param filter - Optional filter criteria.
   * @returns Array of matching processing records.
   */
  async listRecords(filter?: ProcessingRecordFilter): Promise<ProcessingRecord[]> {
    const results: ProcessingRecord[] = [];

    for (const record of this.records.values()) {
      if (filter) {
        if (filter.businessId && record.businessId !== filter.businessId) continue;
        if (filter.status && record.status !== filter.status) continue;
        if (filter.legalBasis && record.legalBasis !== filter.legalBasis) continue;
        if (filter.purpose && !record.purpose.toLowerCase().includes(filter.purpose.toLowerCase()))
          continue;
      }
      results.push(record);
    }

    return results;
  }

  /**
   * Suspend a processing activity (e.g. when consent is revoked).
   *
   * @throws Error if the record is not found or already terminated.
   */
  async suspendRecord(recordId: string): Promise<ProcessingRecord> {
    const existing = this.records.get(recordId);
    if (!existing) {
      throw new Error(`Processing record not found: ${recordId}`);
    }
    if (existing.status === 'terminated') {
      throw new Error(`Cannot suspend a terminated processing record: ${recordId}`);
    }

    return this.updateRecord(recordId, { status: 'suspended' });
  }

  /**
   * Terminate a processing activity permanently.
   *
   * @throws Error if the record is not found.
   */
  async terminateRecord(recordId: string): Promise<ProcessingRecord> {
    const existing = this.records.get(recordId);
    if (!existing) {
      throw new Error(`Processing record not found: ${recordId}`);
    }

    return this.updateRecord(recordId, { status: 'terminated' });
  }
}
