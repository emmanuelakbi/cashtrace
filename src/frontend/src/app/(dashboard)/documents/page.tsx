'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Loader2, CheckCircle2, XCircle, Sparkles, ArrowRight } from 'lucide-react';

function getCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match?.[1];
}

function formatNaira(kobo: number): string {
  const abs = Math.abs(kobo);
  return (
    (kobo < 0 ? '-' : '') + '₦' + (abs / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })
  );
}

type DocStatus = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

interface ExtractedTx {
  description: string;
  amount: number;
  date: string;
  category: string;
  type: 'inflow' | 'outflow';
}

interface ExtractionResult {
  transactions: ExtractedTx[];
  metadata: { processingTimeMs: number; model: string; confidence: number };
}

const card: React.CSSProperties = {
  background: 'var(--ct-bg-card)',
  borderRadius: 'var(--ct-radius-lg)',
  padding: '1.5rem',
  border: '1px solid var(--ct-border-subtle)',
};

export default function DocumentsPage(): React.JSX.Element {
  const router = useRouter();
  const [status, setStatus] = useState<DocStatus>('idle');
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [docType, setDocType] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setStatus('uploading');
    setResult(null);
    setError('');
    setSaved(false);

    try {
      // Get CSRF token
      await fetch('/api/auth/csrf-token', { credentials: 'include' });
      const csrfToken = getCookie('csrf-token');

      const formData = new FormData();
      formData.append('file', file);

      setStatus('processing');

      const res = await fetch('/api/documents/extract', {
        method: 'POST',
        headers: { ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) },
        credentials: 'include',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data?.error?.message ?? 'Extraction failed.');
        setStatus('error');
        return;
      }

      setResult(data.data);
      setDocType(data.data.documentType ?? '');
      setStatus('done');
    } catch {
      setError('Could not reach the server.');
      setStatus('error');
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void processFile(file);
    },
    [processFile],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void processFile(file);
    },
    [processFile],
  );

  return (
    <div style={{ maxWidth: '900px' }}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h2
          style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontSize: '1.6rem',
            fontWeight: 700,
            color: 'var(--ct-text)',
            margin: '0 0 0.3rem 0',
            letterSpacing: '-0.02em',
          }}
        >
          Documents
        </h2>
        <p
          style={{
            color: 'var(--ct-text-muted)',
            fontSize: '0.85rem',
            marginTop: 0,
            marginBottom: '1.5rem',
            fontWeight: 300,
          }}
        >
          Upload receipts, bank statements, or POS exports — Gemini AI extracts transactions
          automatically
        </p>
      </motion.div>

      {/* Upload zone */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.35 }}
      >
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          style={{
            ...card,
            cursor: status === 'processing' ? 'wait' : 'pointer',
            textAlign: 'center',
            padding: '2.5rem 1.5rem',
            borderStyle: 'dashed',
            borderWidth: '2px',
            borderColor: dragOver ? 'var(--ct-accent)' : 'var(--ct-border)',
            background: dragOver ? 'var(--ct-accent-subtle)' : 'var(--ct-bg-card)',
            transition: 'all var(--ct-transition)',
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.pdf,.csv"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />

          {status === 'idle' && (
            <>
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '12px',
                  background: 'var(--ct-accent-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 1rem',
                }}
              >
                <Upload size={22} color="var(--ct-accent)" />
              </div>
              <div
                style={{
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  color: 'var(--ct-text)',
                  marginBottom: '0.4rem',
                }}
              >
                Drop a file here or click to browse
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--ct-text-muted)' }}>
                Supports receipts (JPG, PNG), bank statements (PDF), POS exports (CSV) — up to 10MB
              </div>
            </>
          )}

          {(status === 'uploading' || status === 'processing') && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.75rem',
              }}
            >
              <div style={{ position: 'relative' }}>
                <Loader2
                  size={36}
                  color="var(--ct-accent)"
                  style={{ animation: 'spin 1.2s linear infinite' }}
                />
                <Sparkles
                  size={14}
                  color="var(--ct-accent)"
                  style={{ position: 'absolute', top: -4, right: -4 }}
                />
              </div>
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--ct-text)' }}>
                  {status === 'uploading'
                    ? 'Uploading...'
                    : 'Gemini AI is analyzing your document...'}
                </div>
                <div
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--ct-text-muted)',
                    marginTop: '0.2rem',
                  }}
                >
                  {fileName}
                </div>
              </div>
            </div>
          )}

          {status === 'done' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
              }}
            >
              <CheckCircle2 size={20} color="var(--ct-success)" />
              <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--ct-success)' }}>
                Extraction complete — {result?.transactions.length ?? 0} transactions found
              </span>
            </div>
          )}

          {status === 'error' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <XCircle size={20} color="var(--ct-danger)" />
              <span style={{ fontSize: '0.85rem', color: 'var(--ct-danger)' }}>{error}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setStatus('idle');
                }}
                style={{
                  fontSize: '0.78rem',
                  color: 'var(--ct-accent)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 500,
                  marginTop: '0.25rem',
                }}
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </motion.div>

      {/* Results */}
      <AnimatePresence>
        {result && status === 'done' && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4 }}
            style={{ marginTop: '1rem' }}
          >
            {/* Metadata bar */}
            <div
              style={{
                display: 'flex',
                gap: '1.5rem',
                marginBottom: '0.75rem',
                padding: '0.6rem 0',
              }}
            >
              {[
                { label: 'Processing time', value: `${result.metadata.processingTimeMs}ms` },
                { label: 'Model', value: result.metadata.model },
                { label: 'Confidence', value: `${Math.round(result.metadata.confidence * 100)}%` },
                { label: 'Transactions', value: String(result.transactions.length) },
              ].map((m) => (
                <div key={m.label}>
                  <div
                    style={{
                      fontSize: '0.65rem',
                      color: 'var(--ct-text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      fontWeight: 500,
                    }}
                  >
                    {m.label}
                  </div>
                  <div
                    style={{
                      fontSize: '0.85rem',
                      color: 'var(--ct-text)',
                      fontWeight: 600,
                      marginTop: '0.1rem',
                    }}
                  >
                    {m.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Transaction table */}
            <div style={{ ...card, padding: '0', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--ct-border)' }}>
                    {['Description', 'Category', 'Date', 'Amount'].map((h) => (
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
                  {result.transactions.map((tx, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--ct-border-subtle)' }}>
                      <td
                        style={{
                          padding: '0.65rem 1rem',
                          color: 'var(--ct-text)',
                          fontWeight: 500,
                        }}
                      >
                        {tx.description}
                      </td>
                      <td style={{ padding: '0.65rem 1rem' }}>
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
                          {tx.category}
                        </span>
                      </td>
                      <td style={{ padding: '0.65rem 1rem', color: 'var(--ct-text-secondary)' }}>
                        {tx.date}
                      </td>
                      <td
                        style={{
                          padding: '0.65rem 1rem',
                          textAlign: 'right',
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                          color: tx.type === 'inflow' ? 'var(--ct-success)' : 'var(--ct-danger)',
                        }}
                      >
                        {tx.type === 'inflow' ? '+' : '-'}
                        {formatNaira(tx.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Action bar */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.5rem',
                marginTop: '0.75rem',
              }}
            >
              <button
                onClick={() => {
                  setStatus('idle');
                  setResult(null);
                }}
                style={{
                  padding: '0.55rem 1rem',
                  fontSize: '0.8rem',
                  fontFamily: 'inherit',
                  background: 'var(--ct-bg-card)',
                  border: '1px solid var(--ct-border)',
                  borderRadius: 'var(--ct-radius-sm)',
                  color: 'var(--ct-text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Upload another
              </button>
              <button
                onClick={async () => {
                  if (!result || saving || saved) return;
                  setSaving(true);
                  try {
                    const csrfToken = getCookie('csrf-token');
                    const res = await fetch('/api/transactions/bulk', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
                      },
                      credentials: 'include',
                      body: JSON.stringify({ transactions: result.transactions, source: docType }),
                    });
                    const data = await res.json();
                    if (data.success) {
                      setSaved(true);
                      setTimeout(() => router.push('/transactions'), 1200);
                    }
                  } catch {
                    /* ignore */
                  }
                  setSaving(false);
                }}
                disabled={saving || saved}
                style={{
                  padding: '0.55rem 1rem',
                  fontSize: '0.8rem',
                  fontFamily: 'inherit',
                  background: saved ? 'var(--ct-success)' : 'var(--ct-accent)',
                  border: 'none',
                  borderRadius: 'var(--ct-radius-sm)',
                  color: '#ffffff',
                  cursor: saving || saved ? 'default' : 'pointer',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saved ? (
                  <>
                    <CheckCircle2 size={14} /> Saved — redirecting...
                  </>
                ) : saving ? (
                  <>
                    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving...
                  </>
                ) : (
                  <>
                    Save transactions <ArrowRight size={14} />
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
