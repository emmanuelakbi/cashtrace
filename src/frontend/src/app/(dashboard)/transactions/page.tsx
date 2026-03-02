'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Filter,
  Search,
  PlusCircle,
  Receipt,
  Building2,
  CreditCard,
  Pencil,
  Loader2,
} from 'lucide-react';

function formatNaira(kobo: number): string {
  const abs = Math.abs(kobo);
  return (
    (kobo < 0 ? '-' : '') + '₦' + (abs / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })
  );
}

interface Transaction {
  id: string;
  description: string;
  amountKobo: number;
  transactionType: 'INFLOW' | 'OUTFLOW';
  transactionDate: string;
  category: string;
  sourceType: string;
}

const categoryLabels: Record<string, string> = {
  PRODUCT_SALES: 'Product Sales',
  SERVICE_REVENUE: 'Service Revenue',
  OTHER_INCOME: 'Other Income',
  RENT_UTILITIES: 'Rent & Utilities',
  SALARIES_WAGES: 'Salaries & Wages',
  TRANSPORTATION_LOGISTICS: 'Transportation',
  EQUIPMENT_MAINTENANCE: 'Equipment',
  BANK_CHARGES_FEES: 'Bank Charges',
  TAXES_LEVIES: 'Taxes & Levies',
  INVENTORY_STOCK: 'Inventory',
  MARKETING_ADVERTISING: 'Marketing',
  PROFESSIONAL_SERVICES: 'Professional Services',
  MISCELLANEOUS_EXPENSES: 'Miscellaneous',
};

const sourceLabels: Record<string, string> = {
  RECEIPT: 'Receipt',
  BANK_STATEMENT: 'Bank Statement',
  POS_EXPORT: 'POS Export',
  MANUAL: 'Manual',
};

const sourceIcons: Record<string, typeof Receipt> = {
  RECEIPT: Receipt,
  BANK_STATEMENT: Building2,
  POS_EXPORT: CreditCard,
  MANUAL: Pencil,
};

const card: React.CSSProperties = {
  background: 'var(--ct-bg-card)',
  borderRadius: 'var(--ct-radius-lg)',
  border: '1px solid var(--ct-border-subtle)',
};

