/**
 * WCAG 2.1 Color Contrast Utilities
 *
 * Implements relative luminance and contrast ratio calculations per the
 * WCAG 2.1 specification for verifying AA compliance.
 *
 * @see https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 * @see https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */

/**
 * Parse a hex color string into its RGB components (0–255).
 * Supports both shorthand (#abc) and full (#aabbcc) formats.
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace(/^#/, '');

  let r: number;
  let g: number;
  let b: number;

  if (cleaned.length === 3) {
    r = parseInt(cleaned[0]! + cleaned[0]!, 16);
    g = parseInt(cleaned[1]! + cleaned[1]!, 16);
    b = parseInt(cleaned[2]! + cleaned[2]!, 16);
  } else if (cleaned.length === 6) {
    r = parseInt(cleaned.slice(0, 2), 16);
    g = parseInt(cleaned.slice(2, 4), 16);
    b = parseInt(cleaned.slice(4, 6), 16);
  } else {
    throw new Error(`Invalid hex color: ${hex}`);
  }

  return { r, g, b };
}

/**
 * Compute the relative luminance of a color per WCAG 2.1.
 *
 * Each sRGB channel is linearized: if the 0–1 value is ≤ 0.04045 the
 * linear value is V/12.92, otherwise ((V + 0.055) / 1.055) ^ 2.4.
 *
 * L = 0.2126 * R + 0.7152 * G + 0.0722 * B
 */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);

  const linearize = (channel: number): number => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };

  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * Compute the WCAG 2.1 contrast ratio between two colors.
 *
 * Contrast ratio = (L1 + 0.05) / (L2 + 0.05) where L1 is the lighter
 * luminance and L2 is the darker luminance.
 *
 * Returns a value between 1 (no contrast) and 21 (max contrast).
 */
export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA minimum contrast ratio for normal text (< 18pt or < 14pt bold). */
export const AA_NORMAL_TEXT = 4.5;

/** WCAG AA minimum contrast ratio for large text (≥ 18pt or ≥ 14pt bold). */
export const AA_LARGE_TEXT = 3;

/**
 * Check whether a foreground/background pair meets WCAG AA for normal text.
 */
export function meetsAANormalText(foreground: string, background: string): boolean {
  return contrastRatio(foreground, background) >= AA_NORMAL_TEXT;
}

/**
 * Check whether a foreground/background pair meets WCAG AA for large text.
 */
export function meetsAALargeText(foreground: string, background: string): boolean {
  return contrastRatio(foreground, background) >= AA_LARGE_TEXT;
}
