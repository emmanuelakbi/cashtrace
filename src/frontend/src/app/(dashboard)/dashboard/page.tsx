'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Clock,
  AlertTriangle,
  BarChart3,
  ShieldCheck,
  Upload,
  PlusCircle,
  FileBarChart,
} from 'lucide-react';

function formatNaira(kobo: number): string {
  const abs = Math.abs(kobo);
  return (
    (kobo < 0 ? '-' : '') + '₦' + (abs / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })
  );
}

const card: React.CSSProperties = {
  background: 'var(--ct-bg-card)',
  borderRadius: 'var(--ct-radius-lg)',
  padding: '1.25rem',
  border: '1px solid var(--ct-border-subtle)',
};

const SUMMARY = [
  {
    label: 'Revenue',
    amount: 2_450_000_00,
    trend: '+12.5%',
    up: true,
    Icon: TrendingUp,
    color: 'var(--ct-success)',
  },
  {
    label: 'Expenses',
    amount: 1_820_000_00,
    trend: '+5.2%',
    up: false,
    Icon: TrendingDown,
    color: 'var(--ct-danger)',
  },
  {
    label: 'Net Profit',
    amount: 630_000_00,
    trend: '+24.1%',
    up: true,
    Icon: Wallet,
    color: 'var(--ct-accent)',
  },
  {
    label: 'Pending',
    amount: 185_000_00,
    trend: '3 invoices',
    up: true,
    Icon: Clock,
    color: 'var(--ct-info)',
  },
];

const TXS = [
  {
    id: '1',
    desc: 'Payment from Dangote Cement',
    amount: 450_000_00,
    type: 'credit',
    date: 'Today, 2:30 PM',
    cat: 'Product Sales',
  },
  {
    id: '2',
    desc: 'Office rent — Victoria Island',
    amount: -350_000_00,
    type: 'debit',
    date: 'Today, 11:00 AM',
    cat: 'Rent & Utilities',
  },
  {
    id: '3',
    desc: 'Payment from Shoprite Supply',
    amount: 280_000_00,
    type: 'credit',
    date: 'Yesterday',
    cat: 'Product Sales',
  },
  {
    id: '4',
    desc: 'Staff salaries — February',
    amount: -890_000_00,
    type: 'debit',
    date: 'Yesterday',
    cat: 'Salaries & Wages',
  },
  {
    id: '5',
    desc: 'POS sales — Lekki branch',
    amount: 125_000_00,
    type: 'credit',
    date: 'Feb 28',
    cat: 'Service Revenue',
  },
];

const INSIGHTS = [
  {
    Icon: AlertTriangle,
    title: 'Tax filing deadline approaching',
    desc: 'FIRS VAT return due in 5 days',
    severity: 'high' as const,
  },
  {
    Icon: BarChart3,
    title: 'Spending spike detected',
    desc: 'Logistics costs up 40% vs last month',
    severity: 'medium' as const,
  },
  {
    Icon: ShieldCheck,
    title: 'NDPR compliance check passed',
    desc: 'All consent records up to date',
    severity: 'low' as const,
  },
];

