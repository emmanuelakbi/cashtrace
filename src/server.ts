/**
 * CashTrace Server Bootstrap
 *
 * Wires up all dependencies and starts the Express server.
 * This is the actual entry point for running the application.
 *
 * @module server
 */

import { createApp } from './app.js';
import type { AppDependencies } from './app.js';
import { Redis } from 'ioredis';
import { closePool, query } from './utils/db.js';
import multer from 'multer';
import { GeminiService } from './gemini-integration/index.js';
import { loadConfig } from './gemini-integration/config/index.js';
import type { ExtractionResult } from './gemini-integration/index.js';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';

// ─── Repositories ───
import * as userRepository from './repositories/userRepository.js';
import * as consentRepository from './repositories/consentRepository.js';
import * as auditRepository from './repositories/auditRepository.js';
import * as sessionRepository from './repositories/sessionRepository.js';

// ─── Services ───
import * as passwordService from './services/passwordService.js';
import * as tokenService from './services/tokenService.js';
import { EmailServiceAdapter } from './services/emailService.js';
import type { EmailTransport } from './services/emailService.js';

// ─── Validators ───
import { validateEmail } from './utils/validators/emailValidator.js';
import { validatePassword } from './utils/validators/passwordValidator.js';

// ─── Constants ───
const PORT = parseInt(process.env['PORT'] ?? '4000', 10);
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const APP_BASE_URL = process.env['APP_BASE_URL'] ?? 'http://localhost:3000';

// ─── Dev Email Transport (logs to console) ───
const consoleEmailTransport: EmailTransport = {
  async sendMail(options): Promise<void> {
    console.log('──────────────────────────────────────────');
    console.log(`📧 Email to: ${options.to}`);
    console.log(`   Subject:  ${options.subject}`);
    console.log(
      `   Body:     ${options.html
        .replace(/<[^>]*>/g, '')
        .trim()
        .slice(0, 200)}...`,
    );
    console.log('──────────────────────────────────────────');
  },
};

// ─── Bootstrap ───

