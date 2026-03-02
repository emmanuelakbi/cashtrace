'use client';

import { type ReactNode } from 'react';

export interface PublicLayoutProps {
  children: ReactNode;
}

/**
 * Simple layout for public-facing pages (landing, about, terms, etc.).
 *
 * Provides a minimal header with branding and a content area.
 * Mobile-first responsive design with constrained max-width on larger screens.
 *
 * @see Requirements 5.1, 5.2
 */
export function PublicLayout({ children }: PublicLayoutProps): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Public header — safe area insets for notched devices (Req 5.5) */}
      <header role="banner" className="border-b border-gray-200 bg-surface pt-safe-top dark:border-gray-700">
        <div className="mx-auto flex min-h-[44px] max-w-5xl items-center justify-between px-4 pl-safe-left pr-safe-right">
          <a href="/" className="text-lg font-bold text-primary min-h-touch flex items-center">
            CashTrace
          </a>
          <nav aria-label="Public navigation" className="flex items-center gap-4">
            <a
              href="/login"
              className="text-sm font-medium text-text-secondary hover:text-text-primary transition-colors min-h-touch min-w-touch flex items-center justify-center"
            >
              Log in
            </a>
            <a
              href="/signup"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark transition-colors min-h-touch flex items-center justify-center"
            >
              Sign up
            </a>
          </nav>
        </div>
      </header>

      {/* Page content — safe area horizontal insets (Req 5.5) */}
      <main
        id="main-content"
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 pl-safe-left pr-safe-right tablet:py-8"
      >
        {children}
      </main>

      {/* Footer — safe area bottom inset (Req 5.5) */}
      <footer role="contentinfo" className="border-t border-gray-200 bg-surface pb-safe-bottom dark:border-gray-700">
        <div className="mx-auto max-w-5xl px-4 py-6 pl-safe-left pr-safe-right text-center text-xs text-text-secondary">
          <p>&copy; {new Date().getFullYear()} CashTrace. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
