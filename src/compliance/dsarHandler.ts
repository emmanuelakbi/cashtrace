/**
 * DSAR (Data Subject Access Request) Handler for CashTrace Security & Compliance Module.
 *
 * Handles data subject rights under NDPR:
 * - Access requests: view all personal data (Requirement 7.2)
 * - Portability requests: export in machine-readable format (Requirement 7.3)
 * - Erasure requests: delete personal data (Requirement 7.4)
 *
 * @module compliance/dsarHandler
 */

import { randomUUID } from 'node:crypto';
import type {
  DSARRequest,
  DSARType,
  DSARStatus,
  DSARResult,
  StoredDSARRequest,
  UserDataExport,
  DeletionResult,
  ConsentRecord,
} from './types.js';

/**
 * Simulated personal data store for a user.
 * In production this would query actual databases.
 */
export interface UserPersonalData {
  userId: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  financialData?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Data provider interface that the DSAR handler uses to access user data.
 * Allows decoupling from specific storage implementations.
 */
export interface DSARDataProvider {
  getUserPersonalData(userId: string): Promise<UserPersonalData | undefined>;
  getUserConsents(userId: string): Promise<ConsentRecord[]>;
  getUserActivityLog(userId: string): Promise<Record<string, unknown>[]>;
  deleteUserPersonalData(userId: string, retainRequired: boolean): Promise<DeletionResult>;
}

/**
 * In-memory data provider for testing and development.
 */
export class InMemoryDSARDataProvider implements DSARDataProvider {
  private readonly personalData = new Map<string, UserPersonalData>();
  private readonly consents = new Map<string, ConsentRecord[]>();
  private readonly activityLogs = new Map<string, Record<string, unknown>[]>();
  private readonly deletedUsers = new Set<string>();

  setUserPersonalData(userId: string, data: UserPersonalData): void {
    this.personalData.set(userId, data);
  }

  setUserConsents(userId: string, consents: ConsentRecord[]): void {
    this.consents.set(userId, consents);
  }

  setUserActivityLog(userId: string, log: Record<string, unknown>[]): void {
    this.activityLogs.set(userId, log);
  }

  async getUserPersonalData(userId: string): Promise<UserPersonalData | undefined> {
    if (this.deletedUsers.has(userId)) {
      return undefined;
    }
    return this.personalData.get(userId);
  }

  async getUserConsents(userId: string): Promise<ConsentRecord[]> {
    return this.consents.get(userId) ?? [];
  }

  async getUserActivityLog(userId: string): Promise<Record<string, unknown>[]> {
    if (this.deletedUsers.has(userId)) {
      return [];
    }
    return this.activityLogs.get(userId) ?? [];
  }

  async deleteUserPersonalData(userId: string, retainRequired: boolean): Promise<DeletionResult> {
    const data = this.personalData.get(userId);
    const now = new Date();

    if (!data) {
      return {
        userId,
        deletedAt: now,
        fieldsDeleted: [],
        fieldsRetained: [],
      };
    }

    const allFields = Object.keys(data).filter((k) => k !== 'userId');
    const retainedFields: string[] = [];
    const deletedFields: string[] = [];

    for (const field of allFields) {
      if (retainRequired && field === 'financialData') {
        // Financial data must be retained for regulatory compliance
        retainedFields.push(field);
      } else {
        deletedFields.push(field);
      }
    }

    if (!retainRequired) {
      this.personalData.delete(userId);
      this.activityLogs.delete(userId);
    } else {
      // Keep only retained fields
      const retained: UserPersonalData = { userId };
      for (const field of retainedFields) {
        (retained as Record<string, unknown>)[field] = data[field];
      }
      this.personalData.set(userId, retained);
    }

    this.deletedUsers.add(userId);

    return {
      userId,
      deletedAt: now,
      fieldsDeleted: deletedFields,
      fieldsRetained: retainedFields,
      retainedReason:
        retainedFields.length > 0
          ? 'Regulatory compliance requires retention of financial data'
          : undefined,
    };
  }
}

export class DSARHandler {
  /** In-memory request store keyed by request id. */
  private readonly requests = new Map<string, StoredDSARRequest>();
  private readonly dataProvider: DSARDataProvider;

