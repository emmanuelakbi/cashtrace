// Gemini Integration - JSON repair utility
// Validates: Requirements 5.4
// Property 8: JSON Repair Idempotence

/**
 * Result of attempting to repair malformed JSON.
 */
export interface RepairResult {
  success: boolean;
  repairedJson: object | null;
  repairs: string[];
}

/**
 * Attempts to parse and repair malformed JSON strings commonly returned by Gemini.
 *
 * Handles common issues:
 * 1. Markdown code fences wrapping JSON
 * 2. JavaScript-style comments (// and /* *​/)
 * 3. Trailing commas in arrays and objects
 * 4. Single-quoted strings
 * 5. Unquoted keys
 * 6. Missing closing brackets/braces (simple cases)
 *
 * If the input is already valid JSON, returns it unchanged with empty repairs array.
 *
 * @param raw - The raw string to parse/repair
 * @returns RepairResult with success status, parsed object, and list of repairs made
 */
export function repairJson(raw: string): RepairResult {
  const repairs: string[] = [];

  // Try parsing as-is first (fast path for valid JSON)
  const directParse = tryParse(raw);
  if (directParse !== undefined) {
    return { success: true, repairedJson: directParse, repairs: [] };
  }

  let text = raw;

  // 1. Strip markdown code fences
  const fenceResult = stripMarkdownFences(text);
  if (fenceResult.changed) {
    text = fenceResult.text;
    repairs.push('Removed markdown code fences');
  }

  // Try parsing after fence removal
  const afterFences = tryParse(text);
  if (afterFences !== undefined) {
    return { success: true, repairedJson: afterFences, repairs };
  }

  // 2. Remove JavaScript-style comments
  const commentResult = removeComments(text);
  if (commentResult.changed) {
    text = commentResult.text;
    repairs.push('Removed JavaScript-style comments');
  }

  // Try parsing after comment removal
  const afterComments = tryParse(text);
  if (afterComments !== undefined) {
    return { success: true, repairedJson: afterComments, repairs };
  }

  // 3. Remove trailing commas
  const trailingResult = removeTrailingCommas(text);
  if (trailingResult.changed) {
    text = trailingResult.text;
    repairs.push('Removed trailing commas');
  }

  // Try parsing after trailing comma removal
  const afterTrailing = tryParse(text);
  if (afterTrailing !== undefined) {
    return { success: true, repairedJson: afterTrailing, repairs };
  }

  // 4. Replace single-quoted strings with double-quoted
  const singleQuoteResult = replaceSingleQuotes(text);
  if (singleQuoteResult.changed) {
    text = singleQuoteResult.text;
    repairs.push('Replaced single-quoted strings with double quotes');
  }

  // Try parsing after single quote replacement
  const afterSingleQuotes = tryParse(text);
  if (afterSingleQuotes !== undefined) {
    return { success: true, repairedJson: afterSingleQuotes, repairs };
  }

  // 5. Quote unquoted keys
  const unquotedResult = quoteUnquotedKeys(text);
  if (unquotedResult.changed) {
    text = unquotedResult.text;
    repairs.push('Added quotes to unquoted object keys');
  }

  // Try parsing after quoting keys
  const afterQuoting = tryParse(text);
  if (afterQuoting !== undefined) {
    return { success: true, repairedJson: afterQuoting, repairs };
  }

  // 6. Fix missing closing brackets/braces
  const bracketResult = fixMissingClosingBrackets(text);
  if (bracketResult.changed) {
    text = bracketResult.text;
    repairs.push('Added missing closing brackets/braces');
  }

  // Final parse attempt
  const finalParse = tryParse(text);
  if (finalParse !== undefined) {
    return { success: true, repairedJson: finalParse, repairs };
  }

  return { success: false, repairedJson: null, repairs };
}

/**
 * Attempts to parse a string as JSON, returning the parsed object or undefined on failure.
 * Only accepts objects and arrays (not primitives) since Gemini responses are always structured.
 */
