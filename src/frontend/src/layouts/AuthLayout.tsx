'use client';

import { type ReactNode } from 'react';

export interface AuthLayoutProps {
  children: ReactNode;
}

/**
 * Centered card layout for authentication pages (login, signup, password reset).
 *
 * Renders a vertically and horizontally centered card on a subtle background.
 * Mobile-first: full-width on small screens, constrained card on larger screens.
 *
 * @see Requirements 5.1, 5.2
 */
export function AuthLayout({ children }: AuthLayoutProps): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8 pt-safe-top pb-safe-bottom pl-safe-left pr-safe-right">
      {/* Logo / branding */}
      <header role="banner" className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-primary tablet:text-3xl">CashTrace</h1>
        <p className="mt-1 text-sm text-text-secondary">
          SME Cashflow &amp; Compliance Copilot
        </p>
      </header>

      {/* Auth card */}
      <main
        id="main-content"
        className="w-full max-w-md rounded-xl bg-surface p-6 shadow-lg tablet:p-8"
      >
        {children}
      </main>

      {/* Footer */}
      <footer role="contentinfo" className="mt-8 text-center text-xs text-text-secondary">
        <p>&copy; {new Date().getFullYear()} CashTrace. All rights reserved.</p>
      </footer>
    </div>
  );
}
