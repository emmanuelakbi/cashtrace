/**
 * Property-Based Tests — Template Variable Validation
 *
 * **Property 5: Template Variable Validation**
 * For any notification request, all required template variables SHALL be
 * present and valid before queuing.
 *
 * **Validates: Requirements 4.4**
 *
 * @module notifications/services/templateEngine.property.test
 */

import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationCategory, TemplateVariable } from '../types/index.js';
import { NOTIFICATION_ERROR_CODES } from '../types/index.js';

import { createTemplateEngine, type TemplateEngine } from './templateEngine.js';

// ─── Mock Pool ───────────────────────────────────────────────────────────────

interface MockPool {
  query: ReturnType<typeof vi.fn>;
}

function createMockPool(): MockPool {
  return { query: vi.fn() };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const categoryArb: fc.Arbitrary<NotificationCategory> = fc.constantFrom(
  'security',
  'transactions',
  'insights',
  'compliance',
  'system',
  'marketing',
);

/** Generate a unique array of valid variable names (word chars, not starting with digit). */
const uniqueVarNamesArb = (min: number, max: number): fc.Arbitrary<string[]> =>
  fc.uniqueArray(fc.stringMatching(/^[a-zA-Z]\w{0,19}$/), { minLength: min, maxLength: max });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTemplateRow(
  templateId: string,
  category: NotificationCategory,
  variables: TemplateVariable[],
): Record<string, unknown> {
  const placeholders = variables.map((v) => `{{${v.name}}}`).join(' ');
  return {
    id: templateId,
    version: '1.0.0',
    category,
    subject: `Subject ${placeholders}`,
    body_html: `<p>HTML ${placeholders}</p>`,
    body_text: `Text ${placeholders}`,
    push_title: `Push ${placeholders}`,
    push_body: `Body ${placeholders}`,
    variables,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TemplateEngine — Property 5: Template Variable Validation', () => {
  let pool: MockPool;
  let engine: TemplateEngine;

  beforeEach(() => {
    pool = createMockPool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engine = createTemplateEngine(pool as any);
  });

  /**
   * For any template with required variables, render throws
   * NOTIF_MISSING_VARIABLES when any required variable is missing.
   *
   * Validates: Requirement 4.4
   */
  it('render throws when any required variable is missing', async () => {
    await fc.assert(
      fc.asyncProperty(uniqueVarNamesArb(2, 5), categoryArb, async (varNames, category) => {
        const templateVars: TemplateVariable[] = varNames.map((name) => ({
          name,
          required: true,
          type: 'string' as const,
        }));

        const templateId = 'tmpl-test';
        const row = makeTemplateRow(templateId, category, templateVars);

        // Omit the last variable — at least one is missing
        const providedVars: Record<string, unknown> = {};
        for (let i = 0; i < varNames.length - 1; i++) {
          providedVars[varNames[i]!] = 'value';
        }

        pool.query.mockResolvedValueOnce({ rows: [row] });

        try {
          await engine.render(templateId, providedVars);
          expect.unreachable('render should have thrown');
        } catch (err: unknown) {
          const error = err as Error;
          expect(error.name).toBe(NOTIFICATION_ERROR_CODES.NOTIF_MISSING_VARIABLES);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * For any template with all required variables provided, render succeeds
   * and returns a RenderedTemplate with all fields populated (no remaining
   * placeholders).
   *
   * Validates: Requirement 4.4
   */
  it('render succeeds when all required variables are provided', async () => {
    await fc.assert(
      fc.asyncProperty(uniqueVarNamesArb(1, 5), categoryArb, async (varNames, category) => {
        const templateVars: TemplateVariable[] = varNames.map((name) => ({
          name,
          required: true,
          type: 'string' as const,
        }));

        const templateId = 'tmpl-test';
        const row = makeTemplateRow(templateId, category, templateVars);

        // Provide ALL required variables
        const providedVars: Record<string, unknown> = {};
        for (const name of varNames) {
          providedVars[name] = `val_${name}`;
        }

        pool.query.mockResolvedValueOnce({ rows: [row] });

        const result = await engine.render(templateId, providedVars);

        expect(result).toHaveProperty('subject');
        expect(result).toHaveProperty('bodyHtml');
        expect(result).toHaveProperty('bodyText');
        expect(result).toHaveProperty('pushTitle');
        expect(result).toHaveProperty('pushBody');

        // Verify all placeholders were substituted
        const allFields = [
          result.subject,
          result.bodyHtml,
          result.bodyText,
          result.pushTitle,
          result.pushBody,
        ];
        for (const field of allFields) {
          expect(field).not.toMatch(/\{\{\w+\}\}/);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * For any template, validate correctly identifies all missing required
   * variables — every required variable not in the provided set appears
   * in missingVariables.
   *
   * Validates: Requirement 4.4
   */
  it('validate correctly identifies all missing required variables', async () => {
    await fc.assert(
      fc.asyncProperty(uniqueVarNamesArb(2, 5), categoryArb, async (varNames, category) => {
        const templateVars: TemplateVariable[] = varNames.map((name) => ({
          name,
          required: true,
          type: 'string' as const,
        }));

        const templateId = 'tmpl-test';
        const row = makeTemplateRow(templateId, category, templateVars);

        // Provide only the first variable, omit the rest
        const providedVars: Record<string, unknown> = {
          [varNames[0]!]: 'value',
        };
        const expectedMissing = varNames.slice(1);

        pool.query.mockResolvedValueOnce({ rows: [row] });

        const result = await engine.validate(templateId, providedVars);

        expect(result.valid).toBe(false);
        expect(result.missingVariables.sort()).toEqual(expectedMissing.sort());
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Variable substitution is idempotent — rendering with the same variables
   * always produces the same output.
   *
   * Validates: Requirement 4.4
   */
  it('rendering is idempotent with the same variables', async () => {
    await fc.assert(
      fc.asyncProperty(uniqueVarNamesArb(1, 5), categoryArb, async (varNames, category) => {
        const templateVars: TemplateVariable[] = varNames.map((name) => ({
          name,
          required: true,
          type: 'string' as const,
        }));

        const templateId = 'tmpl-test';
        const row = makeTemplateRow(templateId, category, templateVars);

        const providedVars: Record<string, unknown> = {};
        for (const name of varNames) {
          providedVars[name] = `val_${name}`;
        }

        // Render twice with the same inputs
        pool.query.mockResolvedValueOnce({ rows: [row] });
        const result1 = await engine.render(templateId, providedVars);

        pool.query.mockResolvedValueOnce({ rows: [row] });
        const result2 = await engine.render(templateId, providedVars);

        expect(result1).toEqual(result2);
      }),
      { numRuns: 100 },
    );
  });
});