function tryParse(text: string): object | undefined {
  try {
    const parsed: unknown = JSON.parse(text.trim());
    if (parsed !== null && typeof parsed === 'object') {
      return parsed as object;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

interface TransformResult {
  text: string;
  changed: boolean;
}

/**
 * Strips markdown code fences (```json ... ``` or ``` ... ```).
 */
function stripMarkdownFences(text: string): TransformResult {
  const trimmed = text.trim();
  // Match ```json or ``` at start, and ``` at end
  const fencePattern = /^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```$/;
  const match = fencePattern.exec(trimmed);
  if (match?.[1] !== undefined) {
    return { text: match[1], changed: true };
  }
  return { text, changed: false };
}

/**
 * Removes JavaScript-style single-line (//) and multi-line comments.
 * Preserves strings containing // or /* patterns.
 */
function removeComments(text: string): TransformResult {
  let result = '';
  let changed = false;
  let i = 0;

  while (i < text.length) {
    // Handle strings - skip over them entirely
    if (text[i] === '"') {
      const end = findStringEnd(text, i);
      result += text.slice(i, end);
      i = end;
      continue;
    }

    // Single-line comment
    if (text[i] === '/' && i + 1 < text.length && text[i + 1] === '/') {
      changed = true;
      // Skip to end of line
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
      continue;
    }

    // Multi-line comment
    if (text[i] === '/' && i + 1 < text.length && text[i + 1] === '*') {
      changed = true;
      i += 2;
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) {
        i++;
      }
      if (i < text.length - 1) {
        i += 2; // skip */
      }
      continue;
    }

    result += text[i];
    i++;
  }

  return { text: result, changed };
}

/**
 * Finds the end index of a JSON string starting at position `start` (which should be a `"`).
 * Handles escaped characters.
 */
function findStringEnd(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2; // skip escaped character
      continue;
    }
    if (text[i] === '"') {
      return i + 1;
    }
    i++;
  }
  return text.length;
}

/**
 * Removes trailing commas before closing brackets/braces.
 * Handles: [1, 2, 3,] → [1, 2, 3] and {"a": 1,} → {"a": 1}
 */
function removeTrailingCommas(text: string): TransformResult {
  let result = '';
  let changed = false;
  let i = 0;

  while (i < text.length) {
    // Skip over strings
    if (text[i] === '"') {
      const end = findStringEnd(text, i);
      result += text.slice(i, end);
      i = end;
      continue;
    }

    if (text[i] === ',') {
      // Look ahead past whitespace for ] or }
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j]!)) {
        j++;
      }
      if (j < text.length && (text[j] === ']' || text[j] === '}')) {
        changed = true;
        // Skip the comma, keep the whitespace
        i++;
        continue;
      }
    }

    result += text[i];
    i++;
  }

  return { text: result, changed };
}

/**
 * Replaces single-quoted strings with double-quoted strings.
 * Handles escaped single quotes within single-quoted strings.
 */
function replaceSingleQuotes(text: string): TransformResult {
  let result = '';
  let changed = false;
  let i = 0;

  while (i < text.length) {
    // Skip over existing double-quoted strings
    if (text[i] === '"') {
      const end = findStringEnd(text, i);
      result += text.slice(i, end);
      i = end;
      continue;
    }

    if (text[i] === "'") {
      changed = true;
      result += '"';
      i++;
      // Read until closing single quote
      while (i < text.length) {
        if (text[i] === '\\' && i + 1 < text.length && text[i + 1] === "'") {
          // Escaped single quote → just the quote character
          result += "'";
          i += 2;
          continue;
        }
        if (text[i] === '"') {
          // Escape double quotes inside the converted string
          result += '\\"';
          i++;
          continue;
        }
        if (text[i] === "'") {
          result += '"';
          i++;
          break;
        }
        result += text[i];
        i++;
      }
      continue;
    }

    result += text[i];
    i++;
  }

  return { text: result, changed };
}

/**
 * Adds double quotes to unquoted object keys.
 * Matches patterns like `{ key: value }` and converts to `{ "key": value }`.
 */
function quoteUnquotedKeys(text: string): TransformResult {
  let result = '';
  let changed = false;
  let i = 0;

  while (i < text.length) {
    // Skip over strings
    if (text[i] === '"') {
      const end = findStringEnd(text, i);
      result += text.slice(i, end);
      i = end;
      continue;
    }

    // Look for unquoted key pattern: identifier followed by colon
    // Must be after { or , (with optional whitespace)
    if (isIdentifierStart(text[i]!)) {
      // Check if this looks like an unquoted key
      let keyEnd = i;
      while (keyEnd < text.length && isIdentifierChar(text[keyEnd]!)) {
        keyEnd++;
      }

      // Skip whitespace after identifier
      let afterKey = keyEnd;
      while (afterKey < text.length && /\s/.test(text[afterKey]!)) {
        afterKey++;
      }

      // If followed by colon, this is an unquoted key
      if (afterKey < text.length && text[afterKey] === ':') {
        const key = text.slice(i, keyEnd);
        // Check it's not a JSON keyword (true, false, null)
        if (key !== 'true' && key !== 'false' && key !== 'null') {
          changed = true;
          result += `"${key}"`;
          i = keyEnd;
          continue;
        }
      }
    }

    result += text[i];
    i++;
  }

  return { text: result, changed };
}

function isIdentifierStart(ch: string): boolean {
  return /[a-zA-Z_$]/.test(ch);
}

function isIdentifierChar(ch: string): boolean {
  return /[a-zA-Z0-9_$]/.test(ch);
}

/**
 * Fixes simple cases of missing closing brackets/braces by counting
 * open vs close brackets outside of strings.
 */
function fixMissingClosingBrackets(text: string): TransformResult {
  let braceCount = 0;
  let bracketCount = 0;
  let i = 0;

  while (i < text.length) {
    if (text[i] === '"') {
      i = findStringEnd(text, i);
      continue;
    }

    if (text[i] === '{') braceCount++;
    else if (text[i] === '}') braceCount--;
    else if (text[i] === '[') bracketCount++;
    else if (text[i] === ']') bracketCount--;

    i++;
  }

  if (braceCount <= 0 && bracketCount <= 0) {
    return { text, changed: false };
  }

  let result = text.trimEnd();
  let changed = false;

  // Remove any trailing comma before adding closing brackets
  if (result.endsWith(',')) {
    result = result.slice(0, -1);
  }

  for (let b = 0; b < bracketCount; b++) {
    result += ']';
    changed = true;
  }
  for (let b = 0; b < braceCount; b++) {
    result += '}';
    changed = true;
  }

  return { text: result, changed };
}
