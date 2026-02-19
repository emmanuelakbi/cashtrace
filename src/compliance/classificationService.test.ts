import { describe, it, expect, beforeEach } from 'vitest';
import { ClassificationService } from './classificationService.js';
import type { ClassificationLevel, ClassificationTag, PIICategory } from './types.js';

describe('ClassificationService', () => {
  let service: ClassificationService;

  beforeEach(() => {
    service = new ClassificationService();
  });

  describe('getClassificationLevels', () => {
    it('should return all four classification levels in sensitivity order', () => {
      const levels = service.getClassificationLevels();
      expect(levels).toEqual(['public', 'internal', 'confidential', 'restricted']);
    });
  });

  describe('getEncryptionRequirement', () => {
    it('should not require encryption for public data', () => {
      const req = service.getEncryptionRequirement('public');
      expect(req.encryptionRequired).toBe(false);
      expect(req.algorithm).toBeNull();
      expect(req.minimumKeyLength).toBeNull();
    });

    it('should not require encryption for internal data', () => {
      const req = service.getEncryptionRequirement('internal');
      expect(req.encryptionRequired).toBe(false);
    });

    it('should require AES-256-GCM encryption for confidential data', () => {
      const req = service.getEncryptionRequirement('confidential');
      expect(req.encryptionRequired).toBe(true);
      expect(req.algorithm).toBe('aes-256-gcm');
      expect(req.minimumKeyLength).toBe(256);
    });

    it('should require AES-256-GCM encryption for restricted data', () => {
      const req = service.getEncryptionRequirement('restricted');
      expect(req.encryptionRequired).toBe(true);
      expect(req.algorithm).toBe('aes-256-gcm');
      expect(req.minimumKeyLength).toBe(256);
    });
  });

  describe('isEncryptionRequired', () => {
    it('should return false for public and internal', () => {
      expect(service.isEncryptionRequired('public')).toBe(false);
      expect(service.isEncryptionRequired('internal')).toBe(false);
    });

    it('should return true for confidential and restricted', () => {
      expect(service.isEncryptionRequired('confidential')).toBe(true);
      expect(service.isEncryptionRequired('restricted')).toBe(true);
    });
  });

  describe('classifyField', () => {
    it('should classify a public field with no encryption', () => {
      const result = service.classifyField('companyName', 'public');
      expect(result).toEqual({
        fieldName: 'companyName',
        classification: 'public',
        encryptionRequired: false,
        retentionPeriod: 365,
        piiCategory: undefined,
      });
    });

    it('should classify a confidential PII field with encryption', () => {
      const result = service.classifyField('email', 'confidential', 'contact');
      expect(result).toEqual({
        fieldName: 'email',
        classification: 'confidential',
        encryptionRequired: true,
        retentionPeriod: 2555,
        piiCategory: 'contact',
      });
    });

    it('should classify a restricted financial field with encryption', () => {
      const result = service.classifyField('accountNumber', 'restricted', 'financial');
      expect(result).toEqual({
        fieldName: 'accountNumber',
        classification: 'restricted',
        encryptionRequired: true,
        retentionPeriod: 2555,
        piiCategory: 'financial',
      });
    });

    it('should classify an internal field without PII category', () => {
      const result = service.classifyField('internalNotes', 'internal');
      expect(result.classification).toBe('internal');
      expect(result.encryptionRequired).toBe(false);
      expect(result.piiCategory).toBeUndefined();
    });

    it('should handle all PII categories', () => {
      const categories: PIICategory[] = ['identifier', 'financial', 'contact', 'biometric'];
      for (const cat of categories) {
        const result = service.classifyField('field', 'restricted', cat);
        expect(result.piiCategory).toBe(cat);
      }
    });
  });

  describe('compareClassificationLevels', () => {
    it('should return 0 for equal levels', () => {
      const levels: ClassificationLevel[] = ['public', 'internal', 'confidential', 'restricted'];
      for (const level of levels) {
        expect(service.compareClassificationLevels(level, level)).toBe(0);
      }
    });

    it('should return negative when first is less sensitive', () => {
      expect(service.compareClassificationLevels('public', 'restricted')).toBeLessThan(0);
      expect(service.compareClassificationLevels('internal', 'confidential')).toBeLessThan(0);
    });

    it('should return positive when first is more sensitive', () => {
      expect(service.compareClassificationLevels('restricted', 'public')).toBeGreaterThan(0);
      expect(service.compareClassificationLevels('confidential', 'internal')).toBeGreaterThan(0);
    });
  });

  describe('isClassificationChangeAllowed', () => {
    it('should allow upgrading classification', () => {
      expect(service.isClassificationChangeAllowed('public', 'confidential')).toBe(true);
      expect(service.isClassificationChangeAllowed('internal', 'restricted')).toBe(true);
    });

    it('should allow keeping the same classification', () => {
      expect(service.isClassificationChangeAllowed('confidential', 'confidential')).toBe(true);
    });

    it('should reject downgrading classification', () => {
      expect(service.isClassificationChangeAllowed('restricted', 'public')).toBe(false);
      expect(service.isClassificationChangeAllowed('confidential', 'internal')).toBe(false);
    });
  });

  describe('getDefaultRetentionDays', () => {
    it('should return 365 days for public data', () => {
      expect(service.getDefaultRetentionDays('public')).toBe(365);
    });

    it('should return 730 days for internal data', () => {
      expect(service.getDefaultRetentionDays('internal')).toBe(730);
    });

    it('should return 2555 days (~7 years) for confidential data', () => {
      expect(service.getDefaultRetentionDays('confidential')).toBe(2555);
    });

    it('should return 2555 days (~7 years) for restricted data', () => {
      expect(service.getDefaultRetentionDays('restricted')).toBe(2555);
    });
  });
});

