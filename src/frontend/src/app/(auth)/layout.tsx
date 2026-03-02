'use client';

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Shield, Zap } from 'lucide-react';

const features = [
  { icon: TrendingUp, label: 'AI-powered cashflow tracking' },
  { icon: Shield, label: 'NDPR compliance built-in' },
  { icon: Zap, label: 'Gemini document extraction' },
];

export default function AuthLayout({
  children,
}: Readonly<{ children: ReactNode }>): React.JSX.Element {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Left — brand panel */}
      <div
        style={{
          flex: '0 0 44%',
          background: 'linear-gradient(160deg, #0f766e 0%, #0d9488 50%, #14b8a6 100%)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '3rem 3.5rem',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Decorative gradient orb */}
        <div
          style={{
            position: 'absolute',
            top: '-20%',
            right: '-15%',
            width: '500px',
            height: '500px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-10%',
            left: '-10%',
            width: '400px',
            height: '400px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          style={{ position: 'relative', zIndex: 1 }}
        >
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '2.5rem' }}
          >
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: 'rgba(255,255,255,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.1rem',
                fontWeight: 700,
                color: '#ffffff',
                fontFamily: "'Playfair Display', Georgia, serif",
              }}
            >
              ₦
            </div>
            <span
              style={{
                fontFamily: "'Playfair Display', Georgia, serif",
                fontSize: '1.3rem',
                fontWeight: 600,
                color: '#ffffff',
                letterSpacing: '-0.02em',
              }}
            >
              CashTrace
            </span>
          </div>

          <h1
            style={{
              fontFamily: "'Playfair Display', Georgia, serif",
              fontSize: '2.6rem',
              fontWeight: 700,
              lineHeight: 1.15,
              color: '#ffffff',
              letterSpacing: '-0.03em',
              margin: '0 0 1rem 0',
            }}
          >
            Your business
            <br />
            finances, <span style={{ color: 'rgba(255,255,255,0.85)' }}>clarified</span>
          </h1>

          <p
            style={{
              fontSize: '1.05rem',
              color: 'rgba(255,255,255,0.7)',
              lineHeight: 1.6,
              maxWidth: '380px',
              margin: '0 0 2.5rem 0',
              fontWeight: 300,
            }}
          >
            Upload receipts, bank statements, and POS exports. Gemini AI extracts and categorizes
            every transaction instantly.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {features.map((f, i) => (
              <motion.div
                key={f.label}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.12, duration: 0.4 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                }}
              >
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    background: 'rgba(255,255,255,0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <f.icon size={16} color="#ffffff" />
                </div>
                <span
                  style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.8)', fontWeight: 400 }}
                >
                  {f.label}
                </span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Right — form panel */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          background: 'var(--ct-bg-elevated)',
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          style={{ width: '100%', maxWidth: '400px' }}
        >
          {children}
        </motion.div>
      </div>
    </div>
  );
}
