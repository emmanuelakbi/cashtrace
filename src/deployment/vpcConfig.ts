/**
 * VPC network configuration validation for Africa (Cape Town) region.
 *
 * Provides pure functions to validate VPC configurations, CIDR blocks,
 * and region constraints for Nigerian data residency compliance.
 * Supports Requirements 4.1 (infrastructure provisioning) and 4.3 (data residency).
 *
 * @module deployment/vpcConfig
 */

import type { NetworkConfig } from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Allowed AWS regions — only Africa (Cape Town) for data residency. */
export const ALLOWED_REGIONS = ['af-south-1'] as const;

/** Minimum number of availability zones for high availability. */
export const MIN_AVAILABILITY_ZONES = 2;

/** Basic CIDR notation format pattern. */
export const CIDR_PATTERN = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;

/** Valid availability zones in the af-south-1 region. */
export const AF_SOUTH_1_AZS = ['af-south-1a', 'af-south-1b', 'af-south-1c'] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Result of validating a VPC configuration. */
export interface VpcValidationResult {
  /** Whether the configuration is valid. */
  valid: boolean;
  /** Validation errors (empty when valid). */
  errors: string[];
}

/** Complete VPC configuration for a deployment. */
export interface VpcConfig {
  /** AWS region for the VPC. */
  region: string;
  /** Network configuration (subnets, CIDRs, AZs). */
  networkConfig: NetworkConfig;
  /** Whether to enable VPC flow logs. */
  enableFlowLogs: boolean;
  /** Whether to enable a NAT gateway for private subnets. */
  enableNatGateway: boolean;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a CIDR block string.
 *
 * Returns `true` if the CIDR matches the expected format and the
 * prefix length is between /16 and /28 (inclusive).
 */
export function validateCidr(cidr: string): boolean {
  if (!CIDR_PATTERN.test(cidr)) {
    return false;
  }

  const prefixStr = cidr.split('/')[1];
  if (prefixStr === undefined) {
    return false;
  }

  const prefix = parseInt(prefixStr, 10);
  return prefix >= 16 && prefix <= 28;
}

/**
 * Validate that a region is in the allowed list.
 *
 * Only `af-south-1` (Africa Cape Town) is permitted for
 * Nigerian data residency compliance.
 */
export function validateRegion(region: string): boolean {
  return (ALLOWED_REGIONS as readonly string[]).includes(region);
}

/**
 * Validate a complete VPC configuration.
 *
 * Checks:
 * - Region must be in ALLOWED_REGIONS
 * - VPC CIDR must be a valid CIDR block
 * - At least MIN_AVAILABILITY_ZONES availability zones
 * - All AZs must be valid af-south-1 zones
 * - At least one public and one private subnet
 * - All subnets must be valid CIDR blocks
 * - Number of public subnets must match number of AZs
 * - Number of private subnets must match number of AZs
 */
export function validateVpcConfig(config: VpcConfig): VpcValidationResult {
  const errors: string[] = [];

  if (!validateRegion(config.region)) {
    errors.push(`Invalid region "${config.region}". Must be one of: ${ALLOWED_REGIONS.join(', ')}`);
  }

  if (!validateCidr(config.networkConfig.vpcCidr)) {
    errors.push(
      `Invalid VPC CIDR "${config.networkConfig.vpcCidr}". Must be valid CIDR with prefix /16–/28`,
    );
  }

  const { availabilityZones, publicSubnets, privateSubnets } = config.networkConfig;

  if (availabilityZones.length < MIN_AVAILABILITY_ZONES) {
    errors.push(
      `Must have at least ${MIN_AVAILABILITY_ZONES} availability zones, got ${availabilityZones.length}`,
    );
  }

  for (const az of availabilityZones) {
    if (!(AF_SOUTH_1_AZS as readonly string[]).includes(az)) {
      errors.push(
        `Invalid availability zone "${az}". Must be one of: ${AF_SOUTH_1_AZS.join(', ')}`,
      );
    }
  }

  if (publicSubnets.length === 0) {
    errors.push('Must have at least one public subnet');
  }

  if (privateSubnets.length === 0) {
    errors.push('Must have at least one private subnet');
  }

  for (const subnet of publicSubnets) {
    if (!validateCidr(subnet)) {
      errors.push(`Invalid public subnet CIDR "${subnet}"`);
    }
  }

  for (const subnet of privateSubnets) {
    if (!validateCidr(subnet)) {
      errors.push(`Invalid private subnet CIDR "${subnet}"`);
    }
  }

  if (publicSubnets.length !== availabilityZones.length) {
    errors.push(
      `Number of public subnets (${publicSubnets.length}) must match number of AZs (${availabilityZones.length})`,
    );
  }

  if (privateSubnets.length !== availabilityZones.length) {
    errors.push(
      `Number of private subnets (${privateSubnets.length}) must match number of AZs (${availabilityZones.length})`,
    );
  }

  return { valid: errors.length === 0, errors };
}
