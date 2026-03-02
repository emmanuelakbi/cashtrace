/**
 * Template Engine for the Insights Engine module.
 *
 * Renders insight templates with variable substitution, type-aware formatting,
 * and locale support (English and Nigerian Pidgin).
 *
 * @module insights/services/templateEngine
 * @see Requirements 12.1, 12.2, 12.5, 12.6
 */

import { formatShortDateWAT } from '../../utils/timezone.js';
import { formatNaira } from '../types/index.js';

import type {
  ActionItemTemplate,
  InsightCategory,
  InsightTemplate,
  InsightType,
  TemplateVariable,
} from '../types/index.js';

// ─── Public Interfaces ─────────────────────────────────────────────────────

export interface RenderedInsight {
  title: string;
  body: string;
  actionItems: Array<{
    description: string;
    actionType: 'navigate' | 'external_link' | 'api_call';
    actionData: Record<string, unknown>;
  }>;
}

export interface ValidationResult {
  valid: boolean;
  missingVariables: string[];
  extraVariables: string[];
}

export interface ABTestResult extends RenderedInsight {
  templateId: string;
  templateVersion: string;
}

// ─── Variable Placeholder Pattern ──────────────────────────────────────────

const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

// ─── Template Engine ───────────────────────────────────────────────────────

export class TemplateEngine {
  private readonly templates: Map<string, InsightTemplate[]>;

  constructor() {
    this.templates = new Map();
    this.registerDefaultTemplates();
  }

  /**
   * Render a template with the given variables.
   *
   * Validates required variables, formats values by type, and substitutes
   * placeholders in title, body, and action item templates.
   *
   * @throws Error if required variables are missing
   */
  render(template: InsightTemplate, variables: Record<string, unknown>): RenderedInsight {
    const validation = this.validateVariables(template, variables);
    if (!validation.valid) {
      throw new Error(
        `Missing required template variables: ${validation.missingVariables.join(', ')}`,
      );
    }

    const formattedVars = this.formatVariables(template.variables, variables);

    return {
      title: this.substituteVariables(template.titleTemplate, formattedVars),
      body: this.substituteVariables(template.bodyTemplate, formattedVars),
      actionItems: template.actionItemTemplates.map((item) =>
        this.renderActionItem(item, formattedVars),
      ),
    };
  }

  /**
   * Look up a built-in template by category, type, and locale.
   * Returns the latest version (highest version string) when multiple exist.
   */
  getTemplate(
    category: InsightCategory,
    type: InsightType,
    locale: 'en' | 'pcm' = 'en',
  ): InsightTemplate | undefined {
    const key = this.templateKey(category, type, locale);
    const versions = this.templates.get(key);
    if (!versions || versions.length === 0) {
      return undefined;
    }
    return this.latestVersion(versions);
  }

  /**
   * Return all registered default templates (latest version of each).
   */
  getDefaultTemplates(): InsightTemplate[] {
    const result: InsightTemplate[] = [];
    for (const versions of this.templates.values()) {
      const latest = this.latestVersion(versions);
      if (latest) {
        result.push(latest);
      }
    }
    return result;
  }

  /**
   * Register a new template version. If a template with the same
   * category/type/locale already exists, the new version is appended.
   */
  registerTemplate(template: InsightTemplate): void {
    const key = this.templateKey(template.category, template.type, template.locale);
    const existing = this.templates.get(key) ?? [];
    existing.push(template);
    this.templates.set(key, existing);
  }

  /**
   * Return all registered versions for a given category/type/locale.
   */
  getTemplateVersions(
    category: InsightCategory,
    type: InsightType,
    locale: 'en' | 'pcm' = 'en',
  ): InsightTemplate[] {
    const key = this.templateKey(category, type, locale);
    return this.templates.get(key) ?? [];
  }

