import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useInstallPrompt } from './useInstallPrompt';

// Helper: create a fake BeforeInstallPromptEvent
function createBeforeInstallPromptEvent(
  outcome: 'accepted' | 'dismissed' = 'accepted',
): Event & { prompt: ReturnType<typeof vi.fn>; userChoice: Promise<{ outcome: string }> } {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.assign(event, {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome }),
  });
  return event as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: string }>;
  };
}

describe('useInstallPrompt', () => {
  let matchMediaMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    matchMediaMock = vi.fn().mockReturnValue({ matches: false });
    Object.defineProperty(window, 'matchMedia', {
      value: matchMediaMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialise with canInstall false and isInstalled false', () => {
    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.canInstall).toBe(false);
    expect(result.current.isInstalled).toBe(false);
  });

  it('should detect standalone mode as installed', () => {
    matchMediaMock.mockReturnValue({ matches: true });

    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.isInstalled).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });

  it('should set canInstall to true when beforeinstallprompt fires', () => {
    const { result } = renderHook(() => useInstallPrompt());

    act(() => {
      window.dispatchEvent(createBeforeInstallPromptEvent());
    });

    expect(result.current.canInstall).toBe(true);
  });

  it('should call prompt() and clear state when user accepts install', async () => {
    const { result } = renderHook(() => useInstallPrompt());
    const event = createBeforeInstallPromptEvent('accepted');

    act(() => {
      window.dispatchEvent(event);
    });

    expect(result.current.canInstall).toBe(true);

    await act(async () => {
      await result.current.promptInstall();
    });

    expect(event.prompt).toHaveBeenCalledOnce();
    expect(result.current.canInstall).toBe(false);
  });

  it('should keep canInstall true when user dismisses install', async () => {
    const { result } = renderHook(() => useInstallPrompt());
    const event = createBeforeInstallPromptEvent('dismissed');

    act(() => {
      window.dispatchEvent(event);
    });

    await act(async () => {
      await result.current.promptInstall();
    });

    expect(result.current.canInstall).toBe(true);
  });

  it('should set isInstalled when appinstalled event fires', () => {
    const { result } = renderHook(() => useInstallPrompt());

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(result.current.isInstalled).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });

  it('should be a no-op when promptInstall is called without a deferred prompt', async () => {
    const { result } = renderHook(() => useInstallPrompt());

    // No beforeinstallprompt fired, so calling promptInstall should not throw
    await act(async () => {
      await result.current.promptInstall();
    });

    expect(result.current.canInstall).toBe(false);
  });

  it('should clean up event listeners on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useInstallPrompt());

    expect(addSpy).toHaveBeenCalledWith('beforeinstallprompt', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('appinstalled', expect.any(Function));

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('beforeinstallprompt', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('appinstalled', expect.any(Function));
  });
});
