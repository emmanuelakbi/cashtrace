'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Mail, Lock, ArrowRight, Loader2 } from 'lucide-react';

function getCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match?.[1];
}

function getDeviceFingerprint(): string {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  return [nav?.userAgent ?? '', nav?.language ?? '', screen?.width, screen?.height].join('|');
}

const inputWrap: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
};

const iconWrap: React.CSSProperties = {
  position: 'absolute',
  left: '14px',
  pointerEvents: 'none',
  color: 'var(--ct-text-muted)',
  display: 'flex',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.8rem 1rem 0.8rem 2.75rem',
  fontSize: '0.9rem',
  fontFamily: 'inherit',
  fontWeight: 400,
  border: '1.5px solid var(--ct-border)',
  borderRadius: 'var(--ct-radius)',
  outline: 'none',
  background: 'var(--ct-bg-card)',
  color: 'var(--ct-text)',
  transition: 'border-color var(--ct-transition)',
};

const btnStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.8rem',
  fontSize: '0.9rem',
  fontWeight: 600,
  fontFamily: 'inherit',
  color: '#ffffff',
  background: 'var(--ct-accent)',
  border: 'none',
  borderRadius: 'var(--ct-radius)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  transition: 'opacity var(--ct-transition), transform var(--ct-transition)',
};

export default function LoginPage(): React.JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await fetch('/api/auth/csrf-token', { credentials: 'include' });
      const csrfToken = getCookie('csrf-token');
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ email, password, deviceFingerprint: getDeviceFingerprint() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data?.error?.message ?? 'Login failed. Please try again.');
        return;
      }
      if (data.user) localStorage.setItem('cashtrace_user', JSON.stringify(data.user));
      router.push('/dashboard');
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2
        style={{
          fontFamily: "'Playfair Display', Georgia, serif",
          fontSize: '1.6rem',
          fontWeight: 600,
          color: 'var(--ct-text)',
          margin: '0 0 0.25rem 0',
          letterSpacing: '-0.02em',
        }}
      >
        Welcome back
      </h2>
      <p
        style={{
          color: 'var(--ct-text-secondary)',
          fontSize: '0.88rem',
          margin: '0 0 1.75rem 0',
          fontWeight: 300,
        }}
      >
        Sign in to your CashTrace account
      </p>

      {/* Demo credentials */}
      <div
        style={{
          padding: '0.65rem 0.85rem',
          background: 'var(--ct-accent-subtle)',
          borderRadius: 'var(--ct-radius-sm)',
          border: '1px solid var(--ct-accent)',
          marginBottom: '1.25rem',
          fontSize: '0.78rem',
          color: 'var(--ct-text-secondary)',
          lineHeight: 1.6,
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--ct-accent)' }}>Demo account</span>
        <br />
        Email: <code style={{ fontWeight: 500, color: 'var(--ct-text)' }}>test@cashtrace.ng</code>
        <br />
        Password: <code style={{ fontWeight: 500, color: 'var(--ct-text)' }}>Test1234</code>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)}>
        {error && (
          <div
            role="alert"
            style={{
              padding: '0.7rem 0.9rem',
              background: 'var(--ct-danger-subtle)',
              color: 'var(--ct-danger)',
              borderRadius: 'var(--ct-radius-sm)',
              fontSize: '0.82rem',
              marginBottom: '1rem',
              border: '1px solid rgba(248,113,113,0.2)',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ marginBottom: '0.9rem' }}>
          <label
            htmlFor="login-email"
            style={{
              display: 'block',
              fontSize: '0.8rem',
              fontWeight: 500,
              color: 'var(--ct-text-secondary)',
              marginBottom: '0.4rem',
            }}
          >
            Email
          </label>
          <div style={inputWrap}>
            <span style={iconWrap}>
              <Mail size={16} />
            </span>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@business.com"
              style={inputStyle}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'var(--ct-accent)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'var(--ct-border)';
              }}
            />
          </div>
        </div>

        <div style={{ marginBottom: '0.6rem' }}>
          <label
            htmlFor="login-password"
            style={{
              display: 'block',
              fontSize: '0.8rem',
              fontWeight: 500,
              color: 'var(--ct-text-secondary)',
              marginBottom: '0.4rem',
            }}
          >
            Password
          </label>
          <div style={inputWrap}>
            <span style={iconWrap}>
              <Lock size={16} />
            </span>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              style={inputStyle}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'var(--ct-accent)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'var(--ct-border)';
              }}
            />
          </div>
        </div>

        <div style={{ textAlign: 'right', marginBottom: '1.25rem' }}>
          <Link
            href="/reset-password"
            style={{
              fontSize: '0.8rem',
              color: 'var(--ct-accent)',
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            Forgot password?
          </Link>
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{ ...btnStyle, opacity: loading ? 0.7 : 1 }}
        >
          {loading ? (
            <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <>
              Sign in <ArrowRight size={16} />
            </>
          )}
        </button>
      </form>

      <p
        style={{
          textAlign: 'center',
          fontSize: '0.82rem',
          color: 'var(--ct-text-muted)',
          marginTop: '1.5rem',
        }}
      >
        Don&apos;t have an account?{' '}
        <Link
          href="/signup"
          style={{ color: 'var(--ct-accent)', fontWeight: 500, textDecoration: 'none' }}
        >
          Create one
        </Link>
      </p>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
