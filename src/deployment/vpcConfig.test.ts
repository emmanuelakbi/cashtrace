import { describe, expect, it } from 'vitest';

import { makeNetworkConfig } from './testHelpers.js';
import type { VpcConfig } from './vpcConfig.js';
import {
  AF_SOUTH_1_AZS,
  ALLOWED_REGIONS,
  CIDR_PATTERN,
  MIN_AVAILABILITY_ZONES,
  validateCidr,
  validateRegion,
  validateVpcConfig,
} from './vpcConfig.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeVpcConfig(overrides: Partial<VpcConfig> = {}): VpcConfig {
  return {
    region: 'af-south-1',
    networkConfig: makeNetworkConfig(),
    enableFlowLogs: true,
    enableNatGateway: true,
    ...overrides,
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

describe('constants', () => {
  it('ALLOWED_REGIONS contains only af-south-1', () => {
    expect(ALLOWED_REGIONS).toEqual(['af-south-1']);
  });

  it('MIN_AVAILABILITY_ZONES is 2', () => {
    expect(MIN_AVAILABILITY_ZONES).toBe(2);
  });

  it('AF_SOUTH_1_AZS contains three zones', () => {
    expect(AF_SOUTH_1_AZS).toEqual(['af-south-1a', 'af-south-1b', 'af-south-1c']);
  });

  it('CIDR_PATTERN matches valid CIDR notation', () => {
    expect(CIDR_PATTERN.test('10.0.0.0/16')).toBe(true);
    expect(CIDR_PATTERN.test('not-a-cidr')).toBe(false);
  });
});

// ─── validateCidr ────────────────────────────────────────────────────────────

describe('validateCidr', () => {
  it('returns true for valid CIDR with /16 prefix', () => {
    expect(validateCidr('10.0.0.0/16')).toBe(true);
  });

  it('returns true for valid CIDR with /28 prefix', () => {
    expect(validateCidr('10.0.1.0/28')).toBe(true);
  });

  it('returns true for valid CIDR with /24 prefix', () => {
    expect(validateCidr('192.168.0.0/24')).toBe(true);
  });

  it('returns false for prefix smaller than /16', () => {
    expect(validateCidr('10.0.0.0/8')).toBe(false);
  });

  it('returns false for prefix larger than /28', () => {
    expect(validateCidr('10.0.0.0/30')).toBe(false);
  });

  it('returns false for invalid format', () => {
    expect(validateCidr('not-a-cidr')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(validateCidr('')).toBe(false);
  });

  it('returns false for missing prefix', () => {
    expect(validateCidr('10.0.0.0')).toBe(false);
  });
});

// ─── validateRegion ──────────────────────────────────────────────────────────

describe('validateRegion', () => {
  it('returns true for af-south-1', () => {
    expect(validateRegion('af-south-1')).toBe(true);
  });

  it('returns false for us-east-1', () => {
    expect(validateRegion('us-east-1')).toBe(false);
  });

  it('returns false for eu-west-1', () => {
    expect(validateRegion('eu-west-1')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(validateRegion('')).toBe(false);
  });
});

// ─── validateVpcConfig ───────────────────────────────────────────────────────

describe('validateVpcConfig', () => {
  it('returns valid for a correct configuration', () => {
    const result = validateVpcConfig(makeVpcConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns valid with three AZs and matching subnets', () => {
    const result = validateVpcConfig(
      makeVpcConfig({
        networkConfig: makeNetworkConfig({
          availabilityZones: ['af-south-1a', 'af-south-1b', 'af-south-1c'],
          publicSubnets: ['10.0.1.0/24', '10.0.2.0/24', '10.0.3.0/24'],
          privateSubnets: ['10.0.10.0/24', '10.0.11.0/24', '10.0.12.0/24'],
        }),
      }),
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects invalid region', () => {
    const result = validateVpcConfig(makeVpcConfig({ region: 'us-east-1' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Invalid region'));
  });

  it('rejects invalid VPC CIDR', () => {
    const result = validateVpcConfig(
      makeVpcConfig({
        networkConfig: makeNetworkConfig({ vpcCidr: 'bad-cidr' }),
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Invalid VPC CIDR'));
  });

  it('rejects fewer than MIN_AVAILABILITY_ZONES AZs', () => {
    const result = validateVpcConfig(
      makeVpcConfig({
        networkConfig: makeNetworkConfig({
          availabilityZones: ['af-south-1a'],
          publicSubnets: ['10.0.1.0/24'],
          privateSubnets: ['10.0.10.0/24'],
        }),
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('at least 2 availability zones'));
  });

  it('rejects invalid availability zones', () => {
    const result = validateVpcConfig(
      makeVpcConfig({
        networkConfig: makeNetworkConfig({
          availabilityZones: ['af-south-1a', 'us-east-1a'],
        }),
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('Invalid availability zone "us-east-1a"'),
    );
  });

  it('rejects empty public subnets', () => {
    const result = validateVpcConfig(
      makeVpcConfig({
        networkConfig: makeNetworkConfig({
          publicSubnets: [],
        }),
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('at least one public subnet'));
  });

  it('rejects empty private subnets', () => {
    const result = validateVpcConfig(
      makeVpcConfig({
        networkConfig: makeNetworkConfig({
          privateSubnets: [],
        }),
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('at least one private subnet'));
  });

  it('rejects invalid public subnet CIDRs', () => {
    const result = validateVpcConfig(
      makeVpcConfig({
        networkConfig: makeNetworkConfig({
          publicSubnets: ['bad-cidr', '10.0.2.0/24'],
        }),
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('Invalid public subnet CIDR "bad-cidr"'),
    );
  });

  it('rejects invalid private subnet CIDRs', () => {
    const result = validateVpcConfig(
      makeVpcConfig({
        networkConfig: makeNetworkConfig({
          privateSubnets: ['10.0.10.0/24', 'invalid'],
        }),
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('Invalid private subnet CIDR "invalid"'),
    );
  });

  it('rejects mismatched public subnet count vs AZ count', () => {
    const result = validateVpcConfig(
      makeVpcConfig({
        networkConfig: makeNetworkConfig({
          availabilityZones: ['af-south-1a', 'af-south-1b'],
          publicSubnets: ['10.0.1.0/24'],
          privateSubnets: ['10.0.10.0/24', '10.0.11.0/24'],
        }),
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('Number of public subnets (1) must match number of AZs (2)'),
    );
  });

  it('rejects mismatched private subnet count vs AZ count', () => {
    const result = validateVpcConfig(
      makeVpcConfig({
        networkConfig: makeNetworkConfig({
          availabilityZones: ['af-south-1a', 'af-south-1b'],
          publicSubnets: ['10.0.1.0/24', '10.0.2.0/24'],
          privateSubnets: ['10.0.10.0/24'],
        }),
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('Number of private subnets (1) must match number of AZs (2)'),
    );
  });

  it('collects multiple errors at once', () => {
    const result = validateVpcConfig(
      makeVpcConfig({
        region: 'eu-west-1',
        networkConfig: makeNetworkConfig({
          vpcCidr: 'bad',
          availabilityZones: ['us-east-1a'],
          publicSubnets: [],
          privateSubnets: [],
        }),
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});
