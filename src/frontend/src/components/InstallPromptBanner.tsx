'use client';

import { useCallback, useEffect, useState } from 'react';

import { useInstallPrompt } from '../hooks/useInstallPrompt';

const DISMISSAL_KEY = 'cashtrace-install-banner-dismissed';

/**
 * A dismissible banner that prompts users to install the PWA.
 * Hides when the app is already installed, after dismissal, or after
 * successful installation. Dismissal is persisted to localStorage.
 *
 * Requirements: 11.3, 11.5
 */
export function InstallPromptBanner(): React.JSX.Element | null {
  const { canInstall, isInstalled, promptInstall } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(true); // default hidden to avoid flash

  useEffect(() => {
    const wasDismissed = localStorage.getItem(DISMISSAL_KEY) === 'true';
    setDismissed(wasDismissed);
  }, []);

  const handleDismiss = useCallback((): void => {
    setDismissed(true);
    localStorage.setItem(DISMISSAL_KEY, 'true');
  }, []);

  const handleInstall = useCallback(async (): Promise<void> => {
    await promptInstall();
  }, [promptInstall]);

  if (!canInstall || isInstalled || dismissed) {
    return null;
  }

  return (
    <div
      role="banner"
      aria-label="Install application"
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between
        gap-3 bg-teal-600 px-4 py-3 text-white shadow-lg sm:px-6"
    >
      <p className="text-sm font-medium">
        Install CashTrace for a faster, offline-ready experience.
      </p>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={handleInstall}
          aria-label="Install CashTrace application"
          className="rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-teal-700
            hover:bg-teal-50 focus:outline-none focus:ring-2 focus:ring-white"
        >
          Install
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss install banner"
          className="rounded-md px-2 py-1.5 text-sm text-teal-100
            hover:text-white focus:outline-none focus:ring-2 focus:ring-white"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