  constructor(dataProvider: DSARDataProvider) {
    this.dataProvider = dataProvider;
  }

  /**
   * Submit a new DSAR request.
   * Validates the request and stores it with 'pending' status.
   *
   * @returns The generated request ID.
   * @throws Error if the request is invalid (missing required fields).
   */
  async submitRequest(request: DSARRequest): Promise<string> {
    if (
      !request.userId ||
      !request.requestType ||
      !request.requestedBy ||
      !request.verificationMethod
    ) {
      throw new Error('SEC_DSAR_INVALID: Missing required fields in DSAR request');
    }

    const validTypes: DSARType[] = ['access', 'portability', 'erasure', 'rectification'];
    if (!validTypes.includes(request.requestType)) {
      throw new Error(`SEC_DSAR_INVALID: Invalid request type: ${request.requestType}`);
    }

    const id = randomUUID();
    const stored: StoredDSARRequest = {
      id,
      userId: request.userId,
      requestType: request.requestType,
      requestedBy: request.requestedBy,
      verificationMethod: request.verificationMethod,
      status: 'pending',
      submittedAt: new Date(),
    };

    this.requests.set(id, stored);
    return id;
  }

  /**
   * Get the current status of a DSAR request.
   *
   * @throws Error if the request ID is not found.
   */
  async getRequestStatus(requestId: string): Promise<DSARStatus> {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`SEC_DSAR_INVALID: Request not found: ${requestId}`);
    }
    return request.status;
  }

  /**
   * Process a pending DSAR request.
   * Dispatches to the appropriate handler based on request type.
   *
   * @throws Error if the request is not found or not in 'pending' status.
   */
  async processRequest(requestId: string): Promise<DSARResult> {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`SEC_DSAR_INVALID: Request not found: ${requestId}`);
    }

    if (request.status !== 'pending') {
      throw new Error(
        `SEC_DSAR_INVALID: Request ${requestId} is not pending (status: ${request.status})`,
      );
    }

    request.status = 'processing';
    request.processedAt = new Date();

    const now = new Date();
    let result: DSARResult;

    switch (request.requestType) {
      case 'access':
      case 'portability': {
        const data = await this.exportUserData(request.userId);
        result = {
          requestId,
          status: 'completed',
          completedAt: now,
          data,
        };
        break;
      }
      case 'erasure': {
        const deletionResult = await this.deleteUserData(request.userId, true);
        result = {
          requestId,
          status: 'completed',
          completedAt: now,
          deletionResult,
        };
        break;
      }
      case 'rectification': {
        // Rectification is acknowledged but requires manual processing
        result = {
          requestId,
          status: 'completed',
          completedAt: now,
        };
        break;
      }
    }

    request.status = 'completed';
    request.completedAt = now;

    return result;
  }

  /**
   * Export all personal data for a user in machine-readable JSON format.
   *
   * Requirement 7.2: Support data subject access requests (view all personal data).
   * Requirement 7.3: Support data portability requests (export in machine-readable format).
   */
  async exportUserData(userId: string): Promise<UserDataExport> {
    const personalData = await this.dataProvider.getUserPersonalData(userId);
    const consents = await this.dataProvider.getUserConsents(userId);
    const activityLog = await this.dataProvider.getUserActivityLog(userId);

    return {
      userId,
      exportedAt: new Date(),
      format: 'json',
      personalData: personalData ? { ...personalData } : {},
      consents,
      activityLog,
    };
  }

  /**
   * Delete personal data for a user.
   *
   * Requirement 7.4: Support right to erasure requests (delete personal data).
   *
   * @param userId - The user whose data should be deleted.
   * @param retainRequired - If true, retain data required by regulation (e.g. financial records).
   */
  async deleteUserData(userId: string, retainRequired: boolean): Promise<DeletionResult> {
    return this.dataProvider.deleteUserPersonalData(userId, retainRequired);
  }
}
