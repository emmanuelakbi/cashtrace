import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SkipLink } from './SkipLink';

describe('SkipLink', () => {
  it('renders a link targeting #main-content', () => {
    render(<SkipLink />);

    const link = screen.getByText('Skip to main content');
    expect(link).toBeDefined();
    expect(link.getAttribute('href')).toBe('#main-content');
  });

  it('has the sr-only class for visual hiding', () => {
    render(<SkipLink />);

    const link = screen.getByText('Skip to main content');
    expect(link.className).toContain('sr-only');
  });

  it('becomes visible on focus via focus:not-sr-only', () => {
    render(<SkipLink />);

    const link = screen.getByText('Skip to main content');
    expect(link.className).toContain('focus:not-sr-only');
  });
});
