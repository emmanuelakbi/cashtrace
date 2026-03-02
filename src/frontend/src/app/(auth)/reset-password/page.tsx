'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { Mail, ArrowRight, Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react';

function getCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match?.[1];
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
  transition: 'opacity var(--ct-transition)',
};

export default function ResetPasswordPage(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await fetch('/api/auth/csrf-token', { credentials: 'include' });
      const csrfToken = getCookie('csrf-token');
      const res = await fetch('/api/auth/password/reset-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });
      await res.json();
      setSubmitted(true);
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'var(--ct-success-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1rem',
          }}
        >
          <CheckCircle2 size={24} color="var(--ct-success)" />
        </div>
        <h2
          style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontSize: '1.4rem',
            fontWeight: 600,
            color: 'var(--ct-text)',
            margin: '0 0 0.5rem 0',
          }}
        >
          Check your email
        </h2>
        <p style={{ color: 'var(--ct-text-secondary)', fontSize: '0.85rem', lineHeight: 1.55 }}>
          If an account exists for{' '}
          <span style={{ color: 'var(--ct-text)', fontWeight: 500 }}>{email}</span>, we&apos;ve sent
          a password reset link.
        </p>
        <Link
          href="/login"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            marginTop: '1.5rem',
            color: 'var(--ct-accent)',
            fontWeight: 500,
            textDecoration: 'none',
            fontSize: '0.85rem',
          }}
        >
          <ArrowLeft size={14} /> Back to sign in
        </Link>
      </div>
    );
  }

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
        Reset your password
      </h2>
      <p
        style={{
          color: 'var(--ct-text-secondary)',
          fontSize: '0.88rem',
          margin: '0 0 1.75rem 0',
          fontWeight: 300,
        }}
      >
        Enter your email and we&apos;ll send you a reset link
      </p>

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

        <div style={{ marginBottom: '1.25rem' }}>
          <label
            htmlFor="reset-email"
            style={{
              display: 'block',
              fontSize: '0.8rem',
              fontWeight: 500,
              color: 'var(--ct-text-secondary)',
              marginBottom: '0.4rem',
            }}
          >
            Email address
          </label>
          <div style={inputWrap}>
            <span style={iconWrap}>
              <Mail size={16} />
            </span>
            <input
              id="reset-email"
              type="email"
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

        <button
          type="submit"
          disabled={loading}
          style={{ ...btnStyle, opacity: loading ? 0.7 : 1 }}
        >
          {loading ? (
            <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <>
              Send reset link <ArrowRight size={16} />
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
        Remember your password?{' '}
        <Link
          href="/login"
          style={{ color: 'var(--ct-accent)', fontWeight: 500, textDecoration: 'none' }}
        >
          Sign in
        </Link>
      </p>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
