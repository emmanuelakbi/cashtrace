'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Mail, Lock, ArrowRight, Loader2, CheckSquare } from 'lucide-react';

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

export default function SignupPage(): React.JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (!consent) {
      setError('You must accept the terms and privacy policy.');
      return;
    }

    setLoading(true);
    try {
      await fetch('/api/auth/csrf-token', { credentials: 'include' });
      const csrfToken = getCookie('csrf-token');
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ email, password, consentToTerms: true, consentToPrivacy: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data?.error?.message ?? 'Signup failed.');
        return;
      }
      if (data.user) localStorage.setItem('cashtrace_user', JSON.stringify(data.user));
      router.push('/dashboard');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  };

  const focus = (e: React.FocusEvent<HTMLInputElement>): void => {
    e.currentTarget.style.borderColor = 'var(--ct-accent)';
  };
  const blur = (e: React.FocusEvent<HTMLInputElement>): void => {
    e.currentTarget.style.borderColor = 'var(--ct-border)';
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
        Create your account
      </h2>
      <p
        style={{
          color: 'var(--ct-text-secondary)',
          fontSize: '0.88rem',
          margin: '0 0 1.75rem 0',
          fontWeight: 300,
        }}
      >
        Start managing your business finances with AI
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

        <div style={{ marginBottom: '0.9rem' }}>
          <label
            htmlFor="signup-email"
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
              id="signup-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@business.com"
              style={inputStyle}
              onFocus={focus}
              onBlur={blur}
            />
          </div>
        </div>

        <div style={{ marginBottom: '0.9rem' }}>
          <label
            htmlFor="signup-password"
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
              id="signup-password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters, 1 number"
              style={inputStyle}
              onFocus={focus}
              onBlur={blur}
            />
          </div>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label
            htmlFor="signup-confirm"
            style={{
              display: 'block',
              fontSize: '0.8rem',
              fontWeight: 500,
              color: 'var(--ct-text-secondary)',
              marginBottom: '0.4rem',
            }}
          >
            Confirm password
          </label>
          <div style={inputWrap}>
            <span style={iconWrap}>
              <Lock size={16} />
            </span>
            <input
              id="signup-confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              style={inputStyle}
              onFocus={focus}
              onBlur={blur}
            />
          </div>
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.5rem',
            cursor: 'pointer',
            marginBottom: '1.25rem',
          }}
        >
          <div
            style={{
              marginTop: '1px',
              color: consent ? 'var(--ct-accent)' : 'var(--ct-text-muted)',
              transition: 'color var(--ct-transition)',
            }}
          >
            <CheckSquare size={18} />
          </div>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            style={{ display: 'none' }}
          />
          <span
            style={{ fontSize: '0.78rem', color: 'var(--ct-text-secondary)', lineHeight: 1.45 }}
          >
            I agree to the Terms of Service and Privacy Policy, and consent to data processing in
            accordance with NDPR
          </span>
        </label>

        <button
          type="submit"
          disabled={loading}
          style={{ ...btnStyle, opacity: loading ? 0.7 : 1 }}
        >
          {loading ? (
            <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <>
              Create account <ArrowRight size={16} />
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
        Already have an account?{' '}
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
