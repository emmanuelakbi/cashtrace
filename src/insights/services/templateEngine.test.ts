import { describe, expect, it, beforeEach } from 'vitest';

import { createWATDate } from '../../utils/timezone.js';
import { formatNaira } from '../types/index.js';

import type { InsightTemplate } from '../types/index.js';

import { TemplateEngine } from './templateEngine.js';

describe('TemplateEngine', () => {
  let engine: TemplateEngine;

  beforeEach(() => {
    engine = new TemplateEngine();
  });

  // ─── Variable Substitution ─────────────────────────────────────────────

  describe('render', () => {
    it('should substitute string variables', () => {
      const template = makeTemplate({
        titleTemplate: 'Hello {{name}}',
        bodyTemplate: 'Welcome to {{company}}, {{name}}.',
        variables: [
          { name: 'name', type: 'string', required: true },
          { name: 'company', type: 'string', required: true },
        ],
      });

      const result = engine.render(template, { name: 'Chidi', company: 'CashTrace' });

      expect(result.title).toBe('Hello Chidi');
      expect(result.body).toBe('Welcome to CashTrace, Chidi.');
    });

    it('should format number variables with thousands separators', () => {
      const template = makeTemplate({
        titleTemplate: '{{count}} Transactions',
        bodyTemplate: 'You have {{count}} transactions worth reviewing.',
        variables: [{ name: 'count', type: 'number', required: true }],
      });

      const result = engine.render(template, { count: 1500 });

      expect(result.title).toBe('1,500 Transactions');
    });

    it('should format currency variables using formatNaira', () => {
      const template = makeTemplate({
        titleTemplate: 'VAT: {{amount}}',
        bodyTemplate: 'Your VAT liability is {{amount}}.',
        variables: [{ name: 'amount', type: 'currency', required: true }],
      });

      // 125000000 Kobo = ₦1,250,000.00
      const result = engine.render(template, { amount: 125000000 });

      expect(result.title).toBe(`VAT: ${formatNaira(125000000)}`);
      expect(result.body).toBe(`Your VAT liability is ${formatNaira(125000000)}.`);
    });

    it('should format date variables in WAT DD/MM/YYYY format', () => {
      // 15 March 2025, 10:00 WAT
      const date = createWATDate(2025, 3, 15, 10, 0, 0);
      const template = makeTemplate({
        titleTemplate: 'Deadline: {{deadline}}',
        bodyTemplate: 'File before {{deadline}}.',
        variables: [{ name: 'deadline', type: 'date', required: true }],
      });

      const result = engine.render(template, { deadline: date });

      expect(result.title).toBe('Deadline: 15/03/2025');
    });

    it('should handle date strings as well as Date objects', () => {
      const template = makeTemplate({
        titleTemplate: 'Due: {{dueDate}}',
        bodyTemplate: '',
        variables: [{ name: 'dueDate', type: 'date', required: true }],
      });

      const result = engine.render(template, { dueDate: '2025-06-30T00:00:00Z' });

      expect(result.title).toMatch(/Due: 30\/06\/2025/);
    });

    it('should render action item templates with variable substitution', () => {
      const template = makeTemplate({
        titleTemplate: 'Alert',
        bodyTemplate: 'Body',
        actionItemTemplates: [
          {
            description: 'Review {{count}} items in {{category}}',
            actionType: 'navigate',
            actionData: { route: '/review' },
          },
          {
            description: 'Visit external site',
            actionType: 'external_link',
            actionData: { url: 'https://example.com' },
          },
        ],
        variables: [
          { name: 'count', type: 'number', required: true },
          { name: 'category', type: 'string', required: true },
        ],
      });

      const result = engine.render(template, { count: 42, category: 'spending' });

      expect(result.actionItems).toHaveLength(2);
      expect(result.actionItems[0]?.description).toBe('Review 42 items in spending');
      expect(result.actionItems[0]?.actionType).toBe('navigate');
      expect(result.actionItems[0]?.actionData).toEqual({ route: '/review' });
      expect(result.actionItems[1]?.description).toBe('Visit external site');
    });

    it('should leave unknown placeholders intact', () => {
      const template = makeTemplate({
        titleTemplate: '{{known}} and {{unknown}}',
        bodyTemplate: '',
        variables: [{ name: 'known', type: 'string', required: true }],
      });

      const result = engine.render(template, { known: 'hello' });

      expect(result.title).toBe('hello and {{unknown}}');
    });

    it('should handle empty variables object when no required vars', () => {
      const template = makeTemplate({
        titleTemplate: 'Static Title',
        bodyTemplate: 'No variables here.',
        variables: [],
      });

      const result = engine.render(template, {});

      expect(result.title).toBe('Static Title');
      expect(result.body).toBe('No variables here.');
    });

    it('should handle null/undefined variable values as empty string', () => {
      const template = makeTemplate({
        titleTemplate: 'Value: {{optional}}',
        bodyTemplate: '',
        variables: [{ name: 'optional', type: 'string', required: false }],
      });

      const result = engine.render(template, { optional: null });

      expect(result.title).toBe('Value: ');
    });

    it('should throw when required variables are missing', () => {
      const template = makeTemplate({
        titleTemplate: '{{required}}',
        bodyTemplate: '',
        variables: [{ name: 'required', type: 'string', required: true }],
      });

      expect(() => engine.render(template, {})).toThrow('Missing required template variables');
      expect(() => engine.render(template, {})).toThrow('required');
    });
  });

  // ─── Validation ────────────────────────────────────────────────────────

  describe('validateVariables', () => {
    it('should return valid when all required variables are present', () => {
      const template = makeTemplate({
        variables: [
          { name: 'a', type: 'string', required: true },
          { name: 'b', type: 'number', required: true },
        ],
      });

      const result = engine.validateVariables(template, { a: 'hello', b: 42 });

      expect(result.valid).toBe(true);
      expect(result.missingVariables).toEqual([]);
    });

    it('should report missing required variables', () => {
      const template = makeTemplate({
        variables: [
          { name: 'a', type: 'string', required: true },
          { name: 'b', type: 'number', required: true },
          { name: 'c', type: 'string', required: false },
        ],
      });

      const result = engine.validateVariables(template, { c: 'optional' });

      expect(result.valid).toBe(false);
      expect(result.missingVariables).toEqual(['a', 'b']);
    });

    it('should report extra variables not defined in template', () => {
      const template = makeTemplate({
        variables: [{ name: 'a', type: 'string', required: true }],
      });

      const result = engine.validateVariables(template, { a: 'val', extra: 'surprise' });

      expect(result.valid).toBe(true);
      expect(result.extraVariables).toEqual(['extra']);
    });

    it('should handle empty variables list', () => {
      const template = makeTemplate({ variables: [] });

      const result = engine.validateVariables(template, {});

      expect(result.valid).toBe(true);
      expect(result.missingVariables).toEqual([]);
      expect(result.extraVariables).toEqual([]);
    });
  });

  // ─── Template Lookup ───────────────────────────────────────────────────

  describe('getTemplate', () => {
    it('should return English template by default', () => {
      const template = engine.getTemplate('tax', 'vat_liability');

      expect(template).toBeDefined();
      expect(template?.locale).toBe('en');
      expect(template?.category).toBe('tax');
      expect(template?.type).toBe('vat_liability');
    });

    it('should return Pidgin template when requested', () => {
      const template = engine.getTemplate('tax', 'vat_liability', 'pcm');

      expect(template).toBeDefined();
      expect(template?.locale).toBe('pcm');
      expect(template?.titleTemplate).toContain('Wahala');
    });

    it('should return undefined for unknown category/type', () => {
      const template = engine.getTemplate('operational', 'vat_liability');

      expect(template).toBeUndefined();
    });

    it('should return templates for all required insight types', () => {
      const requiredTypes: Array<{ category: string; type: string }> = [
        { category: 'tax', type: 'vat_liability' },
        { category: 'cashflow', type: 'negative_projection' },
        { category: 'spending', type: 'personal_spending' },
        { category: 'compliance', type: 'compliance_deadline' },
        { category: 'revenue', type: 'revenue_opportunity' },
      ];

      for (const { category, type } of requiredTypes) {
        const en = engine.getTemplate(
          category as 'tax' | 'cashflow' | 'spending' | 'compliance' | 'revenue',
          type as
            | 'vat_liability'
            | 'negative_projection'
            | 'personal_spending'
            | 'compliance_deadline'
            | 'revenue_opportunity',
          'en',
        );
        const pcm = engine.getTemplate(
          category as 'tax' | 'cashflow' | 'spending' | 'compliance' | 'revenue',
          type as
            | 'vat_liability'
            | 'negative_projection'
            | 'personal_spending'
            | 'compliance_deadline'
            | 'revenue_opportunity',
          'pcm',
        );

        expect(en, `Missing EN template for ${category}/${type}`).toBeDefined();
        expect(pcm, `Missing PCM template for ${category}/${type}`).toBeDefined();
      }
    });
  });

  // ─── Default Templates ─────────────────────────────────────────────────

  describe('getDefaultTemplates', () => {
    it('should return all registered templates', () => {
      const templates = engine.getDefaultTemplates();

      // 5 types × 2 locales = 10 templates
      expect(templates).toHaveLength(10);
    });

    it('should have equal English and Pidgin templates', () => {
      const templates = engine.getDefaultTemplates();
      const enCount = templates.filter((t) => t.locale === 'en').length;
      const pcmCount = templates.filter((t) => t.locale === 'pcm').length;

      expect(enCount).toBe(pcmCount);
    });

    it('should have unique IDs for all templates', () => {
      const templates = engine.getDefaultTemplates();
      const ids = templates.map((t) => t.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  // ─── English Locale Rendering ──────────────────────────────────────────

  describe('English locale rendering', () => {
    it('should render VAT liability template in English', () => {
      const template = engine.getTemplate('tax', 'vat_liability', 'en');
      expect(template).toBeDefined();

      const deadline = createWATDate(2025, 3, 31, 23, 59, 0);
      const result = engine.render(template!, {
        amount: 250000000, // ₦2,500,000.00
        period: 'Q1 2025',
        transactionCount: 150,
        deadline,
      });

      expect(result.title).toContain('VAT Liability');
      expect(result.title).toContain(formatNaira(250000000));
      expect(result.body).toContain('Q1 2025');
      expect(result.body).toContain('150');
      expect(result.body).toContain('31/03/2025');
      expect(result.actionItems.length).toBeGreaterThan(0);
    });

    it('should render cashflow negative projection in English', () => {
      const template = engine.getTemplate('cashflow', 'negative_projection', 'en');
      expect(template).toBeDefined();

      const result = engine.render(template!, {
        days: 15,
        shortfall: 50000000,
        currentBalance: 120000000,
      });

      expect(result.title).toContain('15');
      expect(result.body).toContain(formatNaira(50000000));
      expect(result.body).toContain(formatNaira(120000000));
    });
  });

  // ─── Pidgin Locale Rendering ───────────────────────────────────────────

  describe('Pidgin locale rendering', () => {
    it('should render VAT liability template in Pidgin', () => {
      const template = engine.getTemplate('tax', 'vat_liability', 'pcm');
      expect(template).toBeDefined();

      const deadline = createWATDate(2025, 6, 30, 23, 59, 0);
      const result = engine.render(template!, {
        amount: 100000000,
        period: 'Q2 2025',
        transactionCount: 80,
        deadline,
      });

      expect(result.title).toContain('Wahala');
      expect(result.body).toContain('Q2 2025');
      expect(result.body).toContain('80');
    });

    it('should render cashflow template in Pidgin', () => {
      const template = engine.getTemplate('cashflow', 'negative_projection', 'pcm');
      expect(template).toBeDefined();

      const result = engine.render(template!, {
        days: 7,
        shortfall: 30000000,
        currentBalance: 5000000,
      });

      expect(result.title).toContain('Wahala');
      expect(result.body).toContain('7');
      expect(result.body).toContain(formatNaira(30000000));
    });

    it('should render compliance deadline in Pidgin', () => {
      const template = engine.getTemplate('compliance', 'compliance_deadline', 'pcm');
      expect(template).toBeDefined();

      const deadline = createWATDate(2025, 12, 31, 23, 59, 0);
      const result = engine.render(template!, {
        regulatoryBody: 'FIRS',
        filingType: 'Annual Returns',
        deadline,
        daysRemaining: 45,
      });

      expect(result.title).toContain('FIRS');
      expect(result.body).toContain('Annual Returns');
      expect(result.body).toContain('45');
    });
  });

  // ─── Template Versioning & A/B Testing ─────────────────────────────────

  describe('registerTemplate', () => {
    it('should register a new template version alongside existing ones', () => {
      const v2 = makeTemplate({
        id: 'tpl-tax-vat-en-002',
        version: '2.0.0',
        category: 'tax',
        type: 'vat_liability',
        locale: 'en',
        titleTemplate: 'VAT Update: {{amount}}',
        bodyTemplate: 'Updated VAT body for {{period}}.',
        variables: [
          { name: 'amount', type: 'currency', required: true },
          { name: 'period', type: 'string', required: true },
        ],
      });

      engine.registerTemplate(v2);

      const versions = engine.getTemplateVersions('tax', 'vat_liability', 'en');
      expect(versions.length).toBeGreaterThanOrEqual(2);
      expect(versions.some((t) => t.version === '1.0.0')).toBe(true);
      expect(versions.some((t) => t.version === '2.0.0')).toBe(true);
    });

    it('should register a template for a brand new category/type/locale', () => {
      const custom = makeTemplate({
        id: 'tpl-custom-001',
        version: '1.0.0',
        category: 'operational',
        type: 'expense_spike',
        locale: 'en',
        titleTemplate: 'Expense Spike',
        bodyTemplate: 'Spike detected.',
        variables: [],
      });

      engine.registerTemplate(custom);

      const versions = engine.getTemplateVersions('operational', 'expense_spike', 'en');
      expect(versions).toHaveLength(1);
      expect(versions[0]?.id).toBe('tpl-custom-001');
    });
  });

  describe('getTemplateVersions', () => {
    it('should return all versions for a given category/type/locale', () => {
      const versions = engine.getTemplateVersions('tax', 'vat_liability', 'en');
      expect(versions).toHaveLength(1);
      expect(versions[0]?.version).toBe('1.0.0');
    });

    it('should return empty array for unknown template', () => {
      const versions = engine.getTemplateVersions('operational', 'vat_liability', 'en');
      expect(versions).toEqual([]);
    });

    it('should return multiple versions after registration', () => {
      engine.registerTemplate(
        makeTemplate({ id: 'v2', version: '2.0.0', titleTemplate: 'V2: {{amount}}' }),
      );
      engine.registerTemplate(
        makeTemplate({ id: 'v3', version: '3.0.0', titleTemplate: 'V3: {{amount}}' }),
      );

      const versions = engine.getTemplateVersions('tax', 'vat_liability', 'en');
      expect(versions.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('getTemplate with versioning', () => {
    it('should return the latest version when multiple exist', () => {
      engine.registerTemplate(
        makeTemplate({
          id: 'tpl-tax-vat-en-v2',
          version: '2.0.0',
          titleTemplate: 'V2 VAT: {{amount}}',
          variables: [{ name: 'amount', type: 'currency', required: true }],
        }),
      );

      const template = engine.getTemplate('tax', 'vat_liability', 'en');
      expect(template).toBeDefined();
      expect(template?.version).toBe('2.0.0');
      expect(template?.id).toBe('tpl-tax-vat-en-v2');
    });
  });

  describe('renderWithABTest', () => {
    it('should return correct ABTestResult shape', () => {
      const result = engine.renderWithABTest(
        'tax',
        'vat_liability',
        'en',
        {
          amount: 100000000,
          period: 'Q1 2025',
          transactionCount: 50,
          deadline: createWATDate(2025, 3, 31, 23, 59, 0),
        },
        'biz-001',
      );

      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('body');
      expect(result).toHaveProperty('actionItems');
      expect(result).toHaveProperty('templateId');
      expect(result).toHaveProperty('templateVersion');
      expect(typeof result.templateId).toBe('string');
      expect(typeof result.templateVersion).toBe('string');
    });

    it('should be deterministic — same businessId always gets same version', () => {
      engine.registerTemplate(
        makeTemplate({
          id: 'tpl-tax-vat-en-v2',
          version: '2.0.0',
          titleTemplate: 'V2 VAT: {{amount}}',
          bodyTemplate: 'V2 body for {{period}}.',
          variables: [
            { name: 'amount', type: 'currency', required: true },
            { name: 'period', type: 'string', required: true },
            { name: 'transactionCount', type: 'number', required: true },
            { name: 'deadline', type: 'date', required: true },
          ],
        }),
      );

      const vars = {
        amount: 100000000,
        period: 'Q1 2025',
        transactionCount: 50,
        deadline: createWATDate(2025, 3, 31, 23, 59, 0),
      };

      const result1 = engine.renderWithABTest('tax', 'vat_liability', 'en', vars, 'biz-abc');
      const result2 = engine.renderWithABTest('tax', 'vat_liability', 'en', vars, 'biz-abc');

      expect(result1.templateId).toBe(result2.templateId);
      expect(result1.templateVersion).toBe(result2.templateVersion);
      expect(result1.title).toBe(result2.title);
    });

    it('should distribute across versions for different businessIds', () => {
      engine.registerTemplate(
        makeTemplate({
          id: 'tpl-tax-vat-en-v2',
          version: '2.0.0',
          titleTemplate: 'V2 VAT: {{amount}}',
          bodyTemplate: 'V2 body for {{period}}.',
          variables: [
            { name: 'amount', type: 'currency', required: true },
            { name: 'period', type: 'string', required: true },
            { name: 'transactionCount', type: 'number', required: true },
            { name: 'deadline', type: 'date', required: true },
          ],
        }),
      );

      const vars = {
        amount: 100000000,
        period: 'Q1 2025',
        transactionCount: 50,
        deadline: createWATDate(2025, 3, 31, 23, 59, 0),
      };

      const selectedVersions = new Set<string>();
      // Try many business IDs to get distribution across 2 versions
      for (let i = 0; i < 100; i++) {
        const result = engine.renderWithABTest('tax', 'vat_liability', 'en', vars, `biz-${i}`);
        selectedVersions.add(result.templateVersion);
      }

      expect(selectedVersions.size).toBe(2);
    });

    it('should throw when no templates exist for the given key', () => {
      expect(() =>
        engine.renderWithABTest('operational', 'vat_liability', 'en', {}, 'biz-001'),
      ).toThrow('No templates found');
    });

    it('should work with a single version (no A/B split)', () => {
      const result = engine.renderWithABTest(
        'cashflow',
        'negative_projection',
        'en',
        {
          days: 10,
          shortfall: 50000000,
          currentBalance: 120000000,
        },
        'biz-single',
      );

      expect(result.templateVersion).toBe('1.0.0');
      expect(result.title).toContain('10');
    });
  });
});

// ─── Test Helpers ──────────────────────────────────────────────────────────

function makeTemplate(overrides: Partial<InsightTemplate> = {}): InsightTemplate {
  return {
    id: 'tpl-test-001',
    version: '1.0.0',
    category: 'tax',
    type: 'vat_liability',
    locale: 'en',
    titleTemplate: '{{title}}',
    bodyTemplate: '{{body}}',
    actionItemTemplates: [],
    variables: [],
    ...overrides,
  };
}
