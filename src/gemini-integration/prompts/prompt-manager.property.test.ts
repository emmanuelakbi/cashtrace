/**
 * Property-based tests for PromptManager
 *
 * **Property 26: Prompt Version Management**
 * For any prompt type, the prompt manager SHALL maintain version history
 * and allow retrieval of any previously stored version.
 *
 * Sub-properties:
 * 1. Always return the correct active version when getPrompt() is called without a version
 * 2. Always return the specific version when getPrompt() is called with a version
 * 3. listVersions() SHALL include all registered versions with correct isActive flags
 * 4. setActiveVersion() SHALL change which version getPrompt() returns by default
 *
 * **Validates: Requirements 14.6**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { PromptManagerImpl } from './prompt-manager.js';
import type { PromptType, SystemPrompt } from './prompt-manager.js';

// ─── Generators ──────────────────────────────────────────────────────────────

const promptTypeArb: fc.Arbitrary<PromptType> = fc.constantFrom(
  'receipt_extraction',
  'bank_statement_extraction',
  'pos_export_extraction',
  'insight_generation',
);

/** Generate a unique semver-like version string. */
const versionArb = fc
  .tuple(
    fc.integer({ min: 0, max: 20 }),
    fc.integer({ min: 0, max: 20 }),
    fc.integer({ min: 0, max: 20 }),
  )
  .map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

/** Generate a non-empty description string. */
const descriptionArb = fc.stringOf(fc.char(), { minLength: 1, maxLength: 50 });

/** Generate a SystemPrompt for a given type and version. */
function makePromptArb(type: PromptType, version: string): SystemPrompt {
  return {
    type,
    version,
    systemInstruction: `Instruction for ${type} v${version}`,
    exampleOutputs: [`{"example":"${version}"}`],
    jsonSchema: { type: 'object', version },
  };
}

/**
 * Generate a list of unique version strings (at least 1, up to 10).
 * Uniqueness is critical since PromptManager rejects duplicate versions.
 */
