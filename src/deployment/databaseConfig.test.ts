import { describe, expect, it } from 'vitest';

import type { CacheConfig, RdsConfig } from './databaseConfig.js';
import {
  DEFAULT_BACKUP_RETENTION_DAYS,
  isCacheHighAvailability,
  isHighAvailability,
  MAX_BACKUP_RETENTION_DAYS,
  MIN_BACKUP_RETENTION_DAYS,
  VALID_CACHE_NODE_TYPES,
  VALID_DB_ENGINES,
  VALID_DB_VERSIONS,
  VALID_INSTANCE_CLASSES,
  validateCacheConfig,
  validateRdsConfig,
} from './databaseConfig.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRdsConfig(overrides: Partial<RdsConfig> = {}): RdsConfig {
  return {
    instanceClass: 'db.t3.medium',
    engine: 'postgres',
    engineVersion: '16',
    allocatedStorageGb: 100,
    multiAz: true,
    backupRetentionDays: 30,
    enablePitr: true,
    readReplicas: 1,
    region: 'af-south-1',
    encrypted: true,
    ...overrides,
  };
}

function makeCacheConfig(overrides: Partial<CacheConfig> = {}): CacheConfig {
  return {
    nodeType: 'cache.t3.medium',
    numNodes: 3,
    clusterMode: true,
    automaticFailover: true,
    encryptionAtRest: true,
    encryptionInTransit: true,
    region: 'af-south-1',
    ...overrides,
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

describe('constants', () => {
  it('VALID_DB_ENGINES contains only postgres', () => {
    expect(VALID_DB_ENGINES).toEqual(['postgres']);
  });

  it('VALID_DB_VERSIONS contains 14, 15, 16', () => {
    expect(VALID_DB_VERSIONS).toEqual(['14', '15', '16']);
  });

  it('MIN_BACKUP_RETENTION_DAYS is 7', () => {
    expect(MIN_BACKUP_RETENTION_DAYS).toBe(7);
  });

  it('MAX_BACKUP_RETENTION_DAYS is 35', () => {
    expect(MAX_BACKUP_RETENTION_DAYS).toBe(35);
  });

  it('DEFAULT_BACKUP_RETENTION_DAYS is 30', () => {
    expect(DEFAULT_BACKUP_RETENTION_DAYS).toBe(30);
  });

  it('VALID_INSTANCE_CLASSES contains expected classes', () => {
    expect(VALID_INSTANCE_CLASSES).toEqual([
      'db.t3.micro',
      'db.t3.small',
      'db.t3.medium',
      'db.t3.large',
      'db.r5.large',
      'db.r5.xlarge',
    ]);
  });

  it('VALID_CACHE_NODE_TYPES contains expected types', () => {
    expect(VALID_CACHE_NODE_TYPES).toEqual([
      'cache.t3.micro',
      'cache.t3.small',
      'cache.t3.medium',
      'cache.r5.large',
      'cache.r5.xlarge',
    ]);
  });
});

// ─── validateRdsConfig ───────────────────────────────────────────────────────

describe('validateRdsConfig', () => {
  it('returns valid for a correct configuration', () => {
    const result = validateRdsConfig(makeRdsConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects invalid instance class', () => {
    const result = validateRdsConfig(makeRdsConfig({ instanceClass: 'db.m5.large' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Invalid instance class'));
  });

  it('rejects invalid engine', () => {
    const result = validateRdsConfig(makeRdsConfig({ engine: 'mysql' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Invalid engine'));
  });

  it('rejects invalid engine version', () => {
    const result = validateRdsConfig(makeRdsConfig({ engineVersion: '13' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Invalid engine version'));
  });

  it('rejects storage below minimum (20 GB)', () => {
    const result = validateRdsConfig(makeRdsConfig({ allocatedStorageGb: 19 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('between 20 and 65536'));
  });

  it('rejects storage above maximum (65536 GB)', () => {
    const result = validateRdsConfig(makeRdsConfig({ allocatedStorageGb: 65537 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('between 20 and 65536'));
  });

  it('accepts storage at minimum boundary (20 GB)', () => {
    const result = validateRdsConfig(makeRdsConfig({ allocatedStorageGb: 20 }));
    expect(result.valid).toBe(true);
  });

  it('accepts storage at maximum boundary (65536 GB)', () => {
    const result = validateRdsConfig(makeRdsConfig({ allocatedStorageGb: 65536 }));
    expect(result.valid).toBe(true);
  });

  it('rejects backup retention below minimum', () => {
    const result = validateRdsConfig(makeRdsConfig({ backupRetentionDays: 6 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Backup retention'));
  });

  it('rejects backup retention above maximum', () => {
    const result = validateRdsConfig(makeRdsConfig({ backupRetentionDays: 36 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Backup retention'));
  });

  it('accepts backup retention at minimum boundary (7 days)', () => {
    const result = validateRdsConfig(makeRdsConfig({ backupRetentionDays: 7 }));
    expect(result.valid).toBe(true);
  });

  it('accepts backup retention at maximum boundary (35 days)', () => {
    const result = validateRdsConfig(makeRdsConfig({ backupRetentionDays: 35 }));
    expect(result.valid).toBe(true);
  });

  it('rejects negative read replicas', () => {
    const result = validateRdsConfig(makeRdsConfig({ readReplicas: -1 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Read replicas'));
  });

  it('rejects read replicas above 5', () => {
    const result = validateRdsConfig(makeRdsConfig({ readReplicas: 6 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Read replicas'));
  });

  it('accepts 0 read replicas', () => {
    const result = validateRdsConfig(makeRdsConfig({ readReplicas: 0 }));
    expect(result.valid).toBe(true);
  });

  it('accepts 5 read replicas', () => {
    const result = validateRdsConfig(makeRdsConfig({ readReplicas: 5 }));
    expect(result.valid).toBe(true);
  });

  it('rejects non af-south-1 region', () => {
    const result = validateRdsConfig(makeRdsConfig({ region: 'us-east-1' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('af-south-1'));
  });

  it('rejects disabled encryption', () => {
    const result = validateRdsConfig(makeRdsConfig({ encrypted: false }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('encryption must be enabled'));
  });

  it('collects multiple errors at once', () => {
    const result = validateRdsConfig(
      makeRdsConfig({
        instanceClass: 'invalid',
        engine: 'mysql',
        engineVersion: '10',
        allocatedStorageGb: 5,
        backupRetentionDays: 1,
        readReplicas: 10,
        region: 'eu-west-1',
        encrypted: false,
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(8);
  });

  it('accepts all valid instance classes', () => {
    for (const cls of VALID_INSTANCE_CLASSES) {
      const result = validateRdsConfig(makeRdsConfig({ instanceClass: cls }));
      expect(result.valid).toBe(true);
    }
  });

  it('accepts all valid engine versions', () => {
    for (const ver of VALID_DB_VERSIONS) {
      const result = validateRdsConfig(makeRdsConfig({ engineVersion: ver }));
      expect(result.valid).toBe(true);
    }
  });
});

// ─── validateCacheConfig ─────────────────────────────────────────────────────

describe('validateCacheConfig', () => {
  it('returns valid for a correct configuration', () => {
    const result = validateCacheConfig(makeCacheConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects invalid node type', () => {
    const result = validateCacheConfig(makeCacheConfig({ nodeType: 'cache.m5.large' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Invalid node type'));
  });

  it('rejects numNodes below 1', () => {
    const result = validateCacheConfig(makeCacheConfig({ numNodes: 0 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('between 1 and 6'));
  });

  it('rejects numNodes above 6', () => {
    const result = validateCacheConfig(makeCacheConfig({ numNodes: 7 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('between 1 and 6'));
  });

  it('accepts numNodes at minimum boundary (1)', () => {
    const result = validateCacheConfig(
      makeCacheConfig({ numNodes: 1, clusterMode: false, automaticFailover: false }),
    );
    expect(result.valid).toBe(true);
  });

  it('accepts numNodes at maximum boundary (6)', () => {
    const result = validateCacheConfig(makeCacheConfig({ numNodes: 6 }));
    expect(result.valid).toBe(true);
  });

  it('rejects cluster mode with fewer than 2 nodes', () => {
    const result = validateCacheConfig(
      makeCacheConfig({ clusterMode: true, numNodes: 1, automaticFailover: false }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('Cluster mode requires at least 2 nodes'),
    );
  });

  it('rejects automatic failover with fewer than 2 nodes', () => {
    const result = validateCacheConfig(
      makeCacheConfig({ automaticFailover: true, numNodes: 1, clusterMode: false }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('Automatic failover requires at least 2 nodes'),
    );
  });

  it('rejects disabled encryption at rest', () => {
    const result = validateCacheConfig(makeCacheConfig({ encryptionAtRest: false }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('Encryption at rest must be enabled'),
    );
  });

  it('rejects disabled encryption in transit', () => {
    const result = validateCacheConfig(makeCacheConfig({ encryptionInTransit: false }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('Encryption in transit must be enabled'),
    );
  });

  it('rejects non af-south-1 region', () => {
    const result = validateCacheConfig(makeCacheConfig({ region: 'us-west-2' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('af-south-1'));
  });

  it('collects multiple errors at once', () => {
    const result = validateCacheConfig(
      makeCacheConfig({
        nodeType: 'invalid',
        numNodes: 0,
        encryptionAtRest: false,
        encryptionInTransit: false,
        region: 'eu-west-1',
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });

  it('accepts all valid cache node types', () => {
    for (const nodeType of VALID_CACHE_NODE_TYPES) {
      const result = validateCacheConfig(makeCacheConfig({ nodeType }));
      expect(result.valid).toBe(true);
    }
  });
});

// ─── isHighAvailability ──────────────────────────────────────────────────────

describe('isHighAvailability', () => {
  it('returns true when multiAz and readReplicas >= 1', () => {
    expect(isHighAvailability(makeRdsConfig({ multiAz: true, readReplicas: 1 }))).toBe(true);
  });

  it('returns true when multiAz and readReplicas is 5', () => {
    expect(isHighAvailability(makeRdsConfig({ multiAz: true, readReplicas: 5 }))).toBe(true);
  });

  it('returns false when multiAz is false', () => {
    expect(isHighAvailability(makeRdsConfig({ multiAz: false, readReplicas: 2 }))).toBe(false);
  });

  it('returns false when readReplicas is 0', () => {
    expect(isHighAvailability(makeRdsConfig({ multiAz: true, readReplicas: 0 }))).toBe(false);
  });

  it('returns false when both multiAz is false and readReplicas is 0', () => {
    expect(isHighAvailability(makeRdsConfig({ multiAz: false, readReplicas: 0 }))).toBe(false);
  });
});

// ─── isCacheHighAvailability ─────────────────────────────────────────────────

describe('isCacheHighAvailability', () => {
  it('returns true when clusterMode, automaticFailover, and numNodes >= 2', () => {
    expect(
      isCacheHighAvailability(
        makeCacheConfig({ clusterMode: true, automaticFailover: true, numNodes: 2 }),
      ),
    ).toBe(true);
  });

  it('returns true with numNodes of 6', () => {
    expect(
      isCacheHighAvailability(
        makeCacheConfig({ clusterMode: true, automaticFailover: true, numNodes: 6 }),
      ),
    ).toBe(true);
  });

  it('returns false when clusterMode is false', () => {
    expect(
      isCacheHighAvailability(
        makeCacheConfig({ clusterMode: false, automaticFailover: true, numNodes: 3 }),
      ),
    ).toBe(false);
  });

  it('returns false when automaticFailover is false', () => {
    expect(
      isCacheHighAvailability(
        makeCacheConfig({ clusterMode: true, automaticFailover: false, numNodes: 3 }),
      ),
    ).toBe(false);
  });

  it('returns false when numNodes is 1', () => {
    expect(
      isCacheHighAvailability(
        makeCacheConfig({ clusterMode: true, automaticFailover: true, numNodes: 1 }),
      ),
    ).toBe(false);
  });

  it('returns false when all conditions are unmet', () => {
    expect(
      isCacheHighAvailability(
        makeCacheConfig({ clusterMode: false, automaticFailover: false, numNodes: 1 }),
      ),
    ).toBe(false);
  });
});
