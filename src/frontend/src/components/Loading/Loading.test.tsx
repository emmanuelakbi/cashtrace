import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { LoadingButton } from './LoadingButton';
import { ProgressBar } from './ProgressBar';
import { Skeleton } from './Skeleton';
import { Spinner } from './Spinner';
import { useLoadingTimeout } from './useLoadingTimeout';

describe('Skeleton', () => {
  it('renders with default rectangular variant', () => {
    render(<Skeleton />);
    const el = screen.getByTestId('skeleton');
    expect(el).toHaveAttribute('role', 'status');
    expect(el).toHaveAttribute('aria-busy', 'true');
    expect(el).toHaveAttribute('aria-label', 'Loading content');
  });

  it('renders circular variant with correct classes', () => {
    render(<Skeleton variant="circular" />);
    const el = screen.getByTestId('skeleton');
    expect(el.className).toContain('rounded-full');
  });

  it('renders text variant', () => {
    render(<Skeleton variant="text" width="60%" />);
    const el = screen.getByTestId('skeleton');
    expect(el.style.width).toBe('60%');
  });

  it('applies custom dimensions', () => {
    render(<Skeleton width="200px" height="50px" />);
    const el = screen.getByTestId('skeleton');
    expect(el.style.width).toBe('200px');
    expect(el.style.height).toBe('50px');
  });

  it('supports custom aria-label', () => {
    render(<Skeleton aria-label="Loading profile" />);
    expect(screen.getByLabelText('Loading profile')).toBeInTheDocument();
  });
});

describe('Spinner', () => {
  it('renders with default medium size', () => {
    render(<Spinner />);
    const el = screen.getByTestId('spinner');
    expect(el).toHaveAttribute('role', 'status');
    expect(el).toHaveAttribute('aria-label', 'Loading');
  });

  it('renders small size', () => {
    render(<Spinner size="sm" />);
    const svg = screen.getByTestId('spinner').querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('h-4 w-4');
  });

  it('renders large size', () => {
    render(<Spinner size="lg" />);
    const svg = screen.getByTestId('spinner').querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('h-10 w-10');
  });

  it('supports custom label', () => {
    render(<Spinner label="Saving" />);
    expect(screen.getByLabelText('Saving')).toBeInTheDocument();
  });
});

describe('ProgressBar', () => {
  it('renders determinate mode with correct ARIA attributes', () => {
    render(<ProgressBar mode="determinate" value={45} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '45');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('clamps value between 0 and 100', () => {
    const { rerender } = render(<ProgressBar value={150} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');

    rerender(<ProgressBar value={-10} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('renders indeterminate mode without aria-valuenow', () => {
    render(<ProgressBar mode="indeterminate" />);
    const bar = screen.getByRole('progressbar');
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).toHaveAttribute('aria-busy', 'true');
  });

  it('sets aria-busy false when determinate and complete', () => {
    render(<ProgressBar mode="determinate" value={100} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-busy', 'false');
  });

  it('supports custom label', () => {
    render(<ProgressBar label="Uploading file" />);
    expect(screen.getByLabelText('Uploading file')).toBeInTheDocument();
  });
});

describe('LoadingButton', () => {
  it('renders children and is clickable when not loading', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<LoadingButton loading={false} onClick={onClick}>Submit</LoadingButton>);

    const btn = screen.getByTestId('loading-button');
    expect(btn).toHaveTextContent('Submit');
    expect(btn).not.toBeDisabled();

    await user.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows spinner and prevents clicks when loading (Req 8.4)', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<LoadingButton loading={true} onClick={onClick}>Submit</LoadingButton>);

    const btn = screen.getByTestId('loading-button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('spinner')).toBeInTheDocument();

    await user.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is disabled when disabled prop is true', () => {
    render(<LoadingButton loading={false} disabled>Submit</LoadingButton>);
    expect(screen.getByTestId('loading-button')).toBeDisabled();
  });
});

describe('useLoadingTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts not timed out', () => {
    const { result } = renderHook(() => useLoadingTimeout());
    expect(result.current.timedOut).toBe(false);
  });

  it('times out after default 30 seconds (Req 8.5)', () => {
    const { result } = renderHook(() => useLoadingTimeout());

    act(() => { result.current.start(); });
    expect(result.current.timedOut).toBe(false);

    act(() => { vi.advanceTimersByTime(30_000); });
    expect(result.current.timedOut).toBe(true);
  });

  it('does not time out before the threshold', () => {
    const { result } = renderHook(() => useLoadingTimeout());

    act(() => { result.current.start(); });
    act(() => { vi.advanceTimersByTime(29_999); });
    expect(result.current.timedOut).toBe(false);
  });

  it('supports custom timeout duration', () => {
    const { result } = renderHook(() => useLoadingTimeout({ timeout: 5000 }));

    act(() => { result.current.start(); });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current.timedOut).toBe(true);
  });

  it('resets the timeout state', () => {
    const { result } = renderHook(() => useLoadingTimeout());

    act(() => { result.current.start(); });
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(result.current.timedOut).toBe(true);

    act(() => { result.current.reset(); });
    expect(result.current.timedOut).toBe(false);
  });

  it('clears previous timer when start is called again', () => {
    const { result } = renderHook(() => useLoadingTimeout());

    act(() => { result.current.start(); });
    act(() => { vi.advanceTimersByTime(20_000); });

    // Restart — should reset the 30s window
    act(() => { result.current.start(); });
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(result.current.timedOut).toBe(false);

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(result.current.timedOut).toBe(true);
  });
});