const severityColors = {
  high: { bg: 'var(--ct-danger-subtle)', border: 'var(--ct-danger)', icon: 'var(--ct-danger)' },
  medium: {
    bg: 'var(--ct-warning-subtle)',
    border: 'var(--ct-warning)',
    icon: 'var(--ct-warning)',
  },
  low: { bg: 'var(--ct-success-subtle)', border: 'var(--ct-success)', icon: 'var(--ct-success)' },
};

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardPage(): React.JSX.Element {
  const [userName, setUserName] = useState('');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('cashtrace_user');
      if (stored) {
        const u = JSON.parse(stored);
        setUserName((u.email ?? '').split('@')[0] ?? '');
      }
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div style={{ maxWidth: '1100px' }}>
      {/* Header */}
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
          {getGreeting()}
          {userName ? `, ${userName}` : ''}
        </h2>
        <p
          style={{
            color: 'var(--ct-text-muted)',
            fontSize: '0.85rem',
            marginTop: '0.3rem',
            fontWeight: 300,
          }}
        >
          Business overview for March 2026
        </p>
      </motion.div>

      {/* Summary cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '0.75rem',
          marginBottom: '1.25rem',
        }}
      >
        {SUMMARY.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 * i, duration: 0.35 }}
            style={card}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--ct-text-muted)',
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {s.label}
              </span>
              <div
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '8px',
                  background: `${s.color}15`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <s.Icon size={15} color={s.color} />
              </div>
            </div>
            <div
              style={{
                fontSize: '1.35rem',
                fontWeight: 700,
                color: 'var(--ct-text)',
                marginTop: '0.6rem',
                letterSpacing: '-0.02em',
              }}
            >
              {formatNaira(s.amount)}
            </div>
            <div
              style={{
                fontSize: '0.73rem',
                marginTop: '0.3rem',
                fontWeight: 500,
                color: s.up ? 'var(--ct-success)' : 'var(--ct-danger)',
              }}
            >
              {s.trend} {s.label !== 'Pending' ? 'this month' : ''}
            </div>
          </motion.div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr', gap: '0.75rem' }}>
        {/* Transactions */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.35 }}
          style={card}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '1rem',
            }}
          >
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--ct-text)', margin: 0 }}>
              Recent Transactions
            </h3>
            <a
              href="/transactions"
              style={{
                fontSize: '0.75rem',
                color: 'var(--ct-accent)',
                textDecoration: 'none',
                fontWeight: 500,
              }}
            >
              View all
            </a>
          </div>
          {TXS.map((tx) => (
            <div
              key={tx.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.6rem 0',
                borderBottom: '1px solid var(--ct-border-subtle)',
              }}
            >
              <div>
                <div style={{ fontSize: '0.85rem', color: 'var(--ct-text)', fontWeight: 500 }}>
                  {tx.desc}
                </div>
                <div
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--ct-text-muted)',
                    marginTop: '0.15rem',
                  }}
                >
                  {tx.cat} · {tx.date}
                </div>
              </div>
              <div
                style={{
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: tx.type === 'credit' ? 'var(--ct-success)' : 'var(--ct-danger)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {tx.type === 'credit' ? '+' : ''}
                {formatNaira(tx.amount)}
              </div>
            </div>
          ))}
        </motion.div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {/* Insights */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.42, duration: 0.35 }}
            style={card}
          >
            <h3
              style={{
                fontSize: '0.9rem',
                fontWeight: 600,
                color: 'var(--ct-text)',
                margin: '0 0 0.75rem 0',
              }}
            >
              Insights
            </h3>
            {INSIGHTS.map((ins, i) => {
              const c = severityColors[ins.severity];
              return (
                <div
                  key={i}
                  style={{
                    padding: '0.65rem',
                    background: c.bg,
                    borderRadius: 'var(--ct-radius-sm)',
                    marginBottom: '0.5rem',
                    borderLeft: `2px solid ${c.border}`,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: 'var(--ct-text)',
                    }}
                  >
                    <ins.Icon size={14} color={c.icon} />
                    {ins.title}
                  </div>
                  <div
                    style={{
                      fontSize: '0.72rem',
                      color: 'var(--ct-text-secondary)',
                      marginTop: '0.2rem',
                      paddingLeft: '1.15rem',
                    }}
                  >
                    {ins.desc}
                  </div>
                </div>
              );
            })}
          </motion.div>

          {/* Quick actions */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.35 }}
            style={{
              ...card,
              background: 'var(--ct-accent-subtle)',
              border: '1px solid rgba(226,168,75,0.15)',
            }}
          >
            <div
              style={{
                fontSize: '0.75rem',
                color: 'var(--ct-accent)',
                fontWeight: 600,
                marginBottom: '0.6rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Quick Actions
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {[
                { Icon: Upload, label: 'Upload' },
                { Icon: PlusCircle, label: 'Record' },
                { Icon: FileBarChart, label: 'Report' },
              ].map((a) => (
                <button
                  key={a.label}
                  style={{
                    flex: 1,
                    padding: '0.5rem',
                    fontSize: '0.72rem',
                    fontFamily: 'inherit',
                    background: 'var(--ct-bg-card)',
                    border: '1px solid var(--ct-border)',
                    borderRadius: 'var(--ct-radius-sm)',
                    cursor: 'pointer',
                    color: 'var(--ct-text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.35rem',
                    transition: 'border-color var(--ct-transition)',
                  }}
                >
                  <a.Icon size={13} /> {a.label}
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
