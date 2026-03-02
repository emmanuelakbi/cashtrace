import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastContainer } from './ToastContainer';
import { ToastItem } from './ToastItem';
import { toast, useToastStore } from './toastStore';
import type { Toast, ToastType } from './types';
import { DEFAULT_DURATION } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToast(overrides?: Partial<Toast>): Toast {
  return {
    id: 'test-1',
    type: 'success',
    title: 'Test toast',
    createdAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Store tests
// ---------------------------------------------------------------------------

describe('toastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    toast.dismissAll();
    vi.useRealTimers();
  });

  it('show() adds a toast and returns an id', () => {
    const id = toast.show({ type: 'success', title: 'Done' });

    expect(id).toBeTruthy();
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]?.type).toBe('success');
  });

  // Req 7.1 — all four types
  it.each<ToastType>(['success', 'error', 'warning', 'info'])(
    'supports %s toast type (Req 7.1)',
    (type) => {
      toast.show({ type, title: `${type} toast` });
      expect(useToastStore.getState().toasts[0]?.type).toBe(type);
      toast.dismissAll();
    },
  );

  // Req 7.2 — auto-dismiss
  it('auto-dismisses after default duration (Req 7.2)', () => {
    toast.show({ type: 'info', title: 'Auto' });
    expect(useToastStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(DEFAULT_DURATION);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('auto-dismisses after custom duration (Req 7.2)', () => {
    toast.show({ type: 'info', title: 'Custom', duration: 2000 });

    vi.advanceTimersByTime(1999);
    expect(useToastStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('does not auto-dismiss when duration is 0', () => {
    toast.show({ type: 'error', title: 'Sticky', duration: 0 });

    vi.advanceTimersByTime(60000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  // Req 7.3 — manual dismiss
  it('dismiss() removes a specific toast (Req 7.3)', () => {
    const id1 = toast.show({ type: 'success', title: 'First' });
    toast.show({ type: 'error', title: 'Second' });

    toast.dismiss(id1);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]?.title).toBe('Second');
  });

  it('dismissAll() clears all toasts', () => {
    toast.show({ type: 'success', title: 'A' });
    toast.show({ type: 'error', title: 'B' });
    toast.show({ type: 'info', title: 'C' });

    toast.dismissAll();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  // Convenience helpers
  it('provides convenience methods for each type', () => {
    toast.success('OK');
    toast.error('Fail');
    toast.warning('Warn');
    toast.info('Info');

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(4);
    expect(toasts.map((t) => t.type)).toEqual(['success', 'error', 'warning', 'info']);
  });
});


// ---------------------------------------------------------------------------
// ToastItem component tests
// ---------------------------------------------------------------------------

describe('ToastItem', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders title and message', () => {
    const t = makeToast({ title: 'Hello', message: 'World' });
    render(<ToastItem toast={t} onDismiss={vi.fn()} />);

    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('World')).toBeInTheDocument();
  });

  it('renders with role="alert" for accessibility', () => {
    const t = makeToast();
    render(<ToastItem toast={t} onDismiss={vi.fn()} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('uses aria-live="assertive" for error toasts', () => {
    const t = makeToast({ type: 'error' });
    render(<ToastItem toast={t} onDismiss={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
  });

  it('uses aria-live="polite" for non-error toasts', () => {
    const t = makeToast({ type: 'info' });
    render(<ToastItem toast={t} onDismiss={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'polite');
  });

  // Req 7.3 — manual dismiss via button
  it('calls onDismiss when dismiss button is clicked (Req 7.3)', () => {
    const onDismiss = vi.fn();
    const t = makeToast({ id: 'dismiss-test' });
    render(<ToastItem toast={t} onDismiss={onDismiss} />);

    const btn = screen.getByLabelText(/dismiss/i);
    fireEvent.click(btn);

    // Dismiss is delayed by exit animation
    vi.advanceTimersByTime(200);
    expect(onDismiss).toHaveBeenCalledWith('dismiss-test');
  });

  // Req 7.6 — action button
  it('renders action button and calls onClick (Req 7.6)', () => {
    const onClick = vi.fn();
    const t = makeToast({
      action: { label: 'Undo', onClick },
    });
    render(<ToastItem toast={t} onDismiss={vi.fn()} />);

    const actionBtn = screen.getByText('Undo');
    expect(actionBtn).toBeInTheDocument();

    fireEvent.click(actionBtn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not render action button when no action provided', () => {
    const t = makeToast();
    render(<ToastItem toast={t} onDismiss={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument();
  });

  it('sets data-toast-type attribute for styling hooks', () => {
    const t = makeToast({ type: 'warning' });
    render(<ToastItem toast={t} onDismiss={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveAttribute('data-toast-type', 'warning');
  });
});

// ---------------------------------------------------------------------------
// ToastContainer component tests
// ---------------------------------------------------------------------------

describe('ToastContainer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    toast.dismissAll();
    vi.useRealTimers();
  });

  it('renders nothing when there are no toasts', () => {
    render(<ToastContainer />);
    expect(screen.queryByTestId('toast-container')).not.toBeInTheDocument();
  });

  it('renders toasts from the store', () => {
    act(() => {
      toast.show({ type: 'success', title: 'First' });
      toast.show({ type: 'error', title: 'Second' });
    });

    render(<ToastContainer />);

    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('has aria-label for the container region', () => {
    act(() => {
      toast.show({ type: 'info', title: 'Test' });
    });

    render(<ToastContainer />);
    expect(screen.getByLabelText('Notifications')).toBeInTheDocument();
  });

  // Req 7.4 — stacking
  it('stacks multiple toasts in order (Req 7.4)', () => {
    act(() => {
      toast.show({ type: 'success', title: 'A' });
      toast.show({ type: 'error', title: 'B' });
      toast.show({ type: 'warning', title: 'C' });
    });

    render(<ToastContainer />);

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(3);
    expect(alerts[0]).toHaveTextContent('A');
    expect(alerts[1]).toHaveTextContent('B');
    expect(alerts[2]).toHaveTextContent('C');
  });

  it('removes toast from DOM after auto-dismiss', () => {
    act(() => {
      toast.show({ type: 'info', title: 'Vanish', duration: 1000 });
    });

    const { rerender } = render(<ToastContainer />);
    expect(screen.getByText('Vanish')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    rerender(<ToastContainer />);
    expect(screen.queryByText('Vanish')).not.toBeInTheDocument();
  });
});
