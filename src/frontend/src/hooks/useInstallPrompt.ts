'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Extends the standard Event with the `prompt()` method and `userChoice`
 * exposed by the `beforeinstallprompt` browser event.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface UseInstallPromptResult {
  /** Whether the native install prompt can be triggered. */
  canInstall: boolean;
  /** Whether the app is already running in standalone (installed) mode. */
  isInstalled: boolean;
  /** Trigger the native "Add to Home Screen" prompt. */
  promptInstall: () => Promise<void>;
}

/**
 * Hook that captures the `beforeinstallprompt` event and exposes helpers for
 * triggering the native "Add to Home Screen" flow.
 *
 * Requirements: 11.3, 11.5
 */
export function useInstallPrompt(): UseInstallPromptResult {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if already running in standalone mode (installed PWA)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator && (navigator as unknown as { standalone: boolean }).standalone);

    if (isStandalone) {
      setIsInstalled(true);
      return;
    }

    const handleBeforeInstall = (e: Event): void => {
      e.preventDefault();
      deferredPrompt.current = e as BeforeInstallPromptEvent;
      setCanInstall(true);
    };

    const handleAppInstalled = (): void => {
      deferredPrompt.current = null;
      setCanInstall(false);
      setIsInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<void> => {
    const prompt = deferredPrompt.current;
    if (!prompt) return;

    await prompt.prompt();
    const { outcome } = await prompt.userChoice;

    if (outcome === 'accepted') {
      deferredPrompt.current = null;
      setCanInstall(false);
    }
  }, []);

  return { canInstall, isInstalled, promptInstall };
}
