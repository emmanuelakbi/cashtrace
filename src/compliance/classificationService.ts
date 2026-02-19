/**
 * Data Classification Service for CashTrace Security & Compliance Module.
 *
 * Categorizes data fields by sensitivity level and determines encryption
 * requirements based on classification. Supports four classification levels:
 * public, internal, confidential, and restricted.
 *
 * @module compliance/classificationService
 *
 * Requirements: 5.1 (classification levels), 5.2 (encryption requirements)
 */

import type {
  ClassificationLevel,
  ClassificationTag,
  ClassificationTagValidation,
  ClearanceLevel,
  ClassificationAccessDecision,
  DataClassification,
  PIICategory,
  RetentionAction,
  RetentionEvaluation,
  RetentionPolicy,
  UserSecurityContext,
} from './types.js';

/**
 * Encryption requirements per classification level.
 *
 * - public: no encryption required
 * - internal: no encryption required (but recommended)
 * - confidential: encryption required
 * - restricted: encryption required
 */
export interface EncryptionRequirement {
  encryptionRequired: boolean;
  algorithm: string | null;
  minimumKeyLength: number | null;
}

const ENCRYPTION_REQUIREMENTS: Record<ClassificationLevel, EncryptionRequirement> = {
  public: {
    encryptionRequired: false,
    algorithm: null,
    minimumKeyLength: null,
  },
  internal: {
    encryptionRequired: false,
    algorithm: null,
    minimumKeyLength: null,
  },
  confidential: {
    encryptionRequired: true,
    algorithm: 'aes-256-gcm',
    minimumKeyLength: 256,
  },
  restricted: {
    encryptionRequired: true,
    algorithm: 'aes-256-gcm',
    minimumKeyLength: 256,
  },
};

/**
 * Default retention periods (in days) per classification level.
 */
const DEFAULT_RETENTION_DAYS: Record<ClassificationLevel, number> = {
  public: 365,
  internal: 730,
  confidential: 2555, // ~7 years
  restricted: 2555, // ~7 years
};

/**
 * Access control requirements per classification level.
 *
 * - public: any authenticated user
 * - internal: users with 'internal' clearance or higher
 * - confidential: users with 'confidential' clearance or higher
 * - restricted: only users with 'restricted' clearance
 *
 * Requirement 5.3: Apply access control requirements based on classification.
 */
export interface ClassificationAccessRequirement {
  minimumClearance: ClearanceLevel;
  requiresExplicitPermission: boolean;
  description: string;
}

const ACCESS_REQUIREMENTS: Record<ClassificationLevel, ClassificationAccessRequirement> = {
  public: {
    minimumClearance: 'public',
    requiresExplicitPermission: false,
    description: 'Any authenticated user may access public data',
  },
  internal: {
    minimumClearance: 'internal',
    requiresExplicitPermission: false,
    description: 'Users with internal role or higher may access internal data',
  },
  confidential: {
    minimumClearance: 'confidential',
    requiresExplicitPermission: true,
    description: 'Users with specific data access permissions for confidential data',
  },
  restricted: {
    minimumClearance: 'restricted',
    requiresExplicitPermission: true,
    description: 'Only users with explicit restricted data access',
  },
};

/**
 * Retention policies per classification level.
 *
 * - public: 1 year active, no archive, can be deleted early
 * - internal: 2 years active, no archive
 * - confidential: 3 years active, 4 years archive (7 years total per Nigerian regulations)
 * - restricted: 3 years active, 4 years archive (7 years total), no early deletion
 *
 * Requirement 5.4: Apply retention requirements based on classification.
 */
const RETENTION_POLICIES: Record<ClassificationLevel, RetentionPolicy> = {
  public: {
    classification: 'public',
    activeRetentionDays: 365,
    archiveRetentionDays: 0,
    totalRetentionDays: 365,
    allowEarlyDeletion: true,
    description: 'Public data retained for 1 year; may be deleted early',
  },
  internal: {
    classification: 'internal',
    activeRetentionDays: 730,
    archiveRetentionDays: 0,
    totalRetentionDays: 730,
    allowEarlyDeletion: false,
    description: 'Internal data retained for 2 years',
  },
  confidential: {
    classification: 'confidential',
    activeRetentionDays: 1095,
    archiveRetentionDays: 1460,
    totalRetentionDays: 2555,
    allowEarlyDeletion: false,
    description: 'Confidential data: 3 years active, 4 years archived (~7 years total)',
  },
  restricted: {
    classification: 'restricted',
    activeRetentionDays: 1095,
    archiveRetentionDays: 1460,
    totalRetentionDays: 2555,
    allowEarlyDeletion: false,
    description: 'Restricted data: 3 years active, 4 years archived (~7 years total)',
  },
};

