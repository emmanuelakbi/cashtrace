# CashTrace

SME cashflow and compliance copilot for Nigerian businesses. Track transactions, process financial documents with AI, and stay NDPR-compliant.

**Live demo:** [cashtrace.vercel.app](https://cashtrace.vercel.app)
Test account: `test@cashtrace.ng` / `Test1234`

## What it does

- Upload receipts (images), bank statements (PDF), or POS exports (CSV) — Google Gemini AI extracts and categorizes transactions automatically
- Track inflows and outflows with full audit trails
- Detect duplicate transactions
- NDPR compliance: consent management, DSAR handling, data retention, breach notification
- Business analytics and insights dashboard
- Multi-channel notifications (email, SMS, in-app, push)

Amounts stored in kobo (smallest Naira unit) as BigInt to avoid floating-point issues. Multi-tenant with strict business-level data isolation.

## Tech Stack

**Backend:** Node.js 20+, TypeScript, Express 4, PostgreSQL (Prisma), Redis (ioredis), BullMQ
**Frontend:** Next.js 14, React 18, Lucide icons
**AI:** Google Gemini (`@google/generative-ai`) for document extraction and insights
**Infrastructure:** Docker, Railway (backend), Vercel (frontend)

## Project Structure

```
src/
├── app.ts                    # Express app factory with DI
├── server.ts                 # Server bootstrap
├── controllers/              # Auth (signup, login, magic-link, password reset)
├── middleware/                # CSRF, rate limiting, validation, compression
├── document-processing/      # Upload, extraction, job processing
├── gemini-integration/       # Gemini AI for receipts, bank statements, POS
├── transaction-engine/       # CRUD, categorization, duplicate detection
├── compliance/               # NDPR: consent, DSAR, retention, breach
├── insights/                 # Business analytics engine
├── notifications/            # Email, SMS, in-app, push
├── frontend/                 # Next.js app (separate build)
├── migrations/               # SQL migration files
└── ...                       # audit, access, alerting, dashboards, etc.
```

## Local Development

### Prerequisites

- Node.js >= 20
- Docker (for PostgreSQL and Redis)
- Google Gemini API key (optional, for document extraction)

### Setup

```bash
# Clone
git clone https://github.com/emmanuelakbi/cashtrace.git
cd cashtrace

# Start databases
docker-compose up -d

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env — set JWT_SECRET (generate one) and optionally GEMINI_API_KEY

# Run migrations
npm run db:migrate

# Start backend (port 4000)
npx tsx watch --env-file=.env src/server.ts

# In another terminal — start frontend (port 3000)
cd src/frontend
npm install
npm run dev
```

### Create a test user

```bash
psql $DATABASE_URL -c "
INSERT INTO users (id, email, password_hash, email_verified, created_at, updated_at)
VALUES (gen_random_uuid(), 'test@cashtrace.ng',
  '\$2b\$10\$Imh3uAq2tjbQTrGt4hHXQeSszdDwwRtW/6D91AzUN3x6XHknQOgfa',
  true, now(), now());
"
```

Login: `test@cashtrace.ng` / `Test1234`

## Deployment

### Backend (Railway)

1. Create a Railway project with PostgreSQL and Redis services
2. Add the GitHub repo as a service (uses the Dockerfile)
3. Reference `DATABASE_URL` and `REDIS_URL` from the database services
4. Set environment variables:
   ```
   NODE_ENV=production
   PORT=4000
   JWT_SECRET=<random 64-byte hex>
   GEMINI_API_KEY=<your key>
   APP_BASE_URL=https://your-frontend.vercel.app
   ```
5. Run migrations against Railway Postgres, then create the test user

### Frontend (Vercel)

1. Import the GitHub repo, set root directory to `src/frontend`
2. Set `NEXT_PUBLIC_API_URL=https://your-backend.up.railway.app`
3. Deploy

## Commands

```bash
npm run build          # Compile TypeScript
npm run lint           # ESLint
npm run format         # Prettier
npm test               # Run tests (vitest)
npm run test:coverage  # Tests with coverage
npm run db:migrate     # Run SQL migrations
```

## License

MIT
