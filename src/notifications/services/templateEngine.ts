/**
 * Template Engine
 *
 * Renders notification content from database-stored templates with variable
 * substitution. Supports HTML, plain text, and push notification formats.
 *
 * Templates use `{{variableName}}` syntax for variable placeholders.
 *
 * @module notifications/services/templateEngine
 */

import type { Pool } from 'pg';

import type {
  NotificationCategory,
  NotificationTemplate,
  RenderedTemplate,
  TemplateVariable,
  ValidationResult,
} from '../types/index.js';
import { NOTIFICATION_ERROR_CODES } from '../types/index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Database row shape for notification_templates table. */
interface TemplateRow {
  id: string;
  version: string;
  category: NotificationCategory;
  subject: string;
  body_html: string;
  body_text: string;
  push_title: string;
  push_body: string;
  variables: TemplateVariable[];
  created_at: Date;
  updated_at: Date;
}

export interface TemplateEngine {
  /** Render a template with the given variables, returning all formats. */
  render(templateId: string, variables: Record<string, unknown>): Promise<RenderedTemplate>;
  /** Validate that all required template variables are present and correctly typed. */
  validate(templateId: string, variables: Record<string, unknown>): Promise<ValidationResult>;
  /** Fetch a template by ID from the database. */
  getTemplate(templateId: string): Promise<NotificationTemplate>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Map a database row to the TypeScript domain model. */
function rowToTemplate(row: TemplateRow): NotificationTemplate {
  return {
    id: row.id,
    version: row.version,
    category: row.category,
    subject: row.subject,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    pushTitle: row.push_title,
    pushBody: row.push_body,
    variables: row.variables,
  };
}

/** Substitute `{{variableName}}` placeholders in a string with values. */
function substituteVariables(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, varName: string) => {
    const value = variables[varName];
    if (value === undefined || value === null) {
      return '';
    }
    return String(value);
  });
}

/**
 * Validate variables against template requirements.
 * Returns missing (required but absent) and invalid (wrong type) variable names.
 */
function validateVariables(
  templateVars: TemplateVariable[],
  variables: Record<string, unknown>,
): ValidationResult {
  const missingVariables: string[] = [];
  const invalidVariables: string[] = [];

  for (const templateVar of templateVars) {
    const value = variables[templateVar.name];

    if (value === undefined || value === null) {
      if (templateVar.required && templateVar.defaultValue === undefined) {
        missingVariables.push(templateVar.name);
      }
      continue;
    }

    // Type checking
    const actualType = typeof value;
    switch (templateVar.type) {
      case 'string':
        if (actualType !== 'string') {
          invalidVariables.push(templateVar.name);
        }
        break;
      case 'number':
      case 'currency':
        if (actualType !== 'number') {
          invalidVariables.push(templateVar.name);
        }
        break;
      case 'date':
        if (!(value instanceof Date) && actualType !== 'string') {
          invalidVariables.push(templateVar.name);
        }
        break;
    }
  }

  return {
    valid: missingVariables.length === 0 && invalidVariables.length === 0,
    missingVariables,
    invalidVariables,
  };
}

/**
 * Merge provided variables with template defaults for any missing optional variables.
 */
function mergeWithDefaults(
  templateVars: TemplateVariable[],
  variables: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...variables };

  for (const templateVar of templateVars) {
    if (
      (merged[templateVar.name] === undefined || merged[templateVar.name] === null) &&
      templateVar.defaultValue !== undefined
    ) {
      merged[templateVar.name] = templateVar.defaultValue;
    }
  }

  return merged;
}

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * Create a PostgreSQL-backed template engine.
 *
 * Reads templates from the `notification_templates` table and renders them
 * by substituting `{{variableName}}` placeholders with provided values.
 * Validates that all required variables are present before rendering.
 */
export function createTemplateEngine(pool: Pool): TemplateEngine {
  async function getTemplate(templateId: string): Promise<NotificationTemplate> {
    const result = await pool.query<TemplateRow>(
      `SELECT id, version, category, subject, body_html, body_text,
              push_title, push_body, variables, created_at, updated_at
       FROM notification_templates
       WHERE id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [templateId],
    );

    if (result.rows.length === 0) {
      const error = new Error(`Template not found: ${templateId}`);
      error.name = NOTIFICATION_ERROR_CODES.NOTIF_INVALID_TEMPLATE;
      throw error;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return rowToTemplate(result.rows[0]!);
  }

  async function validate(
    templateId: string,
    variables: Record<string, unknown>,
  ): Promise<ValidationResult> {
    const template = await getTemplate(templateId);
    return validateVariables(template.variables, variables);
  }

  async function render(
    templateId: string,
    variables: Record<string, unknown>,
  ): Promise<RenderedTemplate> {
    const template = await getTemplate(templateId);
    const validation = validateVariables(template.variables, variables);

    if (!validation.valid) {
      const error = new Error(
        `Missing required variables: ${validation.missingVariables.join(', ')}`,
      );
      error.name = NOTIFICATION_ERROR_CODES.NOTIF_MISSING_VARIABLES;
      throw error;
    }

    const merged = mergeWithDefaults(template.variables, variables);

    return {
      subject: substituteVariables(template.subject, merged),
      bodyHtml: substituteVariables(template.bodyHtml, merged),
      bodyText: substituteVariables(template.bodyText, merged),
      pushTitle: substituteVariables(template.pushTitle, merged),
      pushBody: substituteVariables(template.pushBody, merged),
    };
  }

  return {
    render,
    validate,
    getTemplate,
  };
}