export default function TransactionsPage(): React.JSX.Element {
  const [filter, setFilter] = useState<'all' | 'INFLOW' | 'OUTFLOW'>('all');
  const [search, setSearch] = useState('');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/transactions?limit=100', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setTransactions(data.data.transactions);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = transactions.filter((t) => {
    if (filter !== 'all' && t.transactionType !== filter) return false;
    if (search && !t.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalIn = transactions
    .filter((t) => t.transactionType === 'INFLOW')
    .reduce((s, t) => s + t.amountKobo, 0);
  const totalOut = transactions
    .filter((t) => t.transactionType === 'OUTFLOW')
    .reduce((s, t) => s + t.amountKobo, 0);

  return (
    <div style={{ maxWidth: '960px' }}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '1.5rem',
          }}
        >
          <div>
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
              Transactions
            </h2>
            <p
              style={{
                color: 'var(--ct-text-muted)',
                fontSize: '0.85rem',
                marginTop: '0.3rem',
                fontWeight: 300,
              }}
            >
              {transactions.length} transactions this period
            </p>
          </div>
          <button
            style={{
              padding: '0.6rem 1rem',
              fontSize: '0.82rem',
              fontWeight: 600,
              fontFamily: 'inherit',
              color: '#ffffff',
              background: 'var(--ct-accent)',
              border: 'none',
              borderRadius: 'var(--ct-radius)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            <PlusCircle size={15} /> Record Transaction
          </button>
        </div>
      </motion.div>

      {/* Summary strip */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.35 }}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '0.75rem',
          marginBottom: '1rem',
        }}
      >
        <div style={{ ...card, padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '7px',
                background: 'var(--ct-success-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ArrowDownLeft size={14} color="var(--ct-success)" />
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
              Total Inflows
            </span>
          </div>
          <div
            style={{
              fontSize: '1.2rem',
              fontWeight: 700,
              color: 'var(--ct-success)',
              marginTop: '0.5rem',
              letterSpacing: '-0.01em',
            }}
          >
            +{formatNaira(totalIn)}
          </div>
        </div>
        <div style={{ ...card, padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '7px',
                background: 'var(--ct-danger-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ArrowUpRight size={14} color="var(--ct-danger)" />
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
              Total Outflows
            </span>
          </div>
          <div
            style={{
              fontSize: '1.2rem',
              fontWeight: 700,
              color: 'var(--ct-danger)',
              marginTop: '0.5rem',
              letterSpacing: '-0.01em',
            }}
          >
            -{formatNaira(totalOut)}
          </div>
        </div>
        <div style={{ ...card, padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '7px',
                background: 'var(--ct-accent-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ArrowDownLeft size={14} color="var(--ct-accent)" />
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
              Net Position
            </span>
          </div>
          <div
            style={{
              fontSize: '1.2rem',
              fontWeight: 700,
              color: 'var(--ct-accent)',
              marginTop: '0.5rem',
              letterSpacing: '-0.01em',
            }}
          >
            {formatNaira(totalIn - totalOut)}
          </div>
        </div>
      </motion.div>

      {/* Filters + Search */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.35 }}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.75rem',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          <Filter size={14} color="var(--ct-text-muted)" />
          {(['all', 'INFLOW', 'OUTFLOW'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '0.4rem 0.8rem',
                fontSize: '0.78rem',
                fontWeight: 500,
                fontFamily: 'inherit',
                background: filter === f ? 'var(--ct-accent-subtle)' : 'transparent',
                color: filter === f ? 'var(--ct-accent)' : 'var(--ct-text-muted)',
                border: filter === f ? '1px solid var(--ct-accent)' : '1px solid var(--ct-border)',
                borderRadius: 'var(--ct-radius-sm)',
                cursor: 'pointer',
                transition: 'all var(--ct-transition)',
              }}
            >
              {f === 'all' ? 'All' : f === 'INFLOW' ? 'Inflows' : 'Outflows'}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search
            size={14}
            color="var(--ct-text-muted)"
            style={{ position: 'absolute', left: '10px', pointerEvents: 'none' }}
          />
          <input
            type="text"
            placeholder="Search transactions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: '0.45rem 0.75rem 0.45rem 2rem',
              fontSize: '0.8rem',
              fontFamily: 'inherit',
              background: 'var(--ct-bg-card)',
              border: '1px solid var(--ct-border)',
              borderRadius: 'var(--ct-radius-sm)',
              color: 'var(--ct-text)',
              outline: 'none',
              width: '220px',
              transition: 'border-color var(--ct-transition)',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--ct-accent)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--ct-border)';
            }}
          />
        </div>
      </motion.div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.22, duration: 0.35 }}
        style={{ ...card, padding: 0, overflow: 'hidden' }}
      >
        {loading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              padding: '3rem',
              color: 'var(--ct-text-muted)',
              fontSize: '0.85rem',
            }}
          >
            <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
            Loading transactions...
          </div>
        ) : transactions.length === 0 ? (
          <div
            style={{
              padding: '3rem',
              textAlign: 'center',
              color: 'var(--ct-text-muted)',
              fontSize: '0.85rem',
            }}
          >
            <Receipt size={32} style={{ marginBottom: '0.75rem', opacity: 0.4 }} />
            <div style={{ fontWeight: 500 }}>No transactions yet</div>
            <div style={{ fontSize: '0.78rem', marginTop: '0.3rem' }}>
              Upload a document to extract transactions automatically
            </div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--ct-border)' }}>
                {['Description', 'Category', 'Source', 'Date', 'Amount'].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: '0.7rem 1rem',
                      textAlign: h === 'Amount' ? 'right' : 'left',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      color: 'var(--ct-text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((tx) => {
                const SourceIcon = sourceIcons[tx.sourceType] ?? Receipt;
                return (
                  <tr
                    key={tx.id}
                    style={{
                      borderBottom: '1px solid var(--ct-border-subtle)',
                      transition: 'background var(--ct-transition)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--ct-bg-hover)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <td
                      style={{ padding: '0.7rem 1rem', color: 'var(--ct-text)', fontWeight: 500 }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div
                          style={{
                            width: '26px',
                            height: '26px',
                            borderRadius: '6px',
                            background:
                              tx.transactionType === 'INFLOW'
                                ? 'var(--ct-success-subtle)'
                                : 'var(--ct-danger-subtle)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {tx.transactionType === 'INFLOW' ? (
                            <ArrowDownLeft size={12} color="var(--ct-success)" />
                          ) : (
                            <ArrowUpRight size={12} color="var(--ct-danger)" />
                          )}
                        </div>
                        {tx.description}
                      </div>
                    </td>
                    <td style={{ padding: '0.7rem 1rem' }}>
                      <span
                        style={{
                          fontSize: '0.7rem',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          background: 'var(--ct-bg-hover)',
                          color: 'var(--ct-text-secondary)',
                          fontWeight: 500,
                        }}
                      >
                        {categoryLabels[tx.category] ?? tx.category}
                      </span>
                    </td>
                    <td style={{ padding: '0.7rem 1rem' }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          color: 'var(--ct-text-muted)',
                          fontSize: '0.78rem',
                        }}
                      >
                        <SourceIcon size={12} />
                        {sourceLabels[tx.sourceType] ?? tx.sourceType}
                      </div>
                    </td>
                    <td
                      style={{
                        padding: '0.7rem 1rem',
                        color: 'var(--ct-text-secondary)',
                        fontSize: '0.8rem',
                      }}
                    >
                      {new Date(tx.transactionDate).toLocaleDateString('en-NG', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td
                      style={{
                        padding: '0.7rem 1rem',
                        textAlign: 'right',
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                        color:
                          tx.transactionType === 'INFLOW'
                            ? 'var(--ct-success)'
                            : 'var(--ct-danger)',
                      }}
                    >
                      {tx.transactionType === 'INFLOW' ? '+' : '-'}
                      {formatNaira(tx.amountKobo)}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && transactions.length > 0 && (
                <tr>
                  <td
                    colSpan={5}
                    style={{
                      padding: '2rem',
                      textAlign: 'center',
                      color: 'var(--ct-text-muted)',
                      fontSize: '0.85rem',
                    }}
                  >
                    No transactions match your filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </motion.div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
