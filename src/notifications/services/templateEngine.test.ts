/**
 * Template Engine — Unit Tests
 *
 * Tests variable substitution, validation, error handling,
 * and multi-format rendering for the notification template engine.
 *
 * @module notifications/services/templateEngine.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { NotificationTemplate, TemplateVariable } from '../types/index.js';
import { NOTIFICATION_ERROR_CODES } from '../types/index.js';

import { createTemplateEngine, type TemplateEngine } from './templateEngine.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTemplateVariable(overrides: Partial<TemplateVariable> = {}): TemplateVariable {
  return {
    name: 'userName',
    required: true,
    type: 'string',
    ...overrides,
  };
}

function makeTemplateRow(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: 'tpl-001',
    version: '1.0',
    category: 'transactions',
    subject: 'Hello {{userName}}',
    body_html: '<h1>Hello {{userName}}</h1><p>Your balance is {{amount}}</p>',
    body_text: 'Hello {{userName}}, your balance is {{amount}}',
    push_title: 'Hi {{userName}}',
    push_body: 'Balance: {{amount}}',
    variables: [
      makeTemplateVariable({ name: 'userName', required: true, type: 'string' }),
      makeTemplateVariable({ name: 'amount', required: true, type: 'string' }),
    ],
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function createMockPool(rows: Record<string, unknown>[] = []): ReturnType<typeof mockPool> {
  return mockPool(rows);
}

function mockPool(rows: Record<string, unknown>[]): { query: ReturnType<typeof vi.fn> } {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TemplateEngine', () => {
  let engine: TemplateEngine;
  let pool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    pool = createMockPool([makeTemplateRow()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engine = createTemplateEngine(pool as any);
  });

  describe('getTemplate', () => {
    it('should fetch a template by ID', async () => {
      const template: NotificationTemplate = await engine.getTemplate('tpl-001');

      expect(template.id).toBe('tpl-001');
      expect(template.version).toBe('1.0');
      expect(template.category).toBe('transactions');
      expect(template.subject).toBe('Hello {{userName}}');
      expect(template.bodyHtml).toBe(
        '<h1>Hello {{userName}}</h1><p>Your balance is {{amount}}</p>',
      );
      expect(template.bodyText).toBe('Hello {{userName}}, your balance is {{amount}}');
      expect(template.pushTitle).toBe('Hi {{userName}}');
      expect(template.pushBody).toBe('Balance: {{amount}}');
      expect(template.variables).toHaveLength(2);
    });

    it('should throw NOTIF_INVALID_TEMPLATE when template not found', async () => {
      pool = createMockPool([]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      engine = createTemplateEngine(pool as any);

      await expect(engine.getTemplate('nonexistent')).rejects.toThrow(
        'Template not found: nonexistent',
      );

      try {
        await engine.getTemplate('nonexistent');
      } catch (err) {
        expect((err as Error).name).toBe(NOTIFICATION_ERROR_CODES.NOTIF_INVALID_TEMPLATE);
      }
    });
  });

  describe('render', () => {
    it('should substitute variables in all formats', async () => {
      const result = await engine.render('tpl-001', {
        userName: 'Chidi',
        amount: '₦50,000',
      });

      expect(result.subject).toBe('Hello Chidi');
      expect(result.bodyHtml).toBe('<h1>Hello Chidi</h1><p>Your balance is ₦50,000</p>');
      expect(result.bodyText).toBe('Hello Chidi, your balance is ₦50,000');
      expect(result.pushTitle).toBe('Hi Chidi');
      expect(result.pushBody).toBe('Balance: ₦50,000');
    });

    it('should throw NOTIF_MISSING_VARIABLES when required variables are missing', async () => {
      await expect(engine.render('tpl-001', { userName: 'Chidi' })).rejects.toThrow(
        'Missing required variables: amount',
      );

      try {
        await engine.render('tpl-001', { userName: 'Chidi' });
      } catch (err) {
        expect((err as Error).name).toBe(NOTIFICATION_ERROR_CODES.NOTIF_MISSING_VARIABLES);
      }
    });

    it('should use default values for optional variables with defaults', async () => {
      pool = createMockPool([
        makeTemplateRow({
          subject: '{{greeting}} {{userName}}',
          body_html: '<p>{{greeting}} {{userName}}</p>',
          body_text: '{{greeting}} {{userName}}',
          push_title: '{{greeting}}',
          push_body: '{{greeting}} {{userName}}',
          variables: [
            makeTemplateVariable({ name: 'userName', required: true, type: 'string' }),
            makeTemplateVariable({
              name: 'greeting',
              required: false,
              type: 'string',
              defaultValue: 'Welcome',
            }),
          ],
        }),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      engine = createTemplateEngine(pool as any);

      const result = await engine.render('tpl-001', { userName: 'Amaka' });

      expect(result.subject).toBe('Welcome Amaka');
      expect(result.pushTitle).toBe('Welcome');
    });

    it('should replace unresolved placeholders with empty string', async () => {
      pool = createMockPool([
        makeTemplateRow({
          subject: 'Hello {{userName}} {{extra}}',
          body_html: '<p>{{userName}} {{extra}}</p>',
          body_text: '{{userName}} {{extra}}',
          push_title: '{{extra}}',
          push_body: '{{extra}}',
          variables: [
            makeTemplateVariable({ name: 'userName', required: true, type: 'string' }),
            makeTemplateVariable({ name: 'extra', required: false, type: 'string' }),
          ],
        }),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      engine = createTemplateEngine(pool as any);

      const result = await engine.render('tpl-001', { userName: 'Emeka' });

      expect(result.subject).toBe('Hello Emeka ');
      expect(result.pushTitle).toBe('');
    });
  });

  describe('validate', () => {
    it('should return valid when all required variables are present', async () => {
      const result = await engine.validate('tpl-001', {
        userName: 'Chidi',
        amount: '₦50,000',
      });

      expect(result.valid).toBe(true);
      expect(result.missingVariables).toEqual([]);
      expect(result.invalidVariables).toEqual([]);
    });

    it('should return missing variables when required variables are absent', async () => {
      const result = await engine.validate('tpl-001', { userName: 'Chidi' });

      expect(result.valid).toBe(false);
      expect(result.missingVariables).toEqual(['amount']);
      expect(result.invalidVariables).toEqual([]);
    });

    it('should return invalid variables when types do not match', async () => {
      pool = createMockPool([
        makeTemplateRow({
          variables: [makeTemplateVariable({ name: 'count', required: true, type: 'number' })],
        }),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      engine = createTemplateEngine(pool as any);

      const result = await engine.validate('tpl-001', { count: 'not-a-number' });

      expect(result.valid).toBe(false);
      expect(result.invalidVariables).toEqual(['count']);
    });

    it('should not report missing for optional variables with defaults', async () => {
      pool = createMockPool([
        makeTemplateRow({
          variables: [
            makeTemplateVariable({
              name: 'greeting',
              required: true,
              type: 'string',
              defaultValue: 'Hello',
            }),
          ],
        }),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      engine = createTemplateEngine(pool as any);

      const result = await engine.validate('tpl-001', {});

      expect(result.valid).toBe(true);
      expect(result.missingVariables).toEqual([]);
    });
  });
});
