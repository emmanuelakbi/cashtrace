'use client';

import { motion } from 'framer-motion';
import {
  AlertTriangle,
  TrendingDown,
  Truck,
  ShieldCheck,
  Users,
  Sparkles,
  ArrowRight,
  BarChart3,
  CircleDollarSign,
} from 'lucide-react';

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

interface Insight {
  category: string;
  priority: Severity;
  Icon: typeof AlertTriangle;
  title: string;
  body: string;
  action: string;
  impact: string | null;
}

const INSIGHTS: Insight[] = [
  {
    category: 'Tax',
    priority: 'critical',
    Icon: AlertTriangle,
    title: 'VAT return due in 5 days',
    body: 'Your FIRS VAT return for February 2026 is due on March 7th. Based on your transactions, estimated VAT payable is ₦185,000.',
    action: 'Prepare VAT Return',
    impact: '₦185,000',
  },
  {
    category: 'Cashflow',
    priority: 'high',
    Icon: TrendingDown,
    title: 'Cash reserve dropping below threshold',
    body: 'At current spending rate, your operating cash will drop below ₦500,000 by March 15th. Consider following up on 3 pending invoices totaling ₦1,850,000.',
    action: 'View Pending Invoices',
    impact: '₦1,850,000',
  },
  {
    category: 'Spending',
    priority: 'medium',
    Icon: Truck,
    title: 'Logistics costs up 40%',
    body: 'Transportation & logistics spending increased from ₦320,000 to ₦448,000 compared to last month. GIG Logistics charges account for 65% of the increase.',
    action: 'View Breakdown',
    impact: '₦128,000',
  },
  {
    category: 'Compliance',
    priority: 'low',
    Icon: ShieldCheck,
    title: 'NDPR compliance check passed',
    body: 'All 24 consent records are valid and up to date. No pending DSAR requests. Data retention policies are being enforced correctly.',
    action: 'View Report',
    impact: null,
  },
  {
    category: 'Revenue',
    priority: 'info',
    Icon: Users,
    title: 'Top customer concentration risk',
    body: 'Dangote Cement accounts for 35% of your total revenue. Consider diversifying your customer base to reduce dependency risk.',
    action: 'View Analysis',
    impact: null,
  },
];

const severityConfig: Record<Severity, { color: string; bg: string; label: string }> = {
  critical: { color: 'var(--ct-danger)', bg: 'var(--ct-danger-subtle)', label: 'Critical' },
  high: { color: '#f97316', bg: 'rgba(249,115,22,0.1)', label: 'High' },
  medium: { color: 'var(--ct-warning)', bg: 'var(--ct-warning-subtle)', label: 'Medium' },
  low: { color: 'var(--ct-success)', bg: 'var(--ct-success-subtle)', label: 'Low' },
  info: { color: 'var(--ct-info)', bg: 'var(--ct-info-subtle)', label: 'Info' },
};

const card: React.CSSProperties = {
  background: 'var(--ct-bg-card)',
  borderRadius: 'var(--ct-radius-lg)',
  padding: '1.25rem',
  border: '1px solid var(--ct-border-subtle)',
};

export default function InsightsPage(): React.JSX.Element {
  return (
    <div style={{ maxWidth: '860px' }}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        style={{ marginBottom: '1.5rem' }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}
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
            Insights
          </h2>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              padding: '0.2rem 0.5rem',
              borderRadius: '4px',
              background: 'var(--ct-accent-subtle)',
              fontSize: '0.65rem',
              fontWeight: 600,
              color: 'var(--ct-accent)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            <Sparkles size={10} /> AI-Powered
          </div>
        </div>
        <p
          style={{
            color: 'var(--ct-text-muted)',
            fontSize: '0.85rem',
            marginTop: 0,
            fontWeight: 300,
          }}
        >
          Gemini-powered recommendations for your business
        </p>
      </motion.div>

      {/* Summary strip */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.35 }}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '0.75rem',
          marginBottom: '1.25rem',
        }}
      >
        {[
          { Icon: AlertTriangle, label: 'Action Required', value: '2', color: 'var(--ct-danger)' },
          { Icon: BarChart3, label: 'Opportunities', value: '1', color: 'var(--ct-accent)' },
          {
            Icon: CircleDollarSign,
            label: 'Potential Savings',
            value: '₦313,000',
            color: 'var(--ct-success)',
          },
        ].map((s, i) => (
          <div key={s.label} style={{ ...card, padding: '1rem 1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '7px',
                  background: `${s.color}15`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <s.Icon size={14} color={s.color} />
              </div>
              <span
                style={{
                  fontSize: '0.72rem',
                  color: 'var(--ct-text-muted)',
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {s.label}
              </span>
            </div>
            <div
              style={{
                fontSize: '1.2rem',
                fontWeight: 700,
                color: 'var(--ct-text)',
                marginTop: '0.5rem',
              }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </motion.div>

      {/* Insight cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {INSIGHTS.map((ins, i) => {
          const sc = severityConfig[ins.priority];
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.06, duration: 0.35 }}
              style={{
                ...card,
                borderLeft: `3px solid ${sc.color}`,
                padding: '1.1rem 1.25rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      marginBottom: '0.5rem',
                    }}
                  >
                    <div
                      style={{
                        width: '26px',
                        height: '26px',
                        borderRadius: '6px',
                        background: sc.bg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <ins.Icon size={13} color={sc.color} />
                    </div>
                    <span
                      style={{
                        fontSize: '0.65rem',
                        padding: '0.15rem 0.45rem',
                        borderRadius: '4px',
                        background: sc.bg,
                        color: sc.color,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {ins.category}
                    </span>
                    <span
                      style={{
                        fontSize: '0.6rem',
                        color: sc.color,
                        fontWeight: 500,
                        opacity: 0.7,
                      }}
                    >
                      {sc.label}
                    </span>
                  </div>
                  <h3
                    style={{
                      fontSize: '0.92rem',
                      fontWeight: 600,
                      color: 'var(--ct-text)',
                      margin: '0 0 0.35rem 0',
                    }}
                  >
                    {ins.title}
                  </h3>
                  <p
                    style={{
                      fontSize: '0.82rem',
                      color: 'var(--ct-text-secondary)',
                      margin: 0,
                      lineHeight: 1.55,
                    }}
                  >
                    {ins.body}
                  </p>
                </div>
                {ins.impact && (
                  <div style={{ textAlign: 'right', marginLeft: '1.5rem', flexShrink: 0 }}>
                    <div
                      style={{
                        fontSize: '0.6rem',
                        color: 'var(--ct-text-muted)',
                        fontWeight: 500,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      Impact
                    </div>
                    <div
                      style={{
                        fontSize: '1.1rem',
                        fontWeight: 700,
                        color: 'var(--ct-text)',
                        marginTop: '0.15rem',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {ins.impact}
                    </div>
                  </div>
                )}
              </div>
              <div style={{ marginTop: '0.75rem' }}>
                <button
                  style={{
                    padding: '0.4rem 0.8rem',
                    fontSize: '0.78rem',
                    fontFamily: 'inherit',
                    background: sc.bg,
                    color: sc.color,
                    border: `1px solid ${sc.color}30`,
                    borderRadius: 'var(--ct-radius-sm)',
                    cursor: 'pointer',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    transition: 'opacity var(--ct-transition)',
                  }}
                >
                  {ins.action} <ArrowRight size={12} />
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
