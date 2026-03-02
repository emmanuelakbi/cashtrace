/**
 * CashTrace Design Tokens
 *
 * Single source of truth for the design system. These tokens map to the CSS
 * custom properties defined in globals.css and the Tailwind config.
 *
 * @see globals.css for CSS variable definitions (light/dark values)
 * @see tailwind.config.ts for Tailwind integration
 */

/** Color tokens referencing CSS custom properties for light/dark mode support. */
export const colors = {
  primary: 'var(--color-primary)',
  primaryLight: 'var(--color-primary-light)',
  primaryDark: 'var(--color-primary-dark)',
  secondary: 'var(--color-secondary)',
  secondaryLight: 'var(--color-secondary-light)',
  secondaryDark: 'var(--color-secondary-dark)',
  accent: 'var(--color-accent)',
  accentLight: 'var(--color-accent-light)',
  accentDark: 'var(--color-accent-dark)',
  background: 'var(--color-background)',
  surface: 'var(--color-surface)',
  text: 'var(--color-text)',
  textSecondary: 'var(--color-text-secondary)',
  error: 'var(--color-error)',
  errorLight: 'var(--color-error-light)',
  warning: 'var(--color-warning)',
  warningLight: 'var(--color-warning-light)',
  success: 'var(--color-success)',
  successLight: 'var(--color-success-light)',
  info: 'var(--color-info)',
  infoLight: 'var(--color-info-light)',
} as const;

/** Raw color values for light mode (used when CSS variables aren't available). */
export const lightColors = {
  primary: '#0d9488',
  primaryLight: '#5eead4',
  primaryDark: '#0f766e',
  secondary: '#1e40af',
  secondaryLight: '#60a5fa',
  secondaryDark: '#1e3a8a',
  accent: '#d97706',
  accentLight: '#fbbf24',
  accentDark: '#b45309',
  background: '#f8fafc',
  surface: '#ffffff',
  text: '#0f172a',
  textSecondary: '#64748b',
  error: '#dc2626',
  errorLight: '#fecaca',
  warning: '#b86e05',
  warningLight: '#fef3c7',
  success: '#15803d',
  successLight: '#bbf7d0',
  info: '#2563eb',
  infoLight: '#bfdbfe',
} as const;

/** Raw color values for dark mode. */
export const darkColors = {
  primary: '#2dd4bf',
  primaryLight: '#5eead4',
  primaryDark: '#0d9488',
  secondary: '#60a5fa',
  secondaryLight: '#93c5fd',
  secondaryDark: '#1e40af',
  accent: '#fbbf24',
  accentLight: '#fde68a',
  accentDark: '#d97706',
  background: '#0f172a',
  surface: '#1e293b',
  text: '#f1f5f9',
  textSecondary: '#94a3b8',
  error: '#f87171',
  errorLight: '#450a0a',
  warning: '#fbbf24',
  warningLight: '#451a03',
  success: '#4ade80',
  successLight: '#052e16',
  info: '#60a5fa',
  infoLight: '#172554',
} as const;

/** Typography tokens matching the Tailwind config and design doc. */
export const typography = {
  fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
  fontSize: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem',
    '4xl': '2.25rem',
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
  },
} as const;

/** Spacing scale in rem units. */
export const spacing = {
  '0': '0',
  '0.5': '0.125rem',
  '1': '0.25rem',
  '1.5': '0.375rem',
  '2': '0.5rem',
  '2.5': '0.625rem',
  '3': '0.75rem',
  '4': '1rem',
  '5': '1.25rem',
  '6': '1.5rem',
  '8': '2rem',
  '10': '2.5rem',
  '12': '3rem',
  '16': '4rem',
  '20': '5rem',
  '24': '6rem',
} as const;

/** Border radius tokens. */
export const borderRadius = {
  sm: '0.25rem',
  DEFAULT: '0.5rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
} as const;

/** Responsive breakpoints in pixels. */
export const breakpoints = {
  mobile: '640px',
  tablet: '1024px',
  desktop: '1280px',
} as const;

/** Numeric breakpoint values for programmatic comparisons. */
export const breakpointValues = {
  mobile: 640,
  tablet: 1024,
  desktop: 1280,
} as const;

/** Safe area inset CSS environment variables for notched devices (Req 5.5). */
export const safeAreaInsets = {
  top: 'env(safe-area-inset-top)',
  bottom: 'env(safe-area-inset-bottom)',
  left: 'env(safe-area-inset-left)',
  right: 'env(safe-area-inset-right)',
} as const;

/** Minimum touch target size in pixels per WCAG / Apple HIG guidelines (Req 5.4). */
export const touchTarget = {
  min: 44,
  minPx: '44px',
} as const;

/** Complete theme configuration matching the design doc's ThemeConfig interface. */
export const themeConfig = {
  colors,
  typography,
  spacing,
  borderRadius,
  breakpoints,
} as const;

export type ThemeColors = typeof colors;
export type ThemeTypography = typeof typography;
export type ThemeSpacing = typeof spacing;
export type ThemeBorderRadius = typeof borderRadius;
export type ThemeBreakpoints = typeof breakpoints;
export type ThemeConfig = typeof themeConfig;
