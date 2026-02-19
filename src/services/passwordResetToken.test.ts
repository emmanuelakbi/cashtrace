/**
 * Unit tests for password reset token generation and validation.
 *
 * These tests verify the generateResetToken and validateResetToken
 * functions from the password service. Since these functions interact
 * with the database, we mock the `query` function from `../utils/db.js`
 * to isolate the unit under test.
 *
 * Requirements tested: 5.1 (secure token generation), 5.2 (1-hour expiration)
 *
 * @module services/passwordResetToken.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { generateResetToken, validateResetToken } from './passwordService.js';

// ─── Mock the database query function ────────────────────────────────────────

vi.mock('../utils/db.js', () => ({
  query: vi.fn(),
}));

// Import the mocked query so we can control its behavior per test
import { query } from '../utils/db.js';
const mockQuery = vi.mocked(query);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('generateResetToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
  });

  it('should return a 64-character hex string (32 bytes)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'INSERT',
      oid: 0,
      fields: [],
    });

    const token = await generateResetToken('user-123');

    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should store the SHA-256 hash of the token in the database, not the raw token', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'INSERT',
      oid: 0,
      fields: [],
    });

    const token = await generateResetToken('user-123');
    const expectedHash = sha256(token);

    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockQuery.mock.calls[0]!;
    expect(sql).toContain('INSERT INTO password_reset_tokens');
    expect(params![0]).toBe('user-123');
    expect(params![1]).toBe(expectedHash);
  });

  it('should set expiration to 1 hour from creation', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'INSERT',
      oid: 0,
      fields: [],
    });

    await generateResetToken('user-123');

    const [, params] = mockQuery.mock.calls[0]!;
    const expiresAt = new Date(params![2] as string);
    const expectedExpiry = new Date('2024-06-15T13:00:00.000Z'); // 1 hour later

    expect(expiresAt.getTime()).toBe(expectedExpiry.getTime());
  });

  it('should generate unique tokens on successive calls', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0, command: 'INSERT', oid: 0, fields: [] });

    const token1 = await generateResetToken('user-123');
    const token2 = await generateResetToken('user-123');

    expect(token1).not.toBe(token2);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

describe('validateResetToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return payload for a valid, non-expired, unused token', async () => {
    const rawToken = 'a'.repeat(64);
    const tokenHash = sha256(rawToken);

    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'token-id-1', user_id: 'user-456' }],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const payload = await validateResetToken(rawToken);

    expect(payload).toEqual({
      userId: 'user-456',
      tokenId: 'token-id-1',
    });

    // Verify the query used the SHA-256 hash
    const [, params] = mockQuery.mock.calls[0]!;
    expect(params![0]).toBe(tokenHash);
  });

  it('should return null when no matching token is found', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const payload = await validateResetToken('nonexistent-token');

    expect(payload).toBeNull();
  });

  it('should query with expires_at > NOW() and used_at IS NULL conditions', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    await validateResetToken('some-token');

    const [sql] = mockQuery.mock.calls[0]!;
    expect(sql).toContain('expires_at > NOW()');
    expect(sql).toContain('used_at IS NULL');
  });

  it('should hash the input token with SHA-256 before querying', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const rawToken = 'my-raw-reset-token';
    const expectedHash = sha256(rawToken);

    await validateResetToken(rawToken);

    const [, params] = mockQuery.mock.calls[0]!;
    expect(params![0]).toBe(expectedHash);
  });
});
