/**
 * Unit tests for the input sanitization middleware.
 *
 * @see Requirements: 2.5 — sanitize string inputs to prevent injection attacks
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

import { sanitizeString, sanitizeValue, createSanitizerMiddleware } from './sanitizer.js';

// ─── sanitizeString ──────────────────────────────────────────────────────────

describe('sanitizeString', () => {
  it('should strip HTML tags', () => {
    expect(sanitizeString('<script>alert("xss")</script>')).toBe('alert("xss")');
    expect(sanitizeString('<b>bold</b>')).toBe('bold');
    expect(sanitizeString('hello <img src=x onerror=alert(1)> world')).toBe('hello  world');
  });

  it('should remove null bytes', () => {
    expect(sanitizeString('hello\0world')).toBe('helloworld');
    expect(sanitizeString('\0\0\0')).toBe('');
  });

  it('should trim whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
    expect(sanitizeString('\thello\n')).toBe('hello');
  });

  it('should handle combined cases', () => {
    expect(sanitizeString('  <b>hello\0</b>  ')).toBe('hello');
  });

  it('should return empty string for empty input', () => {
    expect(sanitizeString('')).toBe('');
    expect(sanitizeString('   ')).toBe('');
  });

  it('should preserve normal text', () => {
    expect(sanitizeString('hello world')).toBe('hello world');
  });
});

// ─── sanitizeValue ───────────────────────────────────────────────────────────

describe('sanitizeValue', () => {
  it('should sanitize string values', () => {
    expect(sanitizeValue('<b>test</b>')).toBe('test');
  });

  it('should preserve numbers', () => {
    expect(sanitizeValue(42)).toBe(42);
    expect(sanitizeValue(0)).toBe(0);
    expect(sanitizeValue(-1.5)).toBe(-1.5);
  });

  it('should preserve booleans', () => {
    expect(sanitizeValue(true)).toBe(true);
    expect(sanitizeValue(false)).toBe(false);
  });

  it('should preserve null and undefined', () => {
    expect(sanitizeValue(null)).toBe(null);
    expect(sanitizeValue(undefined)).toBe(undefined);
  });

  it('should recursively sanitize objects', () => {
    const input = {
      name: '  <script>xss</script>  ',
      age: 25,
      active: true,
      nested: {
        value: '<b>bold\0</b>',
        count: 10,
      },
    };

    expect(sanitizeValue(input)).toEqual({
      name: 'xss',
      age: 25,
      active: true,
      nested: {
        value: 'bold',
        count: 10,
      },
    });
  });

  it('should recursively sanitize arrays', () => {
    const input = ['<b>one</b>', 42, '<script>two</script>', true];
    expect(sanitizeValue(input)).toEqual(['one', 42, 'two', true]);
  });

  it('should handle arrays of objects', () => {
    const input = [
      { name: '<b>Alice\0</b>', score: 100 },
      { name: '  Bob  ', score: 90 },
    ];

    expect(sanitizeValue(input)).toEqual([
      { name: 'Alice', score: 100 },
      { name: 'Bob', score: 90 },
    ]);
  });

  it('should handle empty objects and arrays', () => {
    expect(sanitizeValue({})).toEqual({});
    expect(sanitizeValue([])).toEqual([]);
  });
});

// ─── createSanitizerMiddleware ───────────────────────────────────────────────

describe('createSanitizerMiddleware', () => {
  function createTestApp(): express.Express {
    const app = express();
    app.use(express.json());
    app.use(createSanitizerMiddleware());

    app.post('/test', (req, res) => {
      res.json({ body: req.body, query: req.query });
    });

    app.get('/test', (req, res) => {
      res.json({ query: req.query });
    });

    return app;
  }

  it('should sanitize request body strings', async () => {
    const app = createTestApp();

    const response = await request(app)
      .post('/test')
      .send({ name: '<script>alert("xss")</script>' })
      .expect(200);

    expect(response.body.body.name).toBe('alert("xss")');
  });

  it('should sanitize query parameters', async () => {
    const app = createTestApp();

    const response = await request(app)
      .get('/test?search=%3Cscript%3Exss%3C/script%3E')
      .expect(200);

    expect(response.body.query.search).toBe('xss');
  });

  it('should preserve non-string body values', async () => {
    const app = createTestApp();

    const response = await request(app)
      .post('/test')
      .send({ name: '<b>test</b>', count: 5, active: true })
      .expect(200);

    expect(response.body.body).toEqual({ name: 'test', count: 5, active: true });
  });

  it('should sanitize nested body objects', async () => {
    const app = createTestApp();

    const response = await request(app)
      .post('/test')
      .send({
        user: {
          name: '  <b>Alice</b>  ',
          tags: ['<i>admin</i>', 'user'],
        },
      })
      .expect(200);

    expect(response.body.body).toEqual({
      user: {
        name: 'Alice',
        tags: ['admin', 'user'],
      },
    });
  });

  it('should handle requests with no body', async () => {
    const app = createTestApp();

    const response = await request(app).get('/test').expect(200);

    expect(response.body.query).toEqual({});
  });
});
