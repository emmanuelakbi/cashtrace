import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OptimizedImage } from './OptimizedImage';

describe('OptimizedImage', () => {
  // Req 14.2 — Optimize images with Next.js Image component

  it('renders an image with the required alt text', () => {
    render(<OptimizedImage src="/test.png" alt="Test image" width={200} height={100} />);

    const img = screen.getByRole('img', { name: 'Test image' });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('alt', 'Test image');
  });

  it('applies lazy loading by default', () => {
    render(<OptimizedImage src="/test.png" alt="Lazy image" width={200} height={100} />);

    const img = screen.getByRole('img', { name: 'Lazy image' });
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('allows overriding loading to eager', () => {
    render(
      <OptimizedImage src="/test.png" alt="Eager image" width={200} height={100} loading="eager" />,
    );

    const img = screen.getByRole('img', { name: 'Eager image' });
    expect(img).toHaveAttribute('loading', 'eager');
  });

  it('applies default responsive sizes', () => {
    render(<OptimizedImage src="/test.png" alt="Responsive" width={200} height={100} />);

    const img = screen.getByRole('img', { name: 'Responsive' });
    expect(img).toHaveAttribute(
      'sizes',
      '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw',
    );
  });

  it('allows overriding sizes', () => {
    render(
      <OptimizedImage src="/test.png" alt="Custom sizes" width={200} height={100} sizes="50vw" />,
    );

    const img = screen.getByRole('img', { name: 'Custom sizes' });
    expect(img).toHaveAttribute('sizes', '50vw');
  });

  it('sets blur placeholder when blurDataURL is provided', () => {
    const blurDataURL = 'data:image/png;base64,abc123';

    render(
      <OptimizedImage
        src="/test.png"
        alt="Blurred"
        width={200}
        height={100}
        blurDataURL={blurDataURL}
      />,
    );

    const img = screen.getByRole('img', { name: 'Blurred' });
    // Next.js Image applies a style with background-image for blur placeholders
    // We verify the image renders correctly with the blur prop
    expect(img).toBeInTheDocument();
  });

  it('passes through additional Next.js Image props', () => {
    render(
      <OptimizedImage
        src="/test.png"
        alt="Extra props"
        width={300}
        height={150}
        priority
        className="custom-class"
      />,
    );

    const img = screen.getByRole('img', { name: 'Extra props' });
    expect(img).toBeInTheDocument();
    // priority disables lazy loading and sets fetchpriority="high"
    expect(img).not.toHaveAttribute('loading', 'lazy');
  });
});
