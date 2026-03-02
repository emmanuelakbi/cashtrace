/**
 * Property-based tests for the request validator middleware.
 *
 * **Property 2: Validation Completeness**
 * For any request with validation schema, all required fields SHALL be
 * validated before reaching backend services.
 *
 * **Validates: Requirements 2.1, 2.2, 2.3**
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';

import { registerSchema, clearSchemas, validate, validatePart } from './validator.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid JSON-safe field name (lowercase alpha, 1-12 chars). */
const fieldNameArb = fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,11}$/).filter((s) => s.length > 0);

/** Generate a simple JSON-safe value of a correct type for a given JSON Schema type. */
function valueForType(type: string): fc.Arbitrary<unknown> {
  switch (type) {
    case 'string':
      return fc.string({ minLength: 1, maxLength: 50 });
    case 'number':
      return fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true });
    case 'integer':
      return fc.integer({ min: -1000000, max: 1000000 });
    case 'boolean':
      return fc.boolean();
    default:
      return fc.string({ minLength: 1, maxLength: 20 });
  }
}

/** JSON Schema types we test against. */
const schemaTypeArb = fc.constantFrom('string', 'number', 'integer', 'boolean');

/**
 * Generate a set of unique field names with associated JSON Schema types.
 * Returns an array of [fieldName, schemaType] tuples.
 */
const fieldDefsArb = fc
  .uniqueArray(fieldNameArb, { minLength: 1, maxLength: 5 })
  .chain((names) =>
    fc.tuple(
      fc.constant(names),
      fc.array(schemaTypeArb, { minLength: names.length, maxLength: names.length }),
    ),
  )
  .map(([names, types]) => names.map((name, i) => [name, types[i]] as [string, string]));

/** Generate a string that is NOT a valid email (no @ or malformed). */
const invalidEmailArb = fc.oneof(
  fc.constant(''),
  fc.constant('plaintext'),
  fc.constant('missing-at-sign.com'),
  fc.constant('@no-local-part.com'),
  fc.constant('spaces in@email.com'),
  fc.constant('double@@at.com'),
  fc.stringMatching(/^[a-z]{1,10}$/).filter((s) => !s.includes('@')),
);

// ─── Setup ───────────────────────────────────────────────────────────────────

const TEST_SCHEMA = 'prop-test-schema';

beforeEach(() => {
  clearSchemas();
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Validation Completeness (Property 2)', () => {
  /**
   * **Validates: Requirements 2.1**
   * For any object missing required fields, body validation always fails
   * with errors referencing those missing fields.
   */
  it('missing required body fields always produce validation errors', () => {
    fc.assert(
      fc.property(fieldDefsArb, (fieldDefs) => {
        const requiredFields = fieldDefs.map(([name]) => name);
        const properties: Record<string, { type: string }> = {};
        for (const [name, type] of fieldDefs) {
          properties[name] = { type };
        }

        registerSchema(TEST_SCHEMA, {
          body: {
            type: 'object',
            properties,
            required: requiredFields,
            additionalProperties: false,
          },
        });

        // Validate with an empty body — all required fields are missing
        const result = validate(TEST_SCHEMA, { body: {} });

        expect(result.valid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.length).toBeGreaterThanOrEqual(requiredFields.length);

        // Every required field must appear in the error paths
        for (const field of requiredFields) {
          const hasError = result.errors!.some((e) => e.path === `body.${field}`);
          expect(hasError).toBe(true);
        }

        clearSchemas();
      }),
      { numRuns: 150 },
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.2, 2.3**
   * For any object with all required fields of correct types, validation passes.
   */
  it('objects with all required fields of correct types always pass validation', () => {
    fc.assert(
      fc.property(
        fieldDefsArb.chain((defs) =>
          fc.tuple(
            fc.constant(defs),
            // Generate a value of the correct type for each field
            fc.tuple(...defs.map(([_, type]) => valueForType(type))),
          ),
        ),
        ([fieldDefs, values]) => {
          const requiredFields = fieldDefs.map(([name]) => name);
          const properties: Record<string, { type: string }> = {};
          for (const [name, type] of fieldDefs) {
            properties[name] = { type };
          }

          registerSchema(TEST_SCHEMA, {
            body: {
              type: 'object',
              properties,
              required: requiredFields,
            },
          });

          const body: Record<string, unknown> = {};
          fieldDefs.forEach(([name], i) => {
            body[name] = values[i];
          });

          const result = validate(TEST_SCHEMA, { body });
          expect(result.valid).toBe(true);

          clearSchemas();
        },
      ),
      { numRuns: 150 },
    );
  });

  /**
   * **Validates: Requirements 2.1**
   * For any invalid email format, body validation always catches it.
   */
  it('invalid email formats are always rejected by body validation', () => {
    fc.assert(
      fc.property(invalidEmailArb, (badEmail) => {
        registerSchema(TEST_SCHEMA, {
          body: {
            type: 'object',
            properties: {
              email: { type: 'string', format: 'email' },
            },
            required: ['email'],
          },
        });

        const result = validate(TEST_SCHEMA, { body: { email: badEmail } });

        expect(result.valid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.some((e) => e.path.includes('email'))).toBe(true);

        clearSchemas();
      }),
      { numRuns: 150 },
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.2, 2.3**
   * Validation errors always include the correct path prefix (body., query., params.).
   */
  it('validation errors always include the correct path prefix for each part', () => {
    fc.assert(
      fc.property(fc.constantFrom('body', 'query', 'params'), fieldNameArb, (part, fieldName) => {
        const schema = {
          type: 'object' as const,
          properties: {
            [fieldName]: { type: 'string' },
          },
          required: [fieldName],
        };

        // Validate an empty object against the part schema directly
        const result = validatePart(part, `${TEST_SCHEMA}-${part}`, schema, {});

        expect(result.valid).toBe(false);
        expect(result.errors).toBeDefined();

        // Every error path must start with the correct part prefix
        for (const error of result.errors!) {
          expect(error.path.startsWith(`${part}.`)).toBe(true);
        }
      }),
      { numRuns: 150 },
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.2, 2.3**
   * For any schema with N required fields, validating an empty object produces
   * at least N errors.
   */
  it('error count is at least the number of missing required fields', () => {
    fc.assert(
      fc.property(fieldDefsArb, (fieldDefs) => {
        const requiredFields = fieldDefs.map(([name]) => name);
        const properties: Record<string, { type: string }> = {};
        for (const [name, type] of fieldDefs) {
          properties[name] = { type };
        }

        registerSchema(TEST_SCHEMA, {
          body: {
            type: 'object',
            properties,
            required: requiredFields,
            additionalProperties: false,
          },
        });

        const result = validate(TEST_SCHEMA, { body: {} });

        expect(result.valid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.length).toBeGreaterThanOrEqual(requiredFields.length);

        clearSchemas();
      }),
      { numRuns: 150 },
    );
  });
});
