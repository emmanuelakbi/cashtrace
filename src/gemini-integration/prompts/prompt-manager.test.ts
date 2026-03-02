import { describe, it, expect, beforeEach, vi } from 'vitest';

import { PromptManagerImpl } from './prompt-manager.js';
import type { PromptType, SystemPrompt } from './prompt-manager.js';

function makePrompt(overrides: Partial<SystemPrompt> = {}): SystemPrompt {
  return {
    type: 'receipt_extraction',
    version: '1.0.0',
    systemInstruction: 'Extract transactions from receipt.',
    exampleOutputs: ['{"transactions":[]}'],
    jsonSchema: { type: 'object' },
    ...overrides,
  };
}

describe('PromptManagerImpl', () => {
  let manager: PromptManagerImpl;

  beforeEach(() => {
    manager = new PromptManagerImpl();
  });

  describe('registerPrompt', () => {
    it('should register a prompt successfully', () => {
      const prompt = makePrompt();
      manager.registerPrompt(prompt, 'Initial version');

      const result = manager.getPrompt('receipt_extraction');
      expect(result).toEqual(prompt);
    });

    it('should set first registered version as active', () => {
      manager.registerPrompt(makePrompt({ version: '1.0.0' }), 'v1');
      manager.registerPrompt(makePrompt({ version: '2.0.0' }), 'v2');

      expect(manager.getActiveVersion('receipt_extraction')).toBe('1.0.0');
    });

    it('should throw when registering duplicate version', () => {
      manager.registerPrompt(makePrompt({ version: '1.0.0' }), 'v1');

      expect(() => manager.registerPrompt(makePrompt({ version: '1.0.0' }), 'v1 dup')).toThrow(
        "Prompt version '1.0.0' already exists for type 'receipt_extraction'",
      );
    });

    it('should support multiple prompt types independently', () => {
      const receipt = makePrompt({ type: 'receipt_extraction', version: '1.0.0' });
      const bank = makePrompt({ type: 'bank_statement_extraction', version: '1.0.0' });

      manager.registerPrompt(receipt, 'Receipt v1');
      manager.registerPrompt(bank, 'Bank v1');

      expect(manager.getPrompt('receipt_extraction')).toEqual(receipt);
      expect(manager.getPrompt('bank_statement_extraction')).toEqual(bank);
    });
  });

  describe('getPrompt', () => {
    it('should return active version when no version specified', () => {
      const prompt = makePrompt({ version: '1.0.0' });
      manager.registerPrompt(prompt, 'v1');

      expect(manager.getPrompt('receipt_extraction')).toEqual(prompt);
    });

    it('should return specific version when requested', () => {
      const v1 = makePrompt({ version: '1.0.0', systemInstruction: 'v1 instruction' });
      const v2 = makePrompt({ version: '2.0.0', systemInstruction: 'v2 instruction' });

      manager.registerPrompt(v1, 'v1');
      manager.registerPrompt(v2, 'v2');

      expect(manager.getPrompt('receipt_extraction', '2.0.0')).toEqual(v2);
    });

    it('should throw for unregistered prompt type', () => {
      expect(() => manager.getPrompt('receipt_extraction')).toThrow(
        "No prompts registered for type 'receipt_extraction'",
      );
    });

    it('should throw for non-existent version', () => {
      manager.registerPrompt(makePrompt({ version: '1.0.0' }), 'v1');

      expect(() => manager.getPrompt('receipt_extraction', '9.9.9')).toThrow(
        "Prompt version '9.9.9' not found for type 'receipt_extraction'",
      );
    });
  });

  describe('getActiveVersion', () => {
    it('should return the active version string', () => {
      manager.registerPrompt(makePrompt({ version: '1.0.0' }), 'v1');

      expect(manager.getActiveVersion('receipt_extraction')).toBe('1.0.0');
    });

    it('should throw for type with no active version', () => {
      expect(() => manager.getActiveVersion('insight_generation')).toThrow(
        "No active version set for type 'insight_generation'",
      );
    });
  });

  describe('listVersions', () => {
    it('should return empty array for unregistered type', () => {
      expect(manager.listVersions('receipt_extraction')).toEqual([]);
    });

    it('should list all versions with active flag', () => {
      manager.registerPrompt(makePrompt({ version: '1.0.0' }), 'First version');
      manager.registerPrompt(makePrompt({ version: '2.0.0' }), 'Second version');

      const versions = manager.listVersions('receipt_extraction');

      expect(versions).toHaveLength(2);

      const v1 = versions.find((v) => v.version === '1.0.0');
      const v2 = versions.find((v) => v.version === '2.0.0');

      expect(v1).toBeDefined();
      expect(v1!.isActive).toBe(true);
      expect(v1!.description).toBe('First version');

      expect(v2).toBeDefined();
      expect(v2!.isActive).toBe(false);
      expect(v2!.description).toBe('Second version');
    });

    it('should sort versions by creation date (newest first)', () => {
      const now = Date.now();
      const originalDate = globalThis.Date;

      // Control timestamps to ensure deterministic ordering
      let callCount = 0;
      vi.spyOn(globalThis, 'Date').mockImplementation((...args: unknown[]) => {
        if (args.length === 0) {
          callCount++;
          return new originalDate(now + callCount * 1000);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return new originalDate(...(args as [any]));
      });

      manager.registerPrompt(makePrompt({ version: '1.0.0' }), 'v1');
      manager.registerPrompt(makePrompt({ version: '2.0.0' }), 'v2');

      const versions = manager.listVersions('receipt_extraction');

      // v2 was registered after v1 (with later timestamp), so it should come first
      expect(versions[0]!.version).toBe('2.0.0');
      expect(versions[1]!.version).toBe('1.0.0');

      vi.restoreAllMocks();
    });

    it('should include createdAt as Date instances', () => {
      manager.registerPrompt(makePrompt({ version: '1.0.0' }), 'v1');

      const versions = manager.listVersions('receipt_extraction');
      expect(versions[0]!.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('setActiveVersion', () => {
    it('should change the active version', () => {
      manager.registerPrompt(makePrompt({ version: '1.0.0' }), 'v1');
      manager.registerPrompt(makePrompt({ version: '2.0.0' }), 'v2');

      manager.setActiveVersion('receipt_extraction', '2.0.0');

      expect(manager.getActiveVersion('receipt_extraction')).toBe('2.0.0');
    });

    it('should update isActive flag in listVersions', () => {
      manager.registerPrompt(makePrompt({ version: '1.0.0' }), 'v1');
      manager.registerPrompt(makePrompt({ version: '2.0.0' }), 'v2');

      manager.setActiveVersion('receipt_extraction', '2.0.0');

      const versions = manager.listVersions('receipt_extraction');
      const v1 = versions.find((v) => v.version === '1.0.0');
      const v2 = versions.find((v) => v.version === '2.0.0');

      expect(v1!.isActive).toBe(false);
      expect(v2!.isActive).toBe(true);
    });

    it('should make getPrompt return new active version by default', () => {
      const v1 = makePrompt({ version: '1.0.0', systemInstruction: 'v1' });
      const v2 = makePrompt({ version: '2.0.0', systemInstruction: 'v2' });

      manager.registerPrompt(v1, 'v1');
      manager.registerPrompt(v2, 'v2');

      manager.setActiveVersion('receipt_extraction', '2.0.0');

      expect(manager.getPrompt('receipt_extraction').systemInstruction).toBe('v2');
    });

    it('should throw for non-existent version', () => {
      manager.registerPrompt(makePrompt({ version: '1.0.0' }), 'v1');

      expect(() => manager.setActiveVersion('receipt_extraction', '9.9.9')).toThrow(
        "Prompt version '9.9.9' not found for type 'receipt_extraction'",
      );
    });

    it('should throw for unregistered type', () => {
      expect(() => manager.setActiveVersion('insight_generation', '1.0.0')).toThrow(
        "Prompt version '1.0.0' not found for type 'insight_generation'",
      );
    });
  });

  describe('cross-type isolation', () => {
    it('should not share versions between prompt types', () => {
      const allTypes: PromptType[] = [
        'receipt_extraction',
        'bank_statement_extraction',
        'pos_export_extraction',
        'insight_generation',
      ];

      for (const type of allTypes) {
        manager.registerPrompt(makePrompt({ type, version: '1.0.0' }), `${type} v1`);
      }

      expect(manager.listVersions('receipt_extraction')).toHaveLength(1);
      expect(manager.listVersions('bank_statement_extraction')).toHaveLength(1);

      manager.setActiveVersion('receipt_extraction', '1.0.0');
      // Other types unaffected
      expect(manager.getActiveVersion('bank_statement_extraction')).toBe('1.0.0');
    });
  });
});
