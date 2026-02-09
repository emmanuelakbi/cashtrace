import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, closePool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(): Promise<void> {
  const pool = getPool();

  // Create migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  const migrationsDir = path.join(__dirname, "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const { rows } = await pool.query("SELECT 1 FROM _migrations WHERE name = $1", [file]);
    if (rows.length > 0) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    await pool.query(sql);
    await pool.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
    console.log(`Applied migration: ${file}`);
  }
}

// Run directly if executed as a script
const isMain = process.argv[1] && fileURLToPath(import.meta.url).includes(process.argv[1]);
if (isMain) {
  runMigrations()
    .then(() => {
      console.log("All migrations applied.");
      return closePool();
    })
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}
