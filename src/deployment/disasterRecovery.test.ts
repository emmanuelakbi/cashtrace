import { describe, expect, it } from 'vitest';

import type { DrConfig } from './disasterRecovery.js';
import {
  BACKUP_VERIFICATION_INTERVAL_DAYS,
  SECONDARY_REGION,
  TARGET_RPO_HOURS,
  TARGET_RTO_HOURS,
  checkBackupVerification,
  meetsRpo,
  meetsRto,
  validateDrConfig,
} from './disasterRecovery.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDrConfig(overrides: Partial<DrConfig> = {}): DrConfig {
  return {
    primaryRegion: 'af-south-1',
    secondaryRegion: 'eu-west-1',
    crossRegionReplication: true,
    rpoHours: 1,
    rtoHours: 4,
    runbookUrl: 'https://runbook.example.com/dr',
    ...overrides,
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

describe('constants', () => {
  it('TARGET_RPO_HOURS is 1', () => {
    expect(TARGET_RPO_HOURS).toBe(1);
  });

  it('TARGET_RTO_HOURS is 4', () => {
    expect(TARGET_RTO_HOURS).toBe(4);
  });

  it('SECONDARY_REGION is eu-west-1', () => {
    expect(SECONDARY_REGION).toBe('eu-west-1');
  });

  it('BACKUP_VERIFICATION_INTERVAL_DAYS is 7', () => {
    expect(BACKUP_VERIFICATION_INTERVAL_DAYS).toBe(7);
  });
});

// ─── validateDrConfig ───────────────────────────────────────────────────────

describe('validateDrConfig', () => {
  it('returns valid for a correct configuration', () => {
    const result = validateDrConfig(makeDrConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects non af-south-1 primaryRegion', () => {
    const result = validateDrConfig(makeDrConfig({ primaryRegion: 'us-east-1' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('primaryRegion must be "af-south-1"'),
    );
  });

  it('rejects empty secondaryRegion', () => {
    const result = validateDrConfig(makeDrConfig({ secondaryRegion: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('secondaryRegion must be non-empty'),
    );
  });

  it('rejects secondaryRegion same as primaryRegion', () => {
    const result = validateDrConfig(
      makeDrConfig({ primaryRegion: 'af-south-1', secondaryRegion: 'af-south-1' }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('secondaryRegion must be different'),
    );
  });

  it('rejects crossRegionReplication = false', () => {
    const result = validateDrConfig(makeDrConfig({ crossRegionReplication: false }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('crossRegionReplication must be true'),
    );
  });

  it('rejects rpoHours exceeding target', () => {
    const result = validateDrConfig(makeDrConfig({ rpoHours: 2 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('rpoHours must be <='));
  });

  it('accepts rpoHours at target', () => {
    const result = validateDrConfig(makeDrConfig({ rpoHours: TARGET_RPO_HOURS }));
    expect(result.valid).toBe(true);
  });

  it('accepts rpoHours below target', () => {
    const result = validateDrConfig(makeDrConfig({ rpoHours: 0.5 }));
    expect(result.valid).toBe(true);
  });

  it('rejects rtoHours exceeding target', () => {
    const result = validateDrConfig(makeDrConfig({ rtoHours: 5 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('rtoHours must be <='));
  });

  it('accepts rtoHours at target', () => {
    const result = validateDrConfig(makeDrConfig({ rtoHours: TARGET_RTO_HOURS }));
    expect(result.valid).toBe(true);
  });

  it('still valid without runbookUrl', () => {
    const result = validateDrConfig(makeDrConfig({ runbookUrl: undefined }));
    expect(result.valid).toBe(true);
  });

  it('collects multiple errors at once', () => {
    const result = validateDrConfig(
      makeDrConfig({
        primaryRegion: 'us-east-1',
        secondaryRegion: '',
        crossRegionReplication: false,
        rpoHours: 10,
        rtoHours: 10,
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── checkBackupVerification ────────────────────────────────────────────────

describe('checkBackupVerification', () => {
  const now = new Date('2024-06-15T12:00:00Z');

  it('returns needsVerification = true when no lastVerification', () => {
    const result = checkBackupVerification(undefined, now);
    expect(result.verified).toBe(false);
    expect(result.needsVerification).toBe(true);
    expect(result.daysSinceVerification).toBe(Infinity);
  });

  it('returns needsVerification = false when verified recently', () => {
    const lastVerification = new Date('2024-06-14T12:00:00Z');
    const result = checkBackupVerification(lastVerification, now);
    expect(result.verified).toBe(true);
    expect(result.daysSinceVerification).toBe(1);
    expect(result.needsVerification).toBe(false);
  });

  it('returns needsVerification = true when verification is overdue', () => {
    const lastVerification = new Date('2024-06-01T12:00:00Z');
    const result = checkBackupVerification(lastVerification, now);
    expect(result.verified).toBe(true);
    expect(result.daysSinceVerification).toBe(14);
    expect(result.needsVerification).toBe(true);
  });

  it('returns needsVerification = true at exactly the interval boundary', () => {
    const lastVerification = new Date('2024-06-08T12:00:00Z');
    const result = checkBackupVerification(lastVerification, now);
    expect(result.verified).toBe(true);
    expect(result.daysSinceVerification).toBe(7);
    expect(result.needsVerification).toBe(true);
  });

  it('returns needsVerification = false one day before interval', () => {
    const lastVerification = new Date('2024-06-09T12:00:00Z');
    const result = checkBackupVerification(lastVerification, now);
    expect(result.verified).toBe(true);
    expect(result.daysSinceVerification).toBe(6);
    expect(result.needsVerification).toBe(false);
  });

  it('uses current time when now is not provided', () => {
    const recentDate = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
    const result = checkBackupVerification(recentDate);
    expect(result.verified).toBe(true);
    expect(result.daysSinceVerification).toBe(0);
    expect(result.needsVerification).toBe(false);
  });
});

// ─── meetsRpo ───────────────────────────────────────────────────────────────

describe('meetsRpo', () => {
  it('returns true when rpoHours equals target', () => {
    expect(meetsRpo(TARGET_RPO_HOURS)).toBe(true);
  });

  it('returns true when rpoHours is below target', () => {
    expect(meetsRpo(0.5)).toBe(true);
  });

  it('returns false when rpoHours exceeds target', () => {
    expect(meetsRpo(2)).toBe(false);
  });
});

// ─── meetsRto ───────────────────────────────────────────────────────────────

describe('meetsRto', () => {
  it('returns true when rtoHours equals target', () => {
    expect(meetsRto(TARGET_RTO_HOURS)).toBe(true);
  });

  it('returns true when rtoHours is below target', () => {
    expect(meetsRto(2)).toBe(true);
  });

  it('returns false when rtoHours exceeds target', () => {
    expect(meetsRto(5)).toBe(false);
  });
});
