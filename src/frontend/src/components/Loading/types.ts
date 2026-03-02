/**
 * Loading component types.
 *
 * Satisfies Requirements 8.1 (skeleton loaders), 8.2 (spinners),
 * 8.3 (progress bars), 8.4 (duplicate submission prevention),
 * 8.5 (timeout), 8.6 (accessibility).
 */

export type SkeletonVariant = 'rectangular' | 'circular' | 'text';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export type ProgressBarMode = 'determinate' | 'indeterminate';

export interface SkeletonProps {
  /** Shape variant of the skeleton. */
  variant?: SkeletonVariant;
  /** Width (CSS value). Defaults to '100%'. */
  width?: string;
  /** Height (CSS value). Defaults vary by variant. */
  height?: string;
  /** Additional CSS classes. */
  className?: string;
  /** Accessible label for the loading placeholder. */
  'aria-label'?: string;
}

export interface SpinnerProps {
  /** Size of the spinner. */
  size?: SpinnerSize;
  /** Accessible label. Defaults to 'Loading'. */
  label?: string;
  /** Additional CSS classes. */
  className?: string;
}

export interface ProgressBarProps {
  /** Determinate shows a specific value; indeterminate shows continuous animation. */
  mode?: ProgressBarMode;
  /** Current progress value (0–100). Only used in determinate mode. */
  value?: number;
  /** Accessible label. Defaults to 'Progress'. */
  label?: string;
  /** Additional CSS classes. */
  className?: string;
}

export interface LoadingButtonProps {
  /** Whether the button is in a loading state. */
  loading: boolean;
  /** Button contents. */
  children: React.ReactNode;
  /** Click handler. Blocked while loading (Req 8.4). */
  onClick?: () => void;
  /** HTML button type. */
  type?: 'button' | 'submit' | 'reset';
  /** Disabled state independent of loading. */
  disabled?: boolean;
  /** Additional CSS classes. */
  className?: string;
}

export interface UseLoadingTimeoutOptions {
  /** Timeout duration in milliseconds. Defaults to 30 000 (Req 8.5). */
  timeout?: number;
}

export interface UseLoadingTimeoutResult {
  /** Whether the timeout has been reached. */
  timedOut: boolean;
  /** Start the timeout timer. */
  start: () => void;
  /** Reset the timeout state and clear the timer. */
  reset: () => void;
}

/** Default loading timeout in ms (Req 8.5). */
export const DEFAULT_LOADING_TIMEOUT = 30_000;

/** Spinner size mappings (Tailwind dimension classes). */
export const SPINNER_SIZES: Record<SpinnerSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-10 w-10',
};
