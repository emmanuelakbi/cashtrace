import { describe, expect, it } from 'vitest';

import {
  borderRadius,
  breakpoints,
  breakpointValues,
  colors,
  darkColors,
  lightColors,
  spacing,
  themeConfig,
  typography,
} from './tokens';

describe('Theme Tokens', () => {
  describe('colors', () => {
    it('should reference CSS custom properties', () => {
      expect(colors.primary).toBe('var(--color-primary)');
      expect(colors.secondary).toBe('var(--color-secondary)');
      expect(colors.accent).toBe('var(--color-accent)');
      expect(colors.background).toBe('var(--color-background)');
      expect(colors.surface).toBe('var(--color-surface)');
      expect(colors.text).toBe('var(--color-text)');
      expect(colors.textSecondary).toBe('var(--color-text-secondary)');
      expect(colors.error).toBe('var(--color-error)');
      expect(colors.warning).toBe('var(--color-warning)');
      expect(colors.success).toBe('var(--color-success)');
      expect(colors.info).toBe('var(--color-info)');
    });

    it('should define all required semantic colors from ThemeConfig', () => {
      const requiredKeys = [
        'primary',
        'secondary',
        'accent',
        'background',
        'surface',
        'text',
        'textSecondary',
        'error',
        'warning',
        'success',
        'info',
      ];
      for (const key of requiredKeys) {
        expect(colors).toHaveProperty(key);
      }
    });
  });

  describe('lightColors', () => {
    it('should provide raw hex values for light mode', () => {
      expect(lightColors.primary).toBe('#0d9488');
      expect(lightColors.background).toBe('#f8fafc');
      expect(lightColors.text).toBe('#0f172a');
    });

    it('should have the same keys as darkColors', () => {
      const lightKeys = Object.keys(lightColors).sort();
      const darkKeys = Object.keys(darkColors).sort();
      expect(lightKeys).toEqual(darkKeys);
    });
  });

  describe('darkColors', () => {
    it('should provide raw hex values for dark mode', () => {
      expect(darkColors.primary).toBe('#2dd4bf');
      expect(darkColors.background).toBe('#0f172a');
      expect(darkColors.text).toBe('#f1f5f9');
    });
  });

  describe('typography', () => {
    it('should define font family with Inter as primary', () => {
      expect(typography.fontFamily).toContain('Inter');
    });

    it('should define a complete font size scale', () => {
      expect(typography.fontSize.xs).toBe('0.75rem');
      expect(typography.fontSize.base).toBe('1rem');
      expect(typography.fontSize['4xl']).toBe('2.25rem');
    });

    it('should define font weights', () => {
      expect(typography.fontWeight.normal).toBe(400);
      expect(typography.fontWeight.medium).toBe(500);
      expect(typography.fontWeight.semibold).toBe(600);
      expect(typography.fontWeight.bold).toBe(700);
    });

    it('should define line heights', () => {
      expect(typography.lineHeight.tight).toBe(1.25);
      expect(typography.lineHeight.normal).toBe(1.5);
      expect(typography.lineHeight.relaxed).toBe(1.75);
    });
  });

  describe('spacing', () => {
    it('should start from zero', () => {
      expect(spacing['0']).toBe('0');
    });

    it('should define standard spacing scale in rem', () => {
      expect(spacing['1']).toBe('0.25rem');
      expect(spacing['4']).toBe('1rem');
      expect(spacing['8']).toBe('2rem');
    });
  });

  describe('borderRadius', () => {
    it('should define all required radius tokens', () => {
      expect(borderRadius.sm).toBe('0.25rem');
      expect(borderRadius.DEFAULT).toBe('0.5rem');
      expect(borderRadius.md).toBe('0.5rem');
      expect(borderRadius.lg).toBe('0.75rem');
      expect(borderRadius.xl).toBe('1rem');
    });
  });

  describe('breakpoints', () => {
    it('should define mobile, tablet, and desktop breakpoints', () => {
      expect(breakpoints.mobile).toBe('640px');
      expect(breakpoints.tablet).toBe('1024px');
      expect(breakpoints.desktop).toBe('1280px');
    });
  });

  describe('breakpointValues', () => {
    it('should provide numeric values for programmatic use', () => {
      expect(breakpointValues.mobile).toBe(640);
      expect(breakpointValues.tablet).toBe(1024);
      expect(breakpointValues.desktop).toBe(1280);
    });

    it('should be ordered mobile < tablet < desktop', () => {
      expect(breakpointValues.mobile).toBeLessThan(breakpointValues.tablet);
      expect(breakpointValues.tablet).toBeLessThan(breakpointValues.desktop);
    });
  });

  describe('themeConfig', () => {
    it('should compose all token groups', () => {
      expect(themeConfig.colors).toBe(colors);
      expect(themeConfig.typography).toBe(typography);
      expect(themeConfig.spacing).toBe(spacing);
      expect(themeConfig.borderRadius).toBe(borderRadius);
      expect(themeConfig.breakpoints).toBe(breakpoints);
    });
  });
});