async function bootstrap(): Promise<void> {
  // Validate required env vars
  if (!process.env['JWT_SECRET']) {
    console.error('❌ JWT_SECRET environment variable is required');
    process.exit(1);
  }

  // Connect to Redis
  const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    console.log('✅ Redis connected');
  } catch (err) {
    console.error('❌ Redis connection failed:', err);
    process.exit(1);
  }

  // Email service (console transport for dev)
  const emailService = new EmailServiceAdapter(consoleEmailTransport, {
    baseUrl: APP_BASE_URL,
  });

  // Wrap validators to match the interface { validateEmail(email): ValidationResult }
  const emailValidator = { validateEmail };
  const passwordValidator = { validatePassword };

  // Wire up all dependencies for createApp
  const deps: AppDependencies = {
    redis,

    signup: {
      emailValidator,
      passwordValidator,
      userRepository: {
        findByEmail: userRepository.findByEmail,
        createUser: userRepository.createUser,
      },
      passwordService: {
        hashPassword: passwordService.hashPassword,
      },
      tokenService: {
        generateTokenPair: tokenService.generateTokenPair,
      },
      consentRepository: {
        createConsent: consentRepository.createConsent,
      },
      auditRepository: {
        createAuditLog: auditRepository.createAuditLog,
      },
    },

    login: {
      emailValidator,
      userRepository: {
        findByEmail: userRepository.findByEmail,
      },
      passwordService: {
        verifyPassword: passwordService.verifyPassword,
      },
      tokenService: {
        generateTokenPair: tokenService.generateTokenPair,
      },
      auditRepository: {
        createAuditLog: auditRepository.createAuditLog,
      },
    },

    magicLink: {
      emailValidator,
      userRepository: {
        findByEmail: userRepository.findByEmail,
        findById: userRepository.findById,
      },
      tokenService: {
        generateMagicToken: tokenService.generateMagicToken,
        validateMagicToken: tokenService.validateMagicToken,
        invalidateMagicToken: tokenService.invalidateMagicToken,
        generateTokenPair: tokenService.generateTokenPair,
      },
      emailService: {
        sendMagicLink: emailService.sendMagicLink.bind(emailService),
      },
      auditRepository: {
        createAuditLog: auditRepository.createAuditLog,
      },
    },

    passwordResetRequest: {
      emailValidator,
      userRepository: {
        findByEmail: userRepository.findByEmail,
      },
      passwordService: {
        generateResetToken: passwordService.generateResetToken,
      },
      emailService: {
        sendPasswordReset: emailService.sendPasswordReset.bind(emailService),
      },
      auditRepository: {
        createAuditLog: auditRepository.createAuditLog,
      },
    },

    resetPassword: {
      passwordValidator,
      userRepository: {
        findByEmail: userRepository.findByEmail,
        updatePassword: userRepository.updatePassword,
      },
      passwordService: {
        hashPassword: passwordService.hashPassword,
        validateResetToken: passwordService.validateResetToken,
      },
      sessionService: {
        invalidateAllUserSessions: async (userId: string): Promise<void> => {
          await sessionRepository.revokeAllForUser(userId, 'password_reset');
        },
      },
      auditRepository: {
        createAuditLog: auditRepository.createAuditLog,
      },
    },

    refresh: {
      tokenService: {
        refreshTokens: tokenService.refreshTokens,
        revokeRefreshToken: tokenService.revokeRefreshToken,
        revokeAllUserTokens: tokenService.revokeAllUserTokens,
      },
      userRepository: {
        findById: userRepository.findById,
      },
      auditRepository: {
        createAuditLog: auditRepository.createAuditLog,
      },
    },

    logout: {
      tokenService: {
        revokeRefreshToken: tokenService.revokeRefreshToken,
        revokeAllUserTokens: tokenService.revokeAllUserTokens,
        refreshTokens: tokenService.refreshTokens,
      },
      auditRepository: {
        createAuditLog: auditRepository.createAuditLog,
      },
    },

    logoutAll: {
      tokenService: {
        revokeRefreshToken: tokenService.revokeRefreshToken,
        revokeAllUserTokens: tokenService.revokeAllUserTokens,
        refreshTokens: tokenService.refreshTokens,
      },
      auditRepository: {
        createAuditLog: auditRepository.createAuditLog,
      },
    },
  };

  const app = createApp(deps);

  // CSRF token endpoint — GET request sets the csrf-token cookie
  app.get('/api/auth/csrf-token', (_req, res) => {
    res.json({ success: true });
  });

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ─── Gemini AI Document Extraction ───
  let geminiService: GeminiService | null = null;
  const geminiApiKey = process.env['GEMINI_API_KEY'];
  if (geminiApiKey) {
    try {
      const geminiConfig = loadConfig({ apiKey: geminiApiKey });
      geminiService = new GeminiService(geminiConfig);
      console.log('✅ Gemini AI service initialized');
    } catch (err) {
      console.warn('⚠️  Gemini AI service failed to initialize:', err);
    }
  } else {
    console.warn('⚠️  GEMINI_API_KEY not set — document extraction disabled');
  }

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  // POST /api/documents/extract — upload a file and extract transactions via Gemini
  app.post(
    '/api/documents/extract',
    upload.single('file'),
    async (req: Request, res: Response): Promise<void> => {
      const startTime = Date.now();
      try {
        if (!geminiService) {
          res.status(503).json({
            success: false,
            error: { message: 'Gemini AI service is not configured. Set GEMINI_API_KEY.' },
          });
          return;
        }

        const file = req.file;
        if (!file) {
          res.status(400).json({
            success: false,
            error: { message: 'No file uploaded. Send a file in the "file" field.' },
          });
          return;
        }

        const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
        const mimeType = file.mimetype;
        let result: ExtractionResult;

        if (['jpg', 'jpeg', 'png', 'webp'].includes(ext) || mimeType.startsWith('image/')) {
          result = await geminiService.parseReceipt(file.buffer);
        } else if (ext === 'pdf' || mimeType === 'application/pdf') {
          result = await geminiService.parseBankStatement(file.buffer);
        } else if (ext === 'csv' || mimeType === 'text/csv') {
          const csvContent = file.buffer.toString('utf-8');
          result = await geminiService.parsePosExport(csvContent);
        } else {
          res.status(400).json({
            success: false,
            error: { message: `Unsupported file type: .${ext}. Use JPG, PNG, PDF, or CSV.` },
          });
          return;
        }

        // Map to frontend-expected format
        const transactions = result.transactions.map((tx) => ({
          description: tx.description,
          amount: tx.amount,
          date: tx.date,
          category: tx.category_hint ?? 'Uncategorized',
          type: tx.type === 'credit' ? 'inflow' : 'outflow',
          counterparty: tx.counterparty,
          reference: tx.reference,
          confidence: tx.confidence,
        }));

        res.json({
          success: true,
          data: {
            transactions,
            documentType: result.document_type,
            warnings: result.warnings,
            metadata: {
              processingTimeMs: Date.now() - startTime,
              model: result.metadata.model,
              confidence: result.extraction_confidence / 100,
            },
          },
        });
      } catch (err) {
        console.error('Document extraction error:', err);
        res.status(500).json({
          success: false,
          error: {
            message: err instanceof Error ? err.message : 'Document extraction failed.',
          },
        });
      }
    },
  );

  // POST /api/insights/generate — generate AI insights from transaction data
  app.post('/api/insights/generate', async (req: Request, res: Response): Promise<void> => {
    try {
      if (!geminiService) {
        res.status(503).json({
          success: false,
          error: { message: 'Gemini AI service is not configured.' },
        });
        return;
      }

      const result = await geminiService.generateInsights(req.body);
      res.json({ success: true, data: result });
    } catch (err) {
      console.error('Insights generation error:', err);
      res.status(500).json({
        success: false,
        error: {
          message: err instanceof Error ? err.message : 'Insights generation failed.',
        },
      });
    }
  });

  // ─── Transaction Endpoints ───

  // POST /api/transactions/bulk — save extracted transactions to DB
  app.post('/api/transactions/bulk', async (req: Request, res: Response): Promise<void> => {
    try {
      const { transactions, source } = req.body as {
        transactions: Array<{
          description: string;
          amount: number;
          date: string;
          category: string;
          type: string;
          counterparty?: string;
          reference?: string;
          confidence?: number;
        }>;
        source: string;
      };

      if (!transactions?.length) {
        res.status(400).json({ success: false, error: { message: 'No transactions provided.' } });
        return;
      }

      // Get user's business from JWT access token
      let businessId: string | null = null;
      const accessToken = req.cookies?.['access-token'] as string | undefined;
      if (accessToken) {
        try {
          const decoded = jwt.verify(accessToken, process.env['JWT_SECRET'] ?? '') as {
            userId?: string;
          };
          if (decoded.userId) {
            const bizResult = await query(
              'SELECT id FROM businesses WHERE user_id = $1 AND deleted_at IS NULL LIMIT 1',
              [decoded.userId],
            );
            if (bizResult.rows.length > 0) {
              businessId = bizResult.rows[0].id;
            }
          }
        } catch {
          /* token invalid — fall through */
        }
      }
      // Fallback: use first business in DB (demo convenience)
      if (!businessId) {
        const fallback = await query(
          'SELECT id FROM businesses WHERE deleted_at IS NULL LIMIT 1',
          [],
        );
        if (fallback.rows.length > 0) {
          businessId = fallback.rows[0].id;
        }
      }
      if (!businessId) {
        res
          .status(400)
          .json({
            success: false,
            error: { message: 'No business found. Create a business first.' },
          });
        return;
      }

      const categoryMap: Record<string, string> = {
        PRODUCT_SALES: 'PRODUCT_SALES',
        SERVICE_REVENUE: 'SERVICE_REVENUE',
        OTHER_INCOME: 'OTHER_INCOME',
        RENT_UTILITIES: 'RENT_UTILITIES',
        SALARIES_WAGES: 'SALARIES_WAGES',
        TRANSPORTATION_LOGISTICS: 'TRANSPORTATION_LOGISTICS',
        EQUIPMENT_MAINTENANCE: 'EQUIPMENT_MAINTENANCE',
        BANK_CHARGES_FEES: 'BANK_CHARGES_FEES',
        TAXES_LEVIES: 'TAXES_LEVIES',
        INVENTORY_STOCK: 'INVENTORY_STOCK',
        MARKETING_ADVERTISING: 'MARKETING_ADVERTISING',
        PROFESSIONAL_SERVICES: 'PROFESSIONAL_SERVICES',
        MISCELLANEOUS_EXPENSES: 'MISCELLANEOUS_EXPENSES',
      };

      const sourceMap: Record<string, string> = {
        receipt: 'RECEIPT',
        bank_statement: 'BANK_STATEMENT',
        pos_export: 'POS_EXPORT',
      };

      const ids: string[] = [];

      for (const tx of transactions) {
        const txType = tx.type === 'inflow' ? 'INFLOW' : 'OUTFLOW';
        const cat = categoryMap[tx.category] ?? 'MISCELLANEOUS_EXPENSES';
        const src = sourceMap[source] ?? 'MANUAL';
        const amountKobo = Math.round(Math.abs(tx.amount) * 100);

        const result = await query(
          `INSERT INTO transactions (id, business_id, source_type, transaction_type, transaction_date, description, amount_kobo, counterparty, reference, category, category_source, category_confidence, raw_metadata, updated_at)
           VALUES (gen_random_uuid(), $1, $2::source_type, $3::transaction_type, $4::date, $5, $6, $7, $8, $9::transaction_category, 'AUTO'::category_source, $10, '{}', now())
           RETURNING id`,
          [
            businessId,
            src,
            txType,
            tx.date,
            tx.description,
            amountKobo,
            tx.counterparty ?? null,
            tx.reference ?? null,
            cat,
            tx.confidence ?? null,
          ],
        );
        ids.push(result.rows[0].id);
      }

      res.json({ success: true, data: { savedCount: ids.length, ids } });
    } catch (err) {
      console.error('Bulk save error:', err);
      res.status(500).json({
        success: false,
        error: { message: err instanceof Error ? err.message : 'Failed to save transactions.' },
      });
    }
  });

  // GET /api/transactions — fetch transactions
  app.get('/api/transactions', async (req: Request, res: Response): Promise<void> => {
    try {
      const limit = parseInt((req.query['limit'] as string) ?? '50', 10);
      const offset = parseInt((req.query['offset'] as string) ?? '0', 10);
      const typeFilter = req.query['type'] as string | undefined;

      let sql = `SELECT id, business_id, source_type, transaction_type, transaction_date, description, amount_kobo, counterparty, reference, category, category_source, category_confidence, created_at
                 FROM transactions WHERE deleted_at IS NULL`;
      const params: unknown[] = [];
      let paramIdx = 1;

      if (typeFilter && (typeFilter === 'INFLOW' || typeFilter === 'OUTFLOW')) {
        sql += ` AND transaction_type = $${paramIdx}::transaction_type`;
        params.push(typeFilter);
        paramIdx++;
      }

      sql += ` ORDER BY transaction_date DESC, created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
      params.push(limit, offset);

      const result = await query(sql, params);

      const transactions = result.rows.map((r) => ({
        id: r.id,
        businessId: r.business_id,
        sourceType: r.source_type,
        transactionType: r.transaction_type,
        transactionDate: r.transaction_date,
        description: r.description,
        amountKobo: Number(r.amount_kobo),
        counterparty: r.counterparty,
        reference: r.reference,
        category: r.category,
        categorySource: r.category_source,
        categoryConfidence: r.category_confidence,
        createdAt: r.created_at,
      }));

      res.json({ success: true, data: { transactions, count: transactions.length } });
    } catch (err) {
      console.error('Fetch transactions error:', err);
      res.status(500).json({
        success: false,
        error: { message: err instanceof Error ? err.message : 'Failed to fetch transactions.' },
      });
    }
  });

  // Start server
  const server = app.listen(PORT, () => {
    console.log(`🚀 CashTrace API running on http://localhost:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/api/health`);
    console.log(`   Environment: ${process.env['NODE_ENV'] ?? 'development'}`);
  });

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log('\n🛑 Shutting down...');
    server.close();
    await redis.quit();
    await closePool();
    console.log('👋 Goodbye');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('💥 Failed to start server:', err);
  process.exit(1);
});
