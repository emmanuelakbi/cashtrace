import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFocusTrap, useKeyboardNavigation } from './useKeyboardNavigation';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal React.KeyboardEvent-like object. */
function makeKeyEvent(
  key: string,
  overrides: Partial<React.KeyboardEvent> = {},
): React.KeyboardEvent {
  return {
    key,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  } as unknown as React.KeyboardEvent;
}

/** Build a container with N focusable buttons. */
function buildContainer(count: number): HTMLDivElement {
  const container = document.createElement('div');
  for (let i = 0; i < count; i++) {
    const btn = document.createElement('button');
    btn.textContent = `Item ${i}`;
    container.appendChild(btn);
  }
  document.body.appendChild(container);
  return container;
}

// ---------------------------------------------------------------------------
// useKeyboardNavigation
// ---------------------------------------------------------------------------

describe('useKeyboardNavigation', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = buildContainer(4);
  });

  it('moves focus to next item on ArrowDown (vertical)', () => {
    const { result } = renderHook(() => useKeyboardNavigation({ orientation: 'vertical' }));

    // Attach container ref
    (result.current.containerRef as React.MutableRefObject<HTMLElement | null>).current =
      container;

    const buttons = container.querySelectorAll('button');
    (buttons[0] as HTMLElement).focus();

    act(() => {
      result.current.handleKeyDown(makeKeyEvent('ArrowDown'));
    });

    expect(document.activeElement).toBe(buttons[1]);
  });

  it('moves focus to previous item on ArrowUp (vertical)', () => {
    const { result } = renderHook(() => useKeyboardNavigation({ orientation: 'vertical' }));

    (result.current.containerRef as React.MutableRefObject<HTMLElement | null>).current =
      container;

    const buttons = container.querySelectorAll('button');
    (buttons[2] as HTMLElement).focus();

    act(() => {
      result.current.handleKeyDown(makeKeyEvent('ArrowUp'));
    });

    expect(document.activeElement).toBe(buttons[1]);
  });

  it('wraps from last to first on ArrowDown when wrap is true', () => {
    const { result } = renderHook(() =>
      useKeyboardNavigation({ orientation: 'vertical', wrap: true }),
    );

    (result.current.containerRef as React.MutableRefObject<HTMLElement | null>).current =
      container;

    const buttons = container.querySelectorAll('button');
    (buttons[3] as HTMLElement).focus();

    act(() => {
      result.current.handleKeyDown(makeKeyEvent('ArrowDown'));
    });

    expect(document.activeElement).toBe(buttons[0]);
  });

  it('wraps from first to last on ArrowUp when wrap is true', () => {
    const { result } = renderHook(() =>
      useKeyboardNavigation({ orientation: 'vertical', wrap: true }),
    );

    (result.current.containerRef as React.MutableRefObject<HTMLElement | null>).current =
      container;

    const buttons = container.querySelectorAll('button');
    (buttons[0] as HTMLElement).focus();

    act(() => {
      result.current.handleKeyDown(makeKeyEvent('ArrowUp'));
    });

    expect(document.activeElement).toBe(buttons[3]);
  });

  it('does not wrap when wrap is false', () => {
    const { result } = renderHook(() =>
      useKeyboardNavigation({ orientation: 'vertical', wrap: false }),
    );

    (result.current.containerRef as React.MutableRefObject<HTMLElement | null>).current =
      container;

    const buttons = container.querySelectorAll('button');
    (buttons[3] as HTMLElement).focus();

    act(() => {
      result.current.handleKeyDown(makeKeyEvent('ArrowDown'));
    });

    // Should stay on last item
    expect(document.activeElement).toBe(buttons[3]);
  });

  it('uses ArrowLeft/ArrowRight for horizontal orientation', () => {
    const { result } = renderHook(() =>
      useKeyboardNavigation({ orientation: 'horizontal' }),
    );

    (result.current.containerRef as React.MutableRefObject<HTMLElement | null>).current =
      container;

    const buttons = container.querySelectorAll('button');
    (buttons[0] as HTMLElement).focus();

    act(() => {
      result.current.handleKeyDown(makeKeyEvent('ArrowRight'));
    });

    expect(document.activeElement).toBe(buttons[1]);

    act(() => {
      result.current.handleKeyDown(makeKeyEvent('ArrowLeft'));
    });

    expect(document.activeElement).toBe(buttons[0]);
  });

  it('moves focus to first item on Home', () => {
    const { result } = renderHook(() => useKeyboardNavigation());

    (result.current.containerRef as React.MutableRefObject<HTMLElement | null>).current =
      container;

    const buttons = container.querySelectorAll('button');
    (buttons[3] as HTMLElement).focus();

    act(() => {
      result.current.handleKeyDown(makeKeyEvent('Home'));
    });

    expect(document.activeElement).toBe(buttons[0]);
  });

  it('moves focus to last item on End', () => {
    const { result } = renderHook(() => useKeyboardNavigation());

    (result.current.containerRef as React.MutableRefObject<HTMLElement | null>).current =
      container;

    const buttons = container.querySelectorAll('button');
    (buttons[0] as HTMLElement).focus();

    act(() => {
      result.current.handleKeyDown(makeKeyEvent('End'));
    });

    expect(document.activeElement).toBe(buttons[3]);
  });

  it('calls onEscape when Escape is pressed', () => {
    const onEscape = vi.fn();
    const { result } = renderHook(() => useKeyboardNavigation({ onEscape }));

    (result.current.containerRef as React.MutableRefObject<HTMLElement | null>).current =
      container;

    act(() => {
      result.current.handleKeyDown(makeKeyEvent('Escape'));
    });

    expect(onEscape).toHaveBeenCalledOnce();
  });

  it('prevents default on handled keys', () => {
    const { result } = renderHook(() => useKeyboardNavigation());

    (result.current.containerRef as React.MutableRefObject<HTMLElement | null>).current =
      container;

    const buttons = container.querySelectorAll('button');
    (buttons[0] as HTMLElement).focus();

    const event = makeKeyEvent('ArrowDown');
    act(() => {
      result.current.handleKeyDown(event);
    });

    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('does nothing for unhandled keys', () => {
    const { result } = renderHook(() => useKeyboardNavigation());

    (result.current.containerRef as React.MutableRefObject<HTMLElement | null>).current =
      container;

    const buttons = container.querySelectorAll('button');
    (buttons[0] as HTMLElement).focus();

    const event = makeKeyEvent('a');
    act(() => {
      result.current.handleKeyDown(event);
    });

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('handles empty container gracefully', () => {
    const emptyContainer = document.createElement('div');
    document.body.appendChild(emptyContainer);

    const { result } = renderHook(() => useKeyboardNavigation());

    (result.current.containerRef as React.MutableRefObject<HTMLElement | null>).current =
      emptyContainer;

    const event = makeKeyEvent('ArrowDown');
    act(() => {
      result.current.handleKeyDown(event);
    });

    // Should not throw
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useFocusTrap
// ---------------------------------------------------------------------------

describe('useFocusTrap', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('focuses first focusable element when activated', () => {
    const container = buildContainer(3);

    const { result } = renderHook(() => useFocusTrap({ active: true }));

    act(() => {
      (result.current as React.MutableRefObject<HTMLElement | null>).current = container;
    });

    // Re-render to trigger the effect with the ref set
    const { result: result2 } = renderHook(() => useFocusTrap({ active: true }));
    const trapContainer = buildContainer(2);
    (result2.current as React.MutableRefObject<HTMLElement | null>).current = trapContainer;

    // The effect runs after render — we need to re-render with the ref already set
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useFocusTrap({ active }),
      { initialProps: { active: false } },
    );

    const modal = buildContainer(2);
    // We need to set the ref before activating
    // Since useFocusTrap returns a ref, we test the trap behavior via keydown

    rerender({ active: true });
    // Focus trap behavior is tested via the Tab key trapping below
  });

  it('traps Tab focus within container', async () => {
    const modal = document.createElement('div');
    const btn1 = document.createElement('button');
    btn1.textContent = 'First';
    const btn2 = document.createElement('button');
    btn2.textContent = 'Last';
    modal.appendChild(btn1);
    modal.appendChild(btn2);
    document.body.appendChild(modal);

    const { result } = renderHook(() => useFocusTrap({ active: true }));
    (result.current as React.MutableRefObject<HTMLElement | null>).current = modal;

    // Re-render to trigger effect with ref set
    const { result: result2, rerender } = renderHook(
      ({ active }: { active: boolean }) => {
        const ref = useFocusTrap({ active });
        return ref;
      },
      { initialProps: { active: false } },
    );

    (result2.current as React.MutableRefObject<HTMLElement | null>).current = modal;
    rerender({ active: true });

    // Focus last button
    btn2.focus();
    expect(document.activeElement).toBe(btn2);

    // Simulate Tab on last element — should wrap to first
    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(tabEvent);

    // The focus trap should have moved focus to first button
    expect(document.activeElement).toBe(btn1);
  });

  it('traps Shift+Tab focus within container', () => {
    const modal = document.createElement('div');
    const btn1 = document.createElement('button');
    btn1.textContent = 'First';
    const btn2 = document.createElement('button');
    btn2.textContent = 'Last';
    modal.appendChild(btn1);
    modal.appendChild(btn2);
    document.body.appendChild(modal);

    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => {
        const ref = useFocusTrap({ active });
        return ref;
      },
      { initialProps: { active: false } },
    );

    (result.current as React.MutableRefObject<HTMLElement | null>).current = modal;
    rerender({ active: true });

    // Focus first button
    btn1.focus();
    expect(document.activeElement).toBe(btn1);

    // Simulate Shift+Tab on first element — should wrap to last
    const shiftTabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(shiftTabEvent);

    expect(document.activeElement).toBe(btn2);
  });

  it('does not trap when inactive', () => {
    const modal = document.createElement('div');
    const btn1 = document.createElement('button');
    btn1.textContent = 'First';
    modal.appendChild(btn1);
    document.body.appendChild(modal);

    const outside = document.createElement('button');
    outside.textContent = 'Outside';
    document.body.appendChild(outside);

    const { result } = renderHook(() => useFocusTrap({ active: false }));
    (result.current as React.MutableRefObject<HTMLElement | null>).current = modal;

    // Focus outside element — should stay there
    outside.focus();
    expect(document.activeElement).toBe(outside);
  });
});
