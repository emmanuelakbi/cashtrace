'use client';

import Image from 'next/image';
import type { ImageProps } from 'next/image';

/**
 * Default responsive sizes for CashTrace breakpoints:
 * - Mobile: <640px → 100vw
 * - Tablet: 640–1024px → 50vw
 * - Desktop: >1024px → 33vw
 */
const DEFAULT_SIZES = '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw';

/**
 * Props for OptimizedImage. Extends Next.js ImageProps but enforces `alt` as required
 * and provides CashTrace-specific defaults for lazy loading, responsive sizes, and
 * blur placeholders.
 *
 * @see Requirement 14.2
 */
export type OptimizedImageProps = Omit<ImageProps, 'alt'> & {
  /** Required alt text for accessibility. */
  alt: string;
  /** Optional blur data URL for placeholder. When provided, enables blur placeholder. */
  blurDataURL?: string;
};

/**
 * Thin wrapper around Next.js Image with CashTrace defaults:
 * - Lazy loading by default
 * - Responsive sizes for mobile/tablet/desktop breakpoints
 * - Blur placeholder when blurDataURL is provided
 * - WebP format preference (configured in next.config.js)
 *
 * @see Requirement 14.2
 */
export function OptimizedImage({
  alt,
  sizes,
  loading,
  placeholder,
  blurDataURL,
  priority,
  ...rest
}: OptimizedImageProps): React.JSX.Element {
  // Next.js Image throws if both priority and loading="lazy" are set.
  // When priority is true, omit loading entirely (Next.js defaults to eager).
  const resolvedLoading = priority ? undefined : (loading ?? 'lazy');

  return (
    <Image
      alt={alt}
      sizes={sizes ?? DEFAULT_SIZES}
      loading={resolvedLoading}
      placeholder={blurDataURL ? 'blur' : (placeholder ?? 'empty')}
      blurDataURL={blurDataURL}
      priority={priority}
      {...rest}
    />
  );
}
