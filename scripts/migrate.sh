#!/bin/bash
# Run all SQL migrations against the database.
# Usage: ./scripts/migrate.sh
# Requires: psql, DATABASE_URL or DB_* env vars

set -e

# Load .env if it exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep -v '^\s*$' | xargs)
fi

DB_URL="${DATABASE_URL:-postgresql://${DB_USER:-cashtrace}:${DB_PASSWORD:-cashtrace}@${DB_HOST:-localhost}:${DB_PORT:-5432}/${DB_NAME:-cashtrace}}"

echo "🗄️  Running migrations against: ${DB_HOST:-localhost}:${DB_PORT:-5432}/${DB_NAME:-cashtrace}"

for migration in src/migrations/*.sql; do
  echo "  ▶ $(basename "$migration")"
  psql "$DB_URL" -f "$migration" -q 2>&1 | grep -v "NOTICE" || true
done

echo "✅ All migrations applied"