const uniqueVersionsArb = fc
  .uniqueArray(versionArb, { minLength: 1, maxLength: 10, comparator: (a, b) => a === b })
  .filter((arr) => arr.length >= 1);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 26: Prompt Version Management', () => {
  it('sub-property 1: getPrompt() without version returns the active version', () => {
    fc.assert(
      fc.property(promptTypeArb, uniqueVersionsArb, descriptionArb, (type, versions, desc) => {
        const manager = new PromptManagerImpl();

        for (const version of versions) {
          manager.registerPrompt(makePromptArb(type, version), desc);
        }

        // The first registered version should be active by default
        const activePrompt = manager.getPrompt(type);
        expect(activePrompt.version).toBe(versions[0]);
        expect(activePrompt.type).toBe(type);
      }),
      { numRuns: 100 },
    );
  });

  it('sub-property 2: getPrompt() with explicit version returns that specific version', () => {
    fc.assert(
      fc.property(promptTypeArb, uniqueVersionsArb, descriptionArb, (type, versions, desc) => {
        const manager = new PromptManagerImpl();

        for (const version of versions) {
          manager.registerPrompt(makePromptArb(type, version), desc);
        }

        // Every registered version should be retrievable by explicit version
        for (const version of versions) {
          const prompt = manager.getPrompt(type, version);
          expect(prompt.version).toBe(version);
          expect(prompt.type).toBe(type);
          expect(prompt.systemInstruction).toBe(`Instruction for ${type} v${version}`);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('sub-property 3: listVersions() includes all registered versions with correct isActive flags', () => {
    fc.assert(
      fc.property(promptTypeArb, uniqueVersionsArb, descriptionArb, (type, versions, desc) => {
        const manager = new PromptManagerImpl();

        for (const version of versions) {
          manager.registerPrompt(makePromptArb(type, version), desc);
        }

        const listed = manager.listVersions(type);

        // All registered versions must appear
        expect(listed).toHaveLength(versions.length);

        const listedVersions = listed.map((v) => v.version);
        for (const version of versions) {
          expect(listedVersions).toContain(version);
        }

        // Exactly one version should be active (the first registered)
        const activeVersions = listed.filter((v) => v.isActive);
        expect(activeVersions).toHaveLength(1);
        expect(activeVersions[0]!.version).toBe(versions[0]);

        // All non-active versions should have isActive === false
        const inactiveVersions = listed.filter((v) => !v.isActive);
        expect(inactiveVersions).toHaveLength(versions.length - 1);

        // All entries should have valid descriptions and createdAt
        for (const entry of listed) {
          expect(entry.description).toBe(desc);
          expect(entry.createdAt).toBeInstanceOf(Date);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('sub-property 4: setActiveVersion() changes which version getPrompt() returns by default', () => {
    fc.assert(
      fc.property(
        promptTypeArb,
        uniqueVersionsArb.filter((v) => v.length >= 2),
        descriptionArb,
        (type, versions, desc) => {
          const manager = new PromptManagerImpl();

          for (const version of versions) {
            manager.registerPrompt(makePromptArb(type, version), desc);
          }

          // Pick a random version to set as active (not the first, which is already active)
          const targetIndex = versions.length - 1;
          const targetVersion = versions[targetIndex]!;

          manager.setActiveVersion(type, targetVersion);

          // getPrompt() without version should now return the new active
          const activePrompt = manager.getPrompt(type);
          expect(activePrompt.version).toBe(targetVersion);

          // getActiveVersion() should reflect the change
          expect(manager.getActiveVersion(type)).toBe(targetVersion);

          // listVersions() should show exactly one active
          const listed = manager.listVersions(type);
          const activeEntries = listed.filter((v) => v.isActive);
          expect(activeEntries).toHaveLength(1);
          expect(activeEntries[0]!.version).toBe(targetVersion);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('version history is preserved across multiple setActiveVersion calls', () => {
    fc.assert(
      fc.property(
        promptTypeArb,
        uniqueVersionsArb.filter((v) => v.length >= 2),
        descriptionArb,
        (type, versions, desc) => {
          const manager = new PromptManagerImpl();

          for (const version of versions) {
            manager.registerPrompt(makePromptArb(type, version), desc);
          }

          // Cycle through setting each version as active
          for (const version of versions) {
            manager.setActiveVersion(type, version);

            // After each switch, the default prompt should match
            expect(manager.getPrompt(type).version).toBe(version);
            expect(manager.getActiveVersion(type)).toBe(version);

            // All versions should still be retrievable explicitly
            for (const v of versions) {
              expect(manager.getPrompt(type, v).version).toBe(v);
            }

            // Total version count should remain unchanged
            expect(manager.listVersions(type)).toHaveLength(versions.length);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('prompt types are isolated from each other', () => {
    fc.assert(
      fc.property(uniqueVersionsArb, descriptionArb, (versions, desc) => {
        const manager = new PromptManagerImpl();
        const types: PromptType[] = [
          'receipt_extraction',
          'bank_statement_extraction',
          'pos_export_extraction',
          'insight_generation',
        ];

        // Register the same versions under each type
        for (const type of types) {
          for (const version of versions) {
            manager.registerPrompt(makePromptArb(type, version), desc);
          }
        }

        // Changing active version for one type should not affect others
        if (versions.length >= 2) {
          const newActive = versions[versions.length - 1]!;
          manager.setActiveVersion('receipt_extraction', newActive);

          // receipt_extraction changed
          expect(manager.getActiveVersion('receipt_extraction')).toBe(newActive);

          // Others still have the first version as active
          expect(manager.getActiveVersion('bank_statement_extraction')).toBe(versions[0]);
          expect(manager.getActiveVersion('pos_export_extraction')).toBe(versions[0]);
          expect(manager.getActiveVersion('insight_generation')).toBe(versions[0]);
        }
      }),
      { numRuns: 100 },
    );
  });
});