/**
 * Classification levels ordered from least to most sensitive.
 */
const CLASSIFICATION_HIERARCHY: readonly ClassificationLevel[] = [
  'public',
  'internal',
  'confidential',
  'restricted',
] as const;

export class ClassificationService {
  /**
   * Classify a data field and return its full classification metadata,
   * including encryption requirements and default retention period.
   */
  classifyField(
    fieldName: string,
    classification: ClassificationLevel,
    piiCategory?: PIICategory,
  ): DataClassification {
    const encryptionReq = this.getEncryptionRequirement(classification);
    const retentionPeriod = DEFAULT_RETENTION_DAYS[classification];

    return {
      fieldName,
      classification,
      encryptionRequired: encryptionReq.encryptionRequired,
      retentionPeriod,
      piiCategory,
    };
  }

  /**
   * Get the encryption requirement for a given classification level.
   */
  getEncryptionRequirement(level: ClassificationLevel): EncryptionRequirement {
    return ENCRYPTION_REQUIREMENTS[level];
  }

  /**
   * Check whether a given classification level requires encryption.
   */
  isEncryptionRequired(level: ClassificationLevel): boolean {
    return ENCRYPTION_REQUIREMENTS[level].encryptionRequired;
  }

  /**
   * Return all valid classification levels in order from least to most sensitive.
   */
  getClassificationLevels(): readonly ClassificationLevel[] {
    return CLASSIFICATION_HIERARCHY;
  }

  /**
   * Compare two classification levels.
   * Returns a negative number if `a` is less sensitive than `b`,
   * zero if equal, positive if `a` is more sensitive.
   */
  compareClassificationLevels(a: ClassificationLevel, b: ClassificationLevel): number {
    return CLASSIFICATION_HIERARCHY.indexOf(a) - CLASSIFICATION_HIERARCHY.indexOf(b);
  }

  /**
   * Validate that a proposed classification change is not a downgrade.
   * Returns true if the change is allowed (same level or upgrade).
   * Returns false if it would be a downgrade (requires approval).
   *
   * Requirement 5.6: Prevent downgrading of classification without approval.
   */
  isClassificationChangeAllowed(
    currentLevel: ClassificationLevel,
    proposedLevel: ClassificationLevel,
  ): boolean {
    return this.compareClassificationLevels(proposedLevel, currentLevel) >= 0;
  }

  /**
   * Get the default retention period in days for a classification level.
   */
  getDefaultRetentionDays(level: ClassificationLevel): number {
    return DEFAULT_RETENTION_DAYS[level];
  }

  /**
   * Get the access control requirement for a given classification level.
   *
   * Requirement 5.3: Apply access control requirements based on classification.
   */
  getAccessRequirement(level: ClassificationLevel): ClassificationAccessRequirement {
    return ACCESS_REQUIREMENTS[level];
  }

  /**
   * Check whether a user has sufficient clearance to access data at the given
   * classification level.
   *
   * Access rules:
   * - User must be authenticated
   * - User's clearance level must be >= the data's classification level
   * - For confidential/restricted data, user must also have explicit permission
   *   ('access:confidential_data' or 'access:restricted_data')
   *
   * Requirement 5.3: Apply access control requirements based on classification.
   */
  checkAccess(
    user: UserSecurityContext,
    dataClassification: ClassificationLevel,
  ): ClassificationAccessDecision {
    const requirement = ACCESS_REQUIREMENTS[dataClassification];

    // Must be authenticated
    if (!user.authenticated) {
      return {
        allowed: false,
        reason: 'User is not authenticated',
        requiredClearance: requirement.minimumClearance,
        userClearance: user.clearanceLevel,
      };
    }

    // Check clearance level
    const userClearanceIndex = CLASSIFICATION_HIERARCHY.indexOf(user.clearanceLevel);
    const requiredIndex = CLASSIFICATION_HIERARCHY.indexOf(requirement.minimumClearance);

    if (userClearanceIndex < requiredIndex) {
      return {
        allowed: false,
        reason: `Insufficient clearance: requires '${requirement.minimumClearance}' but user has '${user.clearanceLevel}'`,
        requiredClearance: requirement.minimumClearance,
        userClearance: user.clearanceLevel,
      };
    }

    // For confidential/restricted, check explicit permission
    if (requirement.requiresExplicitPermission) {
      const requiredPermission = `access:${dataClassification}_data`;
      if (!user.permissions.includes(requiredPermission)) {
        return {
          allowed: false,
          reason: `Missing required permission: '${requiredPermission}'`,
          requiredClearance: requirement.minimumClearance,
          userClearance: user.clearanceLevel,
        };
      }
    }

    return {
      allowed: true,
      reason: requirement.description,
      requiredClearance: requirement.minimumClearance,
      userClearance: user.clearanceLevel,
    };
  }

