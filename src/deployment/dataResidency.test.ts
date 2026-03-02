import { describe, expect, it } from 'vitest';

import type { DataFlowRecord, DataResidencyConfig } from './dataResidency.js';
import {
  checkResidencyGuardrail,
  COMPLIANT_BACKUP_REGIONS,
  COMPLIANT_REGIONS,
  DATA_CLASSIFICATION_LEVELS,
  isCompliantBackupRegion,
  isCompliantRegion,
  NON_COMPLIANT_REGIONS,
  validateDataFlow,
  validateDataResidencyConfig,
} from './dataResidency.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<DataResidencyConfig> = {}): DataResidencyConfig {
  return {
    primaryRegion: 'af-south-1',
    backupRegions: ['af-south-1'],
    dataClassification: 'confidential',
    encryptionRequired: true,
    ...overrides,
  };
}

function makeFlow(overrides: Partial<DataFlowRecord> = {}): DataFlowRecord {
  return {
    sourceRegion: 'af-south-1',
    destinationRegion: 'af-south-1',
    dataClassification: 'confidential',
    purpose: 'backup',
    encrypted: true,
    ...overrides,
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

describe('constants', () => {
  it('COMPLIANT_REGIONS contains af-south-1', () => {
    expect(COMPLIANT_REGIONS).toContain('af-south-1');
  });

  it('COMPLIANT_BACKUP_REGIONS contains af-south-1 and eu-west-1', () => {
    expect(COMPLIANT_BACKUP_REGIONS).toContain('af-south-1');
    expect(COMPLIANT_BACKUP_REGIONS).toContain('eu-west-1');
  });

  it('NON_COMPLIANT_REGIONS contains expected regions', () => {
    expect(NON_COMPLIANT_REGIONS).toContain('us-east-1');
    expect(NON_COMPLIANT_REGIONS).toContain('us-west-2');
    expect(NON_COMPLIANT_REGIONS).toContain('ap-southeast-1');
  });

  it('DATA_CLASSIFICATION_LEVELS has four levels', () => {
    expect(DATA_CLASSIFICATION_LEVELS).toEqual([
      'public',
      'internal',
      'confidential',
      'restricted',
    ]);
  });
});

// ─── isCompliantRegion ──────────────────────────────────────────────────────

describe('isCompliantRegion', () => {
  it('returns true for af-south-1', () => {
    expect(isCompliantRegion('af-south-1')).toBe(true);
  });

  it('returns false for us-east-1', () => {
    expect(isCompliantRegion('us-east-1')).toBe(false);
  });

  it('returns false for eu-west-1', () => {
    expect(isCompliantRegion('eu-west-1')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isCompliantRegion('')).toBe(false);
  });
});

// ─── isCompliantBackupRegion ────────────────────────────────────────────────

describe('isCompliantBackupRegion', () => {
  it('returns true for af-south-1', () => {
    expect(isCompliantBackupRegion('af-south-1')).toBe(true);
  });

  it('returns true for eu-west-1', () => {
    expect(isCompliantBackupRegion('eu-west-1')).toBe(true);
  });

  it('returns false for us-east-1', () => {
    expect(isCompliantBackupRegion('us-east-1')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isCompliantBackupRegion('')).toBe(false);
  });
});

// ─── validateDataResidencyConfig ────────────────────────────────────────────

describe('validateDataResidencyConfig', () => {
  it('returns valid for a correct configuration', () => {
    const result = validateDataResidencyConfig(makeConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects non-compliant primary region', () => {
    const result = validateDataResidencyConfig(makeConfig({ primaryRegion: 'us-east-1' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('primaryRegion'));
  });

  it('rejects non-compliant backup region', () => {
    const result = validateDataResidencyConfig(
      makeConfig({ backupRegions: ['af-south-1', 'us-west-2'] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('us-west-2'));
  });

  it('accepts eu-west-1 as a backup region', () => {
    const result = validateDataResidencyConfig(
      makeConfig({ backupRegions: ['af-south-1', 'eu-west-1'] }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects invalid data classification', () => {
    const result = validateDataResidencyConfig(makeConfig({ dataClassification: 'top-secret' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('dataClassification'));
  });

  it('rejects encryption not required for confidential data', () => {
    const result = validateDataResidencyConfig(
      makeConfig({ dataClassification: 'confidential', encryptionRequired: false }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('encryptionRequired'));
  });

  it('rejects encryption not required for restricted data', () => {
    const result = validateDataResidencyConfig(
      makeConfig({ dataClassification: 'restricted', encryptionRequired: false }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('encryptionRequired'));
  });

  it('allows encryption not required for public data', () => {
    const result = validateDataResidencyConfig(
      makeConfig({ dataClassification: 'public', encryptionRequired: false }),
    );
    expect(result.valid).toBe(true);
  });

  it('allows encryption not required for internal data', () => {
    const result = validateDataResidencyConfig(
      makeConfig({ dataClassification: 'internal', encryptionRequired: false }),
    );
    expect(result.valid).toBe(true);
  });

  it('accepts empty backup regions array', () => {
    const result = validateDataResidencyConfig(makeConfig({ backupRegions: [] }));
    expect(result.valid).toBe(true);
  });

  it('collects multiple errors at once', () => {
    const result = validateDataResidencyConfig(
      makeConfig({
        primaryRegion: 'us-east-1',
        backupRegions: ['ap-southeast-1'],
        dataClassification: 'invalid',
        encryptionRequired: false,
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── validateDataFlow ───────────────────────────────────────────────────────

describe('validateDataFlow', () => {
  it('returns valid for a compliant flow', () => {
    const result = validateDataFlow(makeFlow());
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('rejects non-compliant source region', () => {
    const result = validateDataFlow(makeFlow({ sourceRegion: 'us-east-1' }));
    expect(result.valid).toBe(false);
    expect(result.violations).toContainEqual(expect.stringContaining('source region'));
  });

  it('rejects non-compliant destination region', () => {
    const result = validateDataFlow(makeFlow({ destinationRegion: 'us-west-2' }));
    expect(result.valid).toBe(false);
    expect(result.violations).toContainEqual(expect.stringContaining('destination region'));
  });

  it('allows eu-west-1 as destination', () => {
    const result = validateDataFlow(makeFlow({ destinationRegion: 'eu-west-1' }));
    expect(result.valid).toBe(true);
  });

  it('rejects unencrypted confidential data', () => {
    const result = validateDataFlow(
      makeFlow({ dataClassification: 'confidential', encrypted: false }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toContainEqual(expect.stringContaining('encrypted'));
  });

  it('rejects unencrypted restricted data', () => {
    const result = validateDataFlow(
      makeFlow({ dataClassification: 'restricted', encrypted: false }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toContainEqual(expect.stringContaining('encrypted'));
  });

  it('allows unencrypted public data', () => {
    const result = validateDataFlow(makeFlow({ dataClassification: 'public', encrypted: false }));
    expect(result.valid).toBe(true);
  });

  it('allows unencrypted internal data', () => {
    const result = validateDataFlow(makeFlow({ dataClassification: 'internal', encrypted: false }));
    expect(result.valid).toBe(true);
  });

  it('collects multiple violations', () => {
    const result = validateDataFlow(
      makeFlow({
        sourceRegion: 'us-east-1',
        destinationRegion: 'ap-southeast-1',
        dataClassification: 'restricted',
        encrypted: false,
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBe(3);
  });
});

// ─── checkResidencyGuardrail ────────────────────────────────────────────────

describe('checkResidencyGuardrail', () => {
  it('allows non-public data to compliant region', () => {
    const result = checkResidencyGuardrail('af-south-1', 'confidential');
    expect(result.allowed).toBe(true);
  });

  it('blocks non-public data to non-compliant region', () => {
    const result = checkResidencyGuardrail('us-east-1', 'confidential');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('us-east-1');
  });

  it('blocks internal data to eu-west-1', () => {
    const result = checkResidencyGuardrail('eu-west-1', 'internal');
    expect(result.allowed).toBe(false);
  });

  it('blocks restricted data to non-compliant region', () => {
    const result = checkResidencyGuardrail('ap-southeast-1', 'restricted');
    expect(result.allowed).toBe(false);
  });

  it('allows public data to compliant backup region', () => {
    const result = checkResidencyGuardrail('eu-west-1', 'public');
    expect(result.allowed).toBe(true);
  });

  it('allows public data to af-south-1', () => {
    const result = checkResidencyGuardrail('af-south-1', 'public');
    expect(result.allowed).toBe(true);
  });

  it('blocks public data to non-compliant region', () => {
    const result = checkResidencyGuardrail('us-west-2', 'public');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('us-west-2');
  });
});