describe('ClassificationService - Retention by Classification', () => {
  let service: ClassificationService;

  beforeEach(() => {
    service = new ClassificationService();
  });

  describe('getRetentionPolicy', () => {
    it('should return a policy allowing early deletion for public data', () => {
      const policy = service.getRetentionPolicy('public');
      expect(policy.classification).toBe('public');
      expect(policy.activeRetentionDays).toBe(365);
      expect(policy.archiveRetentionDays).toBe(0);
      expect(policy.totalRetentionDays).toBe(365);
      expect(policy.allowEarlyDeletion).toBe(true);
    });

    it('should return a 2-year policy for internal data with no archive', () => {
      const policy = service.getRetentionPolicy('internal');
      expect(policy.activeRetentionDays).toBe(730);
      expect(policy.archiveRetentionDays).toBe(0);
      expect(policy.totalRetentionDays).toBe(730);
      expect(policy.allowEarlyDeletion).toBe(false);
    });

    it('should return a 7-year total policy for confidential data with archive', () => {
      const policy = service.getRetentionPolicy('confidential');
      expect(policy.activeRetentionDays).toBe(1095);
      expect(policy.archiveRetentionDays).toBe(1460);
      expect(policy.totalRetentionDays).toBe(2555);
      expect(policy.allowEarlyDeletion).toBe(false);
    });

    it('should return a 7-year total policy for restricted data with archive', () => {
      const policy = service.getRetentionPolicy('restricted');
      expect(policy.activeRetentionDays).toBe(1095);
      expect(policy.archiveRetentionDays).toBe(1460);
      expect(policy.totalRetentionDays).toBe(2555);
      expect(policy.allowEarlyDeletion).toBe(false);
    });

    it('should have totalRetentionDays equal to active + archive for all levels', () => {
      const levels: ClassificationLevel[] = ['public', 'internal', 'confidential', 'restricted'];
      for (const level of levels) {
        const policy = service.getRetentionPolicy(level);
        expect(policy.totalRetentionDays).toBe(
          policy.activeRetentionDays + policy.archiveRetentionDays,
        );
      }
    });
  });

  describe('evaluateRetention', () => {
    it('should retain data within active retention period', () => {
      const result = service.evaluateRetention('confidential', 100);
      expect(result.action).toBe('retain');
    });

    it('should retain data at exactly the active retention boundary', () => {
      const result = service.evaluateRetention('confidential', 1095);
      expect(result.action).toBe('retain');
    });

    it('should archive confidential data past active but within total retention', () => {
      const result = service.evaluateRetention('confidential', 1500);
      expect(result.action).toBe('archive');
    });

    it('should delete data past total retention period', () => {
      const result = service.evaluateRetention('confidential', 2556);
      expect(result.action).toBe('delete');
    });

    it('should delete public data past its 365-day retention (no archive phase)', () => {
      const result = service.evaluateRetention('public', 400);
      expect(result.action).toBe('delete');
    });

    it('should delete internal data past its 730-day retention (no archive phase)', () => {
      const result = service.evaluateRetention('internal', 731);
      expect(result.action).toBe('delete');
    });

    it('should include the policy and classification in the evaluation result', () => {
      const result = service.evaluateRetention('restricted', 50);
      expect(result.classification).toBe('restricted');
      expect(result.dataAgeDays).toBe(50);
      expect(result.policy.classification).toBe('restricted');
    });

    it('should retain brand-new data (age 0) for all levels', () => {
      const levels: ClassificationLevel[] = ['public', 'internal', 'confidential', 'restricted'];
      for (const level of levels) {
        const result = service.evaluateRetention(level, 0);
        expect(result.action).toBe('retain');
      }
    });
  });
});

