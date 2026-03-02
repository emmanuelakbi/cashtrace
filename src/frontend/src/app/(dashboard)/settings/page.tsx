'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  User,
  Mail,
  Bell,
  BellOff,
  Shield,
  Download,
  FileCheck,
  Trash2,
  Sun,
  Moon,
  Monitor,
  ChevronRight,
} from 'lucide-react';

const card: React.CSSProperties = {
  background: 'var(--ct-bg-card)',
  borderRadius: 'var(--ct-radius-lg)',
  padding: '1.25rem',
  border: '1px solid var(--ct-border-subtle)',
  marginBottom: '0.75rem',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.6rem 0.8rem',
  fontSize: '0.85rem',
  fontFamily: 'inherit',
  background: 'var(--ct-bg-elevated)',
  border: '1px solid var(--ct-border)',
  borderRadius: 'var(--ct-radius-sm)',
  color: 'var(--ct-text)',
  outline: 'none',
  boxSizing: 'border-box' as const,
  transition: 'border-color var(--ct-transition)',
};

const sectionTitle: React.CSSProperties = {
  fontSize: '0.9rem',
  fontWeight: 600,
  color: 'var(--ct-text)',
  margin: '0 0 1rem 0',
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
};

export default function SettingsPage(): React.JSX.Element {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('dark');
  const [userEmail, setUserEmail] = useState('');
  const [notifications, setNotifications] = useState({
    transactions: true,
    weekly: true,
    compliance: true,
  });

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

  const themeOptions = [
    { value: 'light' as const, Icon: Sun, label: 'Light' },
    { value: 'dark' as const, Icon: Moon, label: 'Dark' },
    { value: 'system' as const, Icon: Monitor, label: 'System' },
  ];

  const notifOptions = [
    {
      key: 'transactions' as const,
      Icon: Bell,
      label: 'Transaction alerts',
      desc: 'Get notified for each transaction',
    },
    {
      key: 'weekly' as const,
      Icon: Bell,
      label: 'Weekly summary',
      desc: 'Weekly business performance digest',
    },
    {
      key: 'compliance' as const,
      Icon: Shield,
      label: 'Compliance reminders',
      desc: 'NDPR deadlines and updates',
    },
  ];

  const privacyActions = [
    {
      Icon: Download,
      label: 'Export my data',
      desc: 'Download all your data (DSAR)',
      color: 'var(--ct-info)',
    },
    {
      Icon: FileCheck,
      label: 'Manage consent',
      desc: 'Review and update data processing consent',
      color: 'var(--ct-success)',
    },
    {
      Icon: Trash2,
      label: 'Delete account',
      desc: 'Permanently delete your account and data',
      color: 'var(--ct-danger)',
    },
  ];

  const focus = (e: React.FocusEvent<HTMLInputElement>): void => {
    e.currentTarget.style.borderColor = 'var(--ct-accent)';
  };
  const blur = (e: React.FocusEvent<HTMLInputElement>): void => {
    e.currentTarget.style.borderColor = 'var(--ct-border)';
  };

  return (
    <div style={{ maxWidth: '700px' }}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        style={{ marginBottom: '1.5rem' }}
      >
        <h2
          style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontSize: '1.6rem',
            fontWeight: 700,
            color: 'var(--ct-text)',
            margin: 0,
            letterSpacing: '-0.02em',
          }}
        >
          Settings
        </h2>
        <p
          style={{
            color: 'var(--ct-text-muted)',
            fontSize: '0.85rem',
            marginTop: '0.3rem',
            fontWeight: 300,
          }}
        >
          Manage your account and preferences
        </p>
      </motion.div>

      {/* Profile */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.35 }}
        style={card}
      >
        <h3 style={sectionTitle}>
          <User size={16} color="var(--ct-accent)" /> Profile
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '0.78rem',
                color: 'var(--ct-text-secondary)',
                marginBottom: '0.3rem',
                fontWeight: 500,
              }}
            >
              First name
            </label>
            <input defaultValue="Adebayo" style={inputStyle} onFocus={focus} onBlur={blur} />
          </div>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '0.78rem',
                color: 'var(--ct-text-secondary)',
                marginBottom: '0.3rem',
                fontWeight: 500,
              }}
            >
              Last name
            </label>
            <input defaultValue="Ogunlesi" style={inputStyle} onFocus={focus} onBlur={blur} />
          </div>
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <label
            style={{
              display: 'block',
              fontSize: '0.78rem',
              color: 'var(--ct-text-secondary)',
              marginBottom: '0.3rem',
              fontWeight: 500,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Mail size={12} /> Email
            </span>
          </label>
          <input
            value={userEmail || 'adebayo@business.com'}
            readOnly
            style={{ ...inputStyle, opacity: 0.7 }}
          />
        </div>
      </motion.div>

      {/* Appearance */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.35 }}
        style={card}
      >
        <h3 style={sectionTitle}>
          <Moon size={16} color="var(--ct-accent)" /> Appearance
        </h3>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {themeOptions.map((t) => (
            <button
              key={t.value}
              onClick={() => setTheme(t.value)}
              style={{
                flex: 1,
                padding: '0.6rem',
                fontSize: '0.82rem',
                fontWeight: 500,
                fontFamily: 'inherit',
                background: theme === t.value ? 'var(--ct-accent-subtle)' : 'var(--ct-bg-elevated)',
                color: theme === t.value ? 'var(--ct-accent)' : 'var(--ct-text-secondary)',
                border:
                  theme === t.value
                    ? '1px solid rgba(226,168,75,0.3)'
                    : '1px solid var(--ct-border)',
                borderRadius: 'var(--ct-radius-sm)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
                transition: 'all var(--ct-transition)',
              }}
            >
              <t.Icon size={14} /> {t.label}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Notifications */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.22, duration: 0.35 }}
        style={card}
      >
        <h3 style={sectionTitle}>
          <Bell size={16} color="var(--ct-accent)" /> Notifications
        </h3>
        {notifOptions.map((n) => {
          const enabled = notifications[n.key];
          return (
            <div
              key={n.key}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.65rem 0',
                borderBottom: '1px solid var(--ct-border-subtle)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '6px',
                    background: enabled ? 'var(--ct-accent-subtle)' : 'var(--ct-bg-hover)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {enabled ? (
                    <n.Icon size={13} color="var(--ct-accent)" />
                  ) : (
                    <BellOff size={13} color="var(--ct-text-muted)" />
                  )}
                </div>
                <div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--ct-text)', fontWeight: 500 }}>
                    {n.label}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--ct-text-muted)' }}>{n.desc}</div>
                </div>
              </div>
              <button
                onClick={() => setNotifications((prev) => ({ ...prev, [n.key]: !prev[n.key] }))}
                style={{
                  width: '38px',
                  height: '22px',
                  borderRadius: '11px',
                  border: 'none',
                  cursor: 'pointer',
                  position: 'relative',
                  background: enabled ? 'var(--ct-accent)' : 'var(--ct-border)',
                  transition: 'background var(--ct-transition)',
                }}
                aria-label={`Toggle ${n.label}`}
              >
                <div
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    background: '#fff',
                    position: 'absolute',
                    top: '3px',
                    left: enabled ? '19px' : '3px',
                    transition: 'left var(--ct-transition)',
                  }}
                />
              </button>
            </div>
          );
        })}
      </motion.div>

      {/* Data & Privacy */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.35 }}
        style={card}
      >
        <h3 style={sectionTitle}>
          <Shield size={16} color="var(--ct-accent)" /> Data & Privacy (NDPR)
        </h3>
        {privacyActions.map((a) => (
          <button
            key={a.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              width: '100%',
              padding: '0.75rem',
              background: 'var(--ct-bg-elevated)',
              border: '1px solid var(--ct-border)',
              borderRadius: 'var(--ct-radius-sm)',
              cursor: 'pointer',
              textAlign: 'left',
              marginBottom: '0.5rem',
              fontFamily: 'inherit',
              transition: 'border-color var(--ct-transition)',
            }}
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: `${a.color}15`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <a.Icon size={15} color={a.color} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--ct-text)', fontWeight: 500 }}>
                {a.label}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--ct-text-muted)' }}>{a.desc}</div>
            </div>
            <ChevronRight size={14} color="var(--ct-text-muted)" />
          </button>
        ))}
      </motion.div>
    </div>
  );
}