  /**
   * Get the full retention policy for a classification level.
   *
   * Requirement 5.4: Apply retention requirements based on classification.
   */
  getRetentionPolicy(level: ClassificationLevel): RetentionPolicy {
    return RETENTION_POLICIES[level];
  }

  /**
   * Evaluate what retention action should be taken for data of a given
   * classification and age.
   *
   * - retain: data is within active retention period
   * - archive: data is past active retention but within total retention
   * - delete: data is past total retention period
   *
   * Requirement 5.4: Apply retention requirements based on classification.
   */
  evaluateRetention(classification: ClassificationLevel, dataAgeDays: number): RetentionEvaluation {
    const policy = RETENTION_POLICIES[classification];

    let action: RetentionAction;
    let reason: string;

    if (dataAgeDays <= policy.activeRetentionDays) {
      action = 'retain';
      reason = `Data is within active retention period (${policy.activeRetentionDays} days)`;
    } else if (dataAgeDays <= policy.totalRetentionDays && policy.archiveRetentionDays > 0) {
      action = 'archive';
      reason = `Data is past active retention but within archive period (${policy.totalRetentionDays} days total)`;
    } else if (dataAgeDays > policy.totalRetentionDays) {
      action = 'delete';
      reason = `Data has exceeded total retention period of ${policy.totalRetentionDays} days`;
    } else {
      // Past active retention with no archive period — eligible for deletion
      action = 'delete';
      reason = `Data has exceeded retention period of ${policy.totalRetentionDays} days`;
    }

    return {
      action,
      classification,
      dataAgeDays,
      policy,
      reason,
    };
  }

  /**
   * Create a classification tag for a data field.
   * Tags include classification level, encryption requirement, retention period,
   * timestamp, and who applied the tag.
   *
   * Requirement 5.5: Tag all data with classification metadata.
   */
  createClassificationTag(
    fieldName: string,
    classification: ClassificationLevel,
    taggedBy: string,
  ): ClassificationTag {
    const encryptionReq = this.getEncryptionRequirement(classification);
    const retentionDays = DEFAULT_RETENTION_DAYS[classification];

    return {
      fieldName,
      classification,
      encryptionRequired: encryptionReq.encryptionRequired,
      retentionDays,
      taggedAt: new Date(),
      taggedBy,
    };
  }

  /**
   * Validate that a data record has proper classification tags for all
   * expected fields. Returns which fields are missing tags.
   *
   * Requirement 5.5: Tag all data with classification metadata.
   */
  validateClassificationTags(
    tags: ClassificationTag[],
    expectedFields: string[],
  ): ClassificationTagValidation {
    const taggedFields = new Set(tags.map((t) => t.fieldName));
    const missingFields = expectedFields.filter((f) => !taggedFields.has(f));

    return {
      valid: missingFields.length === 0,
      missingFields,
    };
  }

  /**
   * Bulk-tag multiple fields with classification metadata.
   * Each entry maps a field name to its classification level.
   *
   * Requirement 5.5: Tag all data with classification metadata.
   */
  bulkTag(fields: Record<string, ClassificationLevel>, taggedBy: string): ClassificationTag[] {
    return Object.entries(fields).map(([fieldName, classification]) =>
      this.createClassificationTag(fieldName, classification, taggedBy),
    );
  }
}