describe('ClassificationService - Classification Tagging', () => {
  let service: ClassificationService;

  beforeEach(() => {
    service = new ClassificationService();
  });

  describe('createClassificationTag', () => {
    it('should create a tag with correct classification metadata', () => {
      const tag = service.createClassificationTag('email', 'confidential', 'admin@example.com');

      expect(tag.fieldName).toBe('email');
      expect(tag.classification).toBe('confidential');
      expect(tag.encryptionRequired).toBe(true);
      expect(tag.retentionDays).toBe(2555);
      expect(tag.taggedBy).toBe('admin@example.com');
      expect(tag.taggedAt).toBeInstanceOf(Date);
    });

    it('should set encryptionRequired to false for public data', () => {
      const tag = service.createClassificationTag('companyName', 'public', 'user1');
      expect(tag.encryptionRequired).toBe(false);
      expect(tag.retentionDays).toBe(365);
    });

    it('should set correct retention for each classification level', () => {
      const levels: [ClassificationLevel, number][] = [
        ['public', 365],
        ['internal', 730],
        ['confidential', 2555],
        ['restricted', 2555],
      ];

      for (const [level, expectedDays] of levels) {
        const tag = service.createClassificationTag('field', level, 'tagger');
        expect(tag.retentionDays).toBe(expectedDays);
      }
    });

    it('should record a timestamp close to now', () => {
      const before = new Date();
      const tag = service.createClassificationTag('field', 'internal', 'tagger');
      const after = new Date();

      expect(tag.taggedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(tag.taggedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('validateClassificationTags', () => {
    it('should return valid when all expected fields are tagged', () => {
      const tags: ClassificationTag[] = [
        service.createClassificationTag('email', 'confidential', 'admin'),
        service.createClassificationTag('name', 'internal', 'admin'),
      ];

      const result = service.validateClassificationTags(tags, ['email', 'name']);
      expect(result.valid).toBe(true);
      expect(result.missingFields).toEqual([]);
    });

    it('should return invalid with missing fields when tags are incomplete', () => {
      const tags: ClassificationTag[] = [
        service.createClassificationTag('email', 'confidential', 'admin'),
      ];

      const result = service.validateClassificationTags(tags, ['email', 'name', 'phone']);
      expect(result.valid).toBe(false);
      expect(result.missingFields).toEqual(['name', 'phone']);
    });

    it('should return valid for empty expected fields', () => {
      const result = service.validateClassificationTags([], []);
      expect(result.valid).toBe(true);
      expect(result.missingFields).toEqual([]);
    });

    it('should return invalid when no tags exist but fields are expected', () => {
      const result = service.validateClassificationTags([], ['email']);
      expect(result.valid).toBe(false);
      expect(result.missingFields).toEqual(['email']);
    });
  });

  describe('bulkTag', () => {
    it('should tag multiple fields at once', () => {
      const tags = service.bulkTag(
        {
          email: 'confidential',
          companyName: 'public',
          accountNumber: 'restricted',
        },
        'admin@example.com',
      );

      expect(tags).toHaveLength(3);

      const emailTag = tags.find((t) => t.fieldName === 'email')!;
      expect(emailTag.classification).toBe('confidential');
      expect(emailTag.encryptionRequired).toBe(true);
      expect(emailTag.taggedBy).toBe('admin@example.com');

      const publicTag = tags.find((t) => t.fieldName === 'companyName')!;
      expect(publicTag.classification).toBe('public');
      expect(publicTag.encryptionRequired).toBe(false);

      const restrictedTag = tags.find((t) => t.fieldName === 'accountNumber')!;
      expect(restrictedTag.classification).toBe('restricted');
      expect(restrictedTag.encryptionRequired).toBe(true);
    });

    it('should return empty array for empty input', () => {
      const tags = service.bulkTag({}, 'admin');
      expect(tags).toEqual([]);
    });

    it('should produce tags that pass validation for the same fields', () => {
      const fields = {
        email: 'confidential' as ClassificationLevel,
        name: 'internal' as ClassificationLevel,
      };
      const tags = service.bulkTag(fields, 'admin');
      const validation = service.validateClassificationTags(tags, Object.keys(fields));
      expect(validation.valid).toBe(true);
    });
  });
});
