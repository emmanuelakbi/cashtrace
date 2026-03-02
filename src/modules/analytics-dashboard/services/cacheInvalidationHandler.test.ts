import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';

import {
  onTransactionCreated,
  onTransactionDeleted,
  onTransactionUpdated,
} from './cacheInvalidationHandler.js';

// Mock the cacheService module so we can verify delegation
vi.mock('./cacheService.js', () => ({
  invalidateAffectedPeriods: vi.fn().mockResolvedValue(undefined),
}));

import { invalidateAffectedPeriods } from './cacheService.js';

const mockRedis = {} as Redis;
const businessId = '550e8400-e29b-41d4-a716-446655440000';
const transactionDate = new Date('2024-06-15T10:30:00Z');

describe('cacheInvalidationHandler', () => {
  it('onTransactionCreated calls invalidateAffectedPeriods with correct args', async () => {
    await onTransactionCreated(mockRedis, businessId, transactionDate);

    expect(invalidateAffectedPeriods).toHaveBeenCalledWith(mockRedis, businessId, transactionDate);
  });

  it('onTransactionUpdated calls invalidateAffectedPeriods with correct args', async () => {
    await onTransactionUpdated(mockRedis, businessId, transactionDate);

    expect(invalidateAffectedPeriods).toHaveBeenCalledWith(mockRedis, businessId, transactionDate);
  });

  it('onTransactionDeleted calls invalidateAffectedPeriods with correct args', async () => {
    await onTransactionDeleted(mockRedis, businessId, transactionDate);

    expect(invalidateAffectedPeriods).toHaveBeenCalledWith(mockRedis, businessId, transactionDate);
  });
});
