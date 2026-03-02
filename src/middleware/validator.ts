/**
 * Request validator middleware using JSON Schema (Ajv).
 *
 * Provides a schema registry, validation function, and Express middleware factory
 * that validates request body, query parameters, and path parameters against
 * registered JSON Schema definitions.
 *
 * @module middleware/validator
 * @see Requirements: 2.1, 2.2, 2.3, 2.4
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { ValidateFunction } from 'ajv';
import type { Request, Response, NextFunction } from 'express';

import type { ValidationError, ValidationResult } from '../gateway/types.js';
import { GATEWAY_ERROR_CODES } from '../gateway/types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** JSON Schema definition (loose type to support arbitrary schemas). */
export type JSONSchema = Record<string, unknown>;

/** Schema definition for request validation, supporting body/query/params. */
export interface RequestSchema {
  /** JSON Schema for request body (Req 2.1). */
  body?: JSONSchema;
  /** JSON Schema for query parameters (Req 2.2). */
  query?: JSONSchema;
  /** JSON Schema for path parameters (Req 2.3). */
  params?: JSONSchema;
}

// ─── Schema Registry ─────────────────────────────────────────────────────────

/** Internal registry mapping schema names to their request schemas. */
const schemaRegistry = new Map<string, RequestSchema>();

/** Ajv instance configured for JSON Schema draft-07. */
const ajv = new Ajv({
  allErrors: true,
  coerceTypes: 'array',
  removeAdditional: false,
  useDefaults: true,
});
addFormats(ajv);

/** Cache of compiled validators keyed by `${schemaName}:${part}`. */
const validatorCache = new Map<string, ValidateFunction>();

/**
 * Register a named request schema for later use in validation middleware.
 *
 * @param name - Unique schema name (e.g. "createBusiness")
 * @param schema - Request schema with optional body/query/params definitions
 */
export function registerSchema(name: string, schema: RequestSchema): void {
  schemaRegistry.set(name, schema);
  // Invalidate cached validators for this schema
  for (const part of ['body', 'query', 'params'] as const) {
    validatorCache.delete(`${name}:${part}`);
  }
}

/**
 * Look up a registered schema by name.
 *
 * @returns The registered RequestSchema, or undefined if not found.
 */
export function getSchema(name: string): RequestSchema | undefined {
  return schemaRegistry.get(name);
}

/**
 * Remove all registered schemas. Primarily useful for testing.
 */
export function clearSchemas(): void {
  schemaRegistry.clear();
  validatorCache.clear();
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Get or compile a validator for a specific schema part.
 */
function getValidator(schemaName: string, part: string, schema: JSONSchema): ValidateFunction {
  const cacheKey = `${schemaName}:${part}`;
  let validator = validatorCache.get(cacheKey);
  if (!validator) {
    validator = ajv.compile(schema);
    validatorCache.set(cacheKey, validator);
  }
  return validator;
}

/**
 * Convert Ajv errors to our ValidationError format.
 */
function toValidationErrors(
  part: string,
  errors: NonNullable<ValidateFunction['errors']>,
): ValidationError[] {
  return errors.map((err) => {
    const instancePath = err.instancePath
      ? err.instancePath.replace(/^\//, '').replace(/\//g, '.')
      : '';
    const fieldPath = instancePath ? `${part}.${instancePath}` : part;

    // For 'required' errors, append the missing property name
    if (err.keyword === 'required' && err.params && 'missingProperty' in err.params) {
      const missingProp = (err.params as { missingProperty: string }).missingProperty;
      return {
        path: `${part}.${missingProp}`,
        message: err.message ?? `must have required property '${missingProp}'`,
        keyword: err.keyword,
      };
    }

    return {
      path: fieldPath,
      message: err.message ?? 'validation failed',
      keyword: err.keyword ?? 'unknown',
    };
  });
}

/**
 * Validate data against a specific JSON Schema.
 *
 * @param part - The request part being validated (e.g. "body", "query", "params")
 * @param schemaName - The registered schema name
 * @param schema - The JSON Schema to validate against
 * @param data - The data to validate
 * @returns ValidationResult with valid flag and optional errors
 */
export function validatePart(
  part: string,
  schemaName: string,
  schema: JSONSchema,
  data: unknown,
): ValidationResult {
  const validator = getValidator(schemaName, part, schema);
  const valid = validator(data);

  if (valid) {
    return { valid: true };
  }

  return {
    valid: false,
    errors: toValidationErrors(part, validator.errors ?? []),
  };
}

/**
 * Validate data against a registered schema by name.
 * Validates all defined parts (body, query, params) and aggregates errors.
 *
 * @param schemaName - The registered schema name
 * @param data - Object with optional body, query, params properties
 * @returns ValidationResult with aggregated errors from all parts
 */
export function validate(
  schemaName: string,
  data: { body?: unknown; query?: unknown; params?: unknown },
): ValidationResult {
  const schema = schemaRegistry.get(schemaName);
  if (!schema) {
    return {
      valid: false,
      errors: [{ path: '', message: `Schema '${schemaName}' not found`, keyword: 'schema' }],
    };
  }

  const allErrors: ValidationError[] = [];

  if (schema.body) {
    const result = validatePart('body', schemaName, schema.body, data.body ?? {});
    if (!result.valid && result.errors) {
      allErrors.push(...result.errors);
    }
  }

  if (schema.query) {
    const result = validatePart('query', schemaName, schema.query, data.query ?? {});
    if (!result.valid && result.errors) {
      allErrors.push(...result.errors);
    }
  }

  if (schema.params) {
    const result = validatePart('params', schemaName, schema.params, data.params ?? {});
    if (!result.valid && result.errors) {
      allErrors.push(...result.errors);
    }
  }

  if (allErrors.length > 0) {
    return { valid: false, errors: allErrors };
  }

  return { valid: true };
}

// ─── Middleware Factory ──────────────────────────────────────────────────────

/**
 * Create an Express middleware that validates requests against a registered schema.
 *
 * - Validates req.body against the schema's body definition (Req 2.1)
 * - Validates req.query against the schema's query definition (Req 2.2)
 * - Validates req.params against the schema's params definition (Req 2.3)
 * - Returns HTTP 400 with detailed field errors on failure (Req 2.4)
 * - Includes correlationId in error responses
 *
 * @param schemaName - Name of the registered schema to validate against
 */
export function createValidatorMiddleware(
  schemaName: string,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = validate(schemaName, {
      body: req.body as unknown,
      query: req.query,
      params: req.params,
    });

    if (result.valid) {
      next();
      return;
    }

    const correlationId = req.context?.correlationId ?? 'unknown';

    // Build per-field error map for the response (Req 2.4)
    const fields: Record<string, string[]> = {};
    for (const err of result.errors ?? []) {
      if (!fields[err.path]) {
        fields[err.path] = [];
      }
      fields[err.path].push(err.message);
    }

    res.status(400).json({
      success: false,
      error: {
        code: GATEWAY_ERROR_CODES.VALIDATION_FAILED,
        message: 'Request validation failed',
        fields,
        correlationId,
        timestamp: new Date().toISOString(),
      },
    });
  };
}