  /**
   * Render a template selected via deterministic A/B testing.
   *
   * Uses a hash of `businessId` to pick a consistent variant from all
   * registered versions of the given category/type/locale.
   */
  renderWithABTest(
    category: InsightCategory,
    type: InsightType,
    locale: 'en' | 'pcm',
    variables: Record<string, unknown>,
    businessId: string,
  ): ABTestResult {
    const versions = this.getTemplateVersions(category, type, locale);
    if (versions.length === 0) {
      throw new Error(`No templates found for ${category}:${type}:${locale}`);
    }

    const index = this.hashCode(businessId) % versions.length;
    const selected = versions[index]!;
    const rendered = this.render(selected, variables);

    return {
      ...rendered,
      templateId: selected.id,
      templateVersion: selected.version,
    };
  }

  /**
   * Validate that all required variables are present and report extras.
   */
  validateVariables(
    template: InsightTemplate,
    variables: Record<string, unknown>,
  ): ValidationResult {
    const definedNames = new Set(template.variables.map((v) => v.name));
    const providedNames = new Set(Object.keys(variables));

    const missingVariables = template.variables
      .filter((v) => v.required && !providedNames.has(v.name))
      .map((v) => v.name);

    const extraVariables = [...providedNames].filter((name) => !definedNames.has(name));

    return {
      valid: missingVariables.length === 0,
      missingVariables,
      extraVariables,
    };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────

  private templateKey(category: string, type: string, locale: string): string {
    return `${category}:${type}:${locale}`;
  }

  /**
   * Deterministic hash of a string — sum of char codes.
   * Returns a non-negative integer.
   */
  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash += str.charCodeAt(i);
    }
    return Math.abs(hash);
  }

  /**
   * Return the template with the highest semver-style version string.
   */
  private latestVersion(versions: InsightTemplate[]): InsightTemplate | undefined {
    if (versions.length === 0) return undefined;
    return versions.reduce((latest, current) =>
      current.version.localeCompare(latest.version, undefined, { numeric: true }) > 0
        ? current
        : latest,
    );
  }

  private formatVariables(
    variableDefs: TemplateVariable[],
    variables: Record<string, unknown>,
  ): Record<string, string> {
    const formatted: Record<string, string> = {};
    const defMap = new Map(variableDefs.map((v) => [v.name, v]));

    for (const [name, value] of Object.entries(variables)) {
      const def = defMap.get(name);
      const varType = def?.type ?? 'string';
      formatted[name] = this.formatValue(value, varType);
    }

    return formatted;
  }

  private formatValue(value: unknown, type: string): string {
    if (value === null || value === undefined) {
      return '';
    }

    switch (type) {
      case 'currency':
        return formatNaira(Number(value));

      case 'number':
        return Number(value).toLocaleString('en-NG');

      case 'date': {
        const date = value instanceof Date ? value : new Date(String(value));
        return formatShortDateWAT(date);
      }

      case 'string':
      default:
        return String(value);
    }
  }

  private substituteVariables(template: string, variables: Record<string, string>): string {
    return template.replace(VARIABLE_PATTERN, (_match, name: string) => {
      return variables[name] ?? `{{${name}}}`;
    });
  }

  private renderActionItem(
    item: ActionItemTemplate,
    variables: Record<string, string>,
  ): RenderedInsight['actionItems'][number] {
    return {
      description: this.substituteVariables(item.description, variables),
      actionType: item.actionType,
      actionData: item.actionData,
    };
  }

  // ─── Default Template Registration ─────────────────────────────────────

  private registerDefaultTemplates(): void {
    const templates = [...this.englishTemplates(), ...this.pidginTemplates()];
    for (const t of templates) {
      this.registerTemplate(t);
    }
  }

  private englishTemplates(): InsightTemplate[] {
    return [
      {
        id: 'tpl-tax-vat-en-001',
        version: '1.0.0',
        category: 'tax',
        type: 'vat_liability',
        locale: 'en',
        titleTemplate: 'VAT Liability: {{amount}}',
        bodyTemplate:
          'Your estimated VAT liability for {{period}} is {{amount}}. ' +
          'This is based on {{transactionCount}} taxable transactions. ' +
          'Filing deadline is {{deadline}}.',
        actionItemTemplates: [
          {
            description: 'Review VAT transactions for {{period}}',
            actionType: 'navigate',
            actionData: { route: '/transactions', filter: 'vat' },
          },
          {
            description: 'File VAT return on FIRS portal',
            actionType: 'external_link',
            actionData: { url: 'https://taxpromax.firs.gov.ng' },
          },
        ],
        variables: [
          { name: 'amount', type: 'currency', required: true },
          { name: 'period', type: 'string', required: true },
          { name: 'transactionCount', type: 'number', required: true },
          { name: 'deadline', type: 'date', required: true },
        ],
      },
      {
        id: 'tpl-cashflow-neg-en-001',
        version: '1.0.0',
        category: 'cashflow',
        type: 'negative_projection',
        locale: 'en',
        titleTemplate: 'Cashflow Alert: Negative in {{days}} Days',
        bodyTemplate:
          'Your projected cashflow will turn negative in {{days}} days. ' +
          'Expected shortfall is {{shortfall}}. ' +
          'Current balance is {{currentBalance}}.',
        actionItemTemplates: [
          {
            description: 'Review upcoming expenses',
            actionType: 'navigate',
            actionData: { route: '/cashflow', view: 'projection' },
          },
        ],
        variables: [
          { name: 'days', type: 'number', required: true },
          { name: 'shortfall', type: 'currency', required: true },
          { name: 'currentBalance', type: 'currency', required: true },
        ],
      },
      {
        id: 'tpl-spending-personal-en-001',
        version: '1.0.0',
        category: 'spending',
        type: 'personal_spending',
        locale: 'en',
        titleTemplate: 'Personal Spending Detected: {{percentage}}%',
        bodyTemplate:
          'We detected {{percentage}}% of your business expenses may be personal spending, ' +
          'totalling {{amount}}. ' +
          'This could affect your tax deductions and financial reporting.',
        actionItemTemplates: [
          {
            description: 'Review flagged transactions ({{count}} items)',
            actionType: 'navigate',
            actionData: { route: '/transactions', filter: 'personal' },
          },
        ],
        variables: [
          { name: 'percentage', type: 'number', required: true },
          { name: 'amount', type: 'currency', required: true },
          { name: 'count', type: 'number', required: false },
        ],
      },
      {
        id: 'tpl-compliance-deadline-en-001',
        version: '1.0.0',
        category: 'compliance',
        type: 'compliance_deadline',
        locale: 'en',
        titleTemplate: 'Compliance Deadline: {{regulatoryBody}}',
        bodyTemplate:
          'Your {{filingType}} filing with {{regulatoryBody}} is due on {{deadline}}. ' +
          'You have {{daysRemaining}} days remaining to complete this requirement.',
        actionItemTemplates: [
          {
            description: 'Start {{filingType}} preparation',
            actionType: 'navigate',
            actionData: { route: '/compliance', action: 'prepare' },
          },
        ],
        variables: [
          { name: 'regulatoryBody', type: 'string', required: true },
          { name: 'filingType', type: 'string', required: true },
          { name: 'deadline', type: 'date', required: true },
          { name: 'daysRemaining', type: 'number', required: true },
        ],
      },
      {
        id: 'tpl-revenue-opportunity-en-001',
        version: '1.0.0',
        category: 'revenue',
        type: 'revenue_opportunity',
        locale: 'en',
        titleTemplate: 'Revenue Opportunity: {{opportunityType}}',
        bodyTemplate:
          'We identified a revenue opportunity in {{category}}. ' +
          'Estimated potential is {{potentialRevenue}}. ' +
          '{{description}}',
        actionItemTemplates: [
          {
            description: 'View detailed analysis',
            actionType: 'navigate',
            actionData: { route: '/insights/revenue', view: 'opportunity' },
          },
        ],
        variables: [
          { name: 'opportunityType', type: 'string', required: true },
          { name: 'category', type: 'string', required: true },
          { name: 'potentialRevenue', type: 'currency', required: true },
          { name: 'description', type: 'string', required: false },
        ],
      },
    ];
  }

  private pidginTemplates(): InsightTemplate[] {
    return [
      {
        id: 'tpl-tax-vat-pcm-001',
        version: '1.0.0',
        category: 'tax',
        type: 'vat_liability',
        locale: 'pcm',
        titleTemplate: 'VAT Wahala: {{amount}}',
        bodyTemplate:
          'Your VAT wey you suppose pay for {{period}} na {{amount}}. ' +
          'E come from {{transactionCount}} transactions wey get VAT. ' +
          'Make you pay before {{deadline}} o.',
        actionItemTemplates: [
          {
            description: 'Check your VAT transactions for {{period}}',
            actionType: 'navigate',
            actionData: { route: '/transactions', filter: 'vat' },
          },
          {
            description: 'Go FIRS portal go file your VAT',
            actionType: 'external_link',
            actionData: { url: 'https://taxpromax.firs.gov.ng' },
          },
        ],
        variables: [
          { name: 'amount', type: 'currency', required: true },
          { name: 'period', type: 'string', required: true },
          { name: 'transactionCount', type: 'number', required: true },
          { name: 'deadline', type: 'date', required: true },
        ],
      },
      {
        id: 'tpl-cashflow-neg-pcm-001',
        version: '1.0.0',
        category: 'cashflow',
        type: 'negative_projection',
        locale: 'pcm',
        titleTemplate: 'Money Wahala: E go finish for {{days}} Days',
        bodyTemplate:
          'Your money fit run out for {{days}} days time. ' +
          'You go short {{shortfall}}. ' +
          'Wetin you get now na {{currentBalance}}.',
        actionItemTemplates: [
          {
            description: 'Check wetin you wan spend soon',
            actionType: 'navigate',
            actionData: { route: '/cashflow', view: 'projection' },
          },
        ],
        variables: [
          { name: 'days', type: 'number', required: true },
          { name: 'shortfall', type: 'currency', required: true },
          { name: 'currentBalance', type: 'currency', required: true },
        ],
      },
      {
        id: 'tpl-spending-personal-pcm-001',
        version: '1.0.0',
        category: 'spending',
        type: 'personal_spending',
        locale: 'pcm',
        titleTemplate: 'Personal Spending Alert: {{percentage}}%',
        bodyTemplate:
          'We see say {{percentage}}% of your business money na personal spending, ' +
          'e reach {{amount}}. ' +
          'Dis one fit affect your tax and your records o.',
        actionItemTemplates: [
          {
            description: 'Check the transactions wey we flag ({{count}} items)',
            actionType: 'navigate',
            actionData: { route: '/transactions', filter: 'personal' },
          },
        ],
        variables: [
          { name: 'percentage', type: 'number', required: true },
          { name: 'amount', type: 'currency', required: true },
          { name: 'count', type: 'number', required: false },
        ],
      },
      {
        id: 'tpl-compliance-deadline-pcm-001',
        version: '1.0.0',
        category: 'compliance',
        type: 'compliance_deadline',
        locale: 'pcm',
        titleTemplate: 'Deadline Dey Come: {{regulatoryBody}}',
        bodyTemplate:
          'Your {{filingType}} for {{regulatoryBody}} go due on {{deadline}}. ' +
          'You still get {{daysRemaining}} days to finish am.',
        actionItemTemplates: [
          {
            description: 'Start to prepare your {{filingType}}',
            actionType: 'navigate',
            actionData: { route: '/compliance', action: 'prepare' },
          },
        ],
        variables: [
          { name: 'regulatoryBody', type: 'string', required: true },
          { name: 'filingType', type: 'string', required: true },
          { name: 'deadline', type: 'date', required: true },
          { name: 'daysRemaining', type: 'number', required: true },
        ],
      },
      {
        id: 'tpl-revenue-opportunity-pcm-001',
        version: '1.0.0',
        category: 'revenue',
        type: 'revenue_opportunity',
        locale: 'pcm',
        titleTemplate: 'Money Opportunity: {{opportunityType}}',
        bodyTemplate:
          'We don see one opportunity for {{category}}. ' +
          'E fit bring {{potentialRevenue}}. ' +
          '{{description}}',
        actionItemTemplates: [
          {
            description: 'Check the full analysis',
            actionType: 'navigate',
            actionData: { route: '/insights/revenue', view: 'opportunity' },
          },
        ],
        variables: [
          { name: 'opportunityType', type: 'string', required: true },
          { name: 'category', type: 'string', required: true },
          { name: 'potentialRevenue', type: 'currency', required: true },
          { name: 'description', type: 'string', required: false },
        ],
      },
    ];
  }
}
