'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  ArrowLeftRight,
  FileText,
  Lightbulb,
  Settings,
  LogOut,
  Loader2,
} from 'lucide-react';

function getCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match?.[1];
}

const NAV = [
  { href: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/transactions', label: 'Transactions', Icon: ArrowLeftRight },
  { href: '/documents', label: 'Documents', Icon: FileText },
  { href: '/insights', label: 'Insights', Icon: Lightbulb },
  { href: '/settings', label: 'Settings', Icon: Settings },
];

export default function DashboardLayout({
  children,
}: Readonly<{ children: ReactNode }>): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const [userEmail, setUserEmail] = useState('');
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('cashtrace_user');
      if (stored) {
        const u = JSON.parse(stored);
        setUserEmail(u.email ?? '');
      }
    } catch {
      /* ignore */
    }
  }, []);

  const handleSignOut = async (): Promise<void> => {
    setSigningOut(true);
    try {
      const csrfToken = getCookie('csrf-token');
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
      });
    } catch {
      /* still redirect */
    }
    localStorage.removeItem('cashtrace_user');
    router.push('/login');
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--ct-bg)' }}>
      {/* Sidebar */}
      <aside
        style={{
          width: '220px',
          background: 'var(--ct-bg-elevated)',
          borderRight: '1px solid var(--ct-border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          padding: '1.25rem 0',
        }}
      >
        {/* Logo */}
        <div style={{ padding: '0 1.25rem', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '7px',
                background: 'var(--ct-accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.9rem',
                fontWeight: 700,
                color: '#0f172a',
                fontFamily: "'Playfair Display', Georgia, serif",
              }}
            >
              ₦
            </div>
            <span
              style={{
                fontFamily: "'Playfair Display', Georgia, serif",
                fontSize: '1.1rem',
                fontWeight: 600,
                color: 'var(--ct-text)',
                letterSpacing: '-0.02em',
              }}
            >
              CashTrace
            </span>
          </div>
          <p
            style={{
              fontSize: '0.65rem',
              color: 'var(--ct-text-muted)',
              marginTop: '0.2rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              fontWeight: 500,
            }}
          >
            SME Copilot
          </p>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.65rem',
                  padding: '0.6rem 1.25rem',
                  fontSize: '0.85rem',
                  fontWeight: active ? 500 : 400,
                  color: active ? 'var(--ct-accent)' : 'var(--ct-text-secondary)',
                  background: active ? 'var(--ct-accent-subtle)' : 'transparent',
                  borderLeft: active ? '2px solid var(--ct-accent)' : '2px solid transparent',
                  textDecoration: 'none',
                  transition: 'all 150ms ease',
                }}
              >
                <item.Icon size={17} strokeWidth={active ? 2 : 1.5} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div
          style={{
            padding: '0 1.25rem',
            borderTop: '1px solid var(--ct-border-subtle)',
            paddingTop: '1rem',
          }}
        >
          {userEmail && (
            <div
              style={{
                fontSize: '0.72rem',
                color: 'var(--ct-text-muted)',
                marginBottom: '0.6rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {userEmail}
            </div>
          )}
          <button
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.82rem',
              color: 'var(--ct-text-secondary)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              fontFamily: 'inherit',
              opacity: signingOut ? 0.5 : 1,
              transition: 'color var(--ct-transition)',
            }}
          >
            {signingOut ? (
              <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <LogOut size={15} />
            )}
            {signingOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, padding: '1.75rem 2rem', overflow: 'auto' }}>{children}</main>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
