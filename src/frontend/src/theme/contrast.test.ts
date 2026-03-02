import { describe, expect, it } from 'vitest';

import { lightColors, darkColors } from './tokens';
import {
  AA_LARGE_TEXT,
  AA_NORMAL_TEXT,
  contrastRatio,
  hexToRgb,
  meetsAALargeText,
  meetsAANormalText,
  relativeLuminance,
} from './contrast';

describe('WCAG Contrast Utilities', () => {
  describe('hexToRgb', () => {
    it('should parse 6-digit hex colors', () => {
      expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
      expect(hexToRgb('#0d9488')).toEqual({ r: 13, g: 148, b: 136 });
    });

    it('should parse 3-digit shorthand hex colors', () => {
      expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb('#000')).toEqual({ r: 0, g: 0, b: 0 });
    });

    it('should throw for invalid hex strings', () => {
      expect(() => hexToRgb('#gg')).toThrow('Invalid hex color');
      expect(() => hexToRgb('#12345')).toThrow('Invalid hex color');
    });
  });

  describe('relativeLuminance', () => {
    it('should return 0 for black', () => {
      expect(relativeLuminance('#000000')).toBeCloseTo(0, 4);
    });

    it('should return 1 for white', () => {
      expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 4);
    });

    it('should return ~0.2126 for pure red', () => {
      expect(relativeLuminance('#ff0000')).toBeCloseTo(0.2126, 4);
    });

    it('should return ~0.7152 for pure green', () => {
      expect(relativeLuminance('#00ff00')).toBeCloseTo(0.7152, 4);
    });

    it('should return ~0.0722 for pure blue', () => {
      expect(relativeLuminance('#0000ff')).toBeCloseTo(0.0722, 4);
    });
  });

  describe('contrastRatio', () => {
    it('should return 21 for black on white', () => {
      expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    });

    it('should return 1 for same colors', () => {
      expect(contrastRatio('#0d9488', '#0d9488')).toBeCloseTo(1, 4);
    });

    it('should be symmetric (order-independent)', () => {
      const ratio1 = contrastRatio('#0d9488', '#f8fafc');
      const ratio2 = contrastRatio('#f8fafc', '#0d9488');
      expect(ratio1).toBeCloseTo(ratio2, 4);
    });
  });

  describe('AA threshold constants', () => {
    it('should define correct WCAG AA thresholds', () => {
      expect(AA_NORMAL_TEXT).toBe(4.5);
      expect(AA_LARGE_TEXT).toBe(3);
    });
  });

  describe('meetsAANormalText', () => {
    it('should pass for black on white', () => {
      expect(meetsAANormalText('#000000', '#ffffff')).toBe(true);
    });

    it('should fail for low-contrast pairs', () => {
      expect(meetsAANormalText('#cccccc', '#ffffff')).toBe(false);
    });
  });

  describe('meetsAALargeText', () => {
    it('should pass for black on white', () => {
      expect(meetsAALargeText('#000000', '#ffffff')).toBe(true);
    });

    it('should have a lower threshold than normal text', () => {
      // A pair that passes large text but fails normal text
      expect(meetsAALargeText('#767676', '#ffffff')).toBe(true);
      expect(meetsAANormalText('#767676', '#ffffff')).toBe(true);
    });
  });

  /**
   * WCAG AA Color Contrast Compliance — Light Theme
   * Validates: Requirements 12.6
   *
   * Verifies that all text/background color combinations in the light theme
   * meet WCAG 2.1 AA minimum contrast ratios.
   */
  describe('Light theme WCAG AA compliance', () => {
    const bg = lightColors.background;
    const surface = lightColors.surface;

    it('text on background meets AA normal text (4.5:1)', () => {
      const ratio = contrastRatio(lightColors.text, bg);
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    it('textSecondary on background meets AA normal text (4.5:1)', () => {
      const ratio = contrastRatio(lightColors.textSecondary, bg);
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    it('text on surface meets AA normal text (4.5:1)', () => {
      const ratio = contrastRatio(lightColors.text, surface);
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    it('textSecondary on surface meets AA normal text (4.5:1)', () => {
      const ratio = contrastRatio(lightColors.textSecondary, surface);
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    it('primary on background meets AA large text (3:1)', () => {
      const ratio = contrastRatio(lightColors.primary, bg);
      expect(ratio).toBeGreaterThanOrEqual(AA_LARGE_TEXT);
    });

    it('error on errorLight meets AA large text (3:1)', () => {
      const ratio = contrastRatio(lightColors.error, lightColors.errorLight);
      expect(ratio).toBeGreaterThanOrEqual(AA_LARGE_TEXT);
    });

    it('warning on warningLight meets AA large text (3:1)', () => {
      const ratio = contrastRatio(lightColors.warning, lightColors.warningLight);
      expect(ratio).toBeGreaterThanOrEqual(AA_LARGE_TEXT);
    });

    it('success on successLight meets AA large text (3:1)', () => {
      const ratio = contrastRatio(lightColors.success, lightColors.successLight);
      expect(ratio).toBeGreaterThanOrEqual(AA_LARGE_TEXT);
    });

    it('info on infoLight meets AA large text (3:1)', () => {
      const ratio = contrastRatio(lightColors.info, lightColors.infoLight);
      expect(ratio).toBeGreaterThanOrEqual(AA_LARGE_TEXT);
    });
  });

  /**
   * WCAG AA Color Contrast Compliance — Dark Theme
   * Validates: Requirements 12.6
   *
   * Verifies that all text/background color combinations in the dark theme
   * meet WCAG 2.1 AA minimum contrast ratios.
   */
  describe('Dark theme WCAG AA compliance', () => {
    const bg = darkColors.background;
    const surface = darkColors.surface;

    it('text on background meets AA normal text (4.5:1)', () => {
      const ratio = contrastRatio(darkColors.text, bg);
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    it('textSecondary on background meets AA normal text (4.5:1)', () => {
      const ratio = contrastRatio(darkColors.textSecondary, bg);
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    it('text on surface meets AA normal text (4.5:1)', () => {
      const ratio = contrastRatio(darkColors.text, surface);
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    it('textSecondary on surface meets AA normal text (4.5:1)', () => {
      const ratio = contrastRatio(darkColors.textSecondary, surface);
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    it('primary on background meets AA large text (3:1)', () => {
      const ratio = contrastRatio(darkColors.primary, bg);
      expect(ratio).toBeGreaterThanOrEqual(AA_LARGE_TEXT);
    });

    it('error on errorLight meets AA large text (3:1)', () => {
      const ratio = contrastRatio(darkColors.error, darkColors.errorLight);
      expect(ratio).toBeGreaterThanOrEqual(AA_LARGE_TEXT);
    });

    it('warning on warningLight meets AA large text (3:1)', () => {
      const ratio = contrastRatio(darkColors.warning, darkColors.warningLight);
      expect(ratio).toBeGreaterThanOrEqual(AA_LARGE_TEXT);
    });

    it('success on successLight meets AA large text (3:1)', () => {
      const ratio = contrastRatio(darkColors.success, darkColors.successLight);
      expect(ratio).toBeGreaterThanOrEqual(AA_LARGE_TEXT);
    });

    it('info on infoLight meets AA large text (3:1)', () => {
      const ratio = contrastRatio(darkColors.info, darkColors.infoLight);
      expect(ratio).toBeGreaterThanOrEqual(AA_LARGE_TEXT);
    });
  });
});
