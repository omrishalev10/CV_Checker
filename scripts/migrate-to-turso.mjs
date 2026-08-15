/**
 * Copies a local CareerFit database into Turso so a deploy starts with your
 * existing profile and match history.
 *
 *   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... node scripts/migrate-to-turso.mjs
 *
 * Pass --force to overwrite a destination that already holds data.
 * Sessions are deliberately not copied — you sign in again after deploying.
 */
import { createClient } from "@libsql/client";
import path from "node:path";
import fs from "node:fs";

const force = process.argv.includes("--force");
const dataDir = process.argv.find((a) => a.startsWith("--data="))?.slice(7) || "data";
const dbPath = path.resolve(dataDir, "careerfit.sqlite");

const url = (process.env.TURSO_DATABASE_URL || "").trim();
const authToken = (process.env.TURSO_AUTH_TOKEN || "").trim() || undefined;

if (!url) {
  console.error("TURSO_DATABASE_URL is required.");
  process.exit(1);
}
if (!fs.existsSync(dbPath)) {
  console.error(`No local database at ${dbPath}`);
  process.exit(1);
}

const local = createClient({ url: `file:${dbPath}` });
const remote = createClient({ url, authToken });

console.log(`source: ${dbPath}`);
console.log(`target: ${new URL(url).host}\n`);

await remote.executeMultiple(`
  CREATE TABLE IF NOT EXISTS profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL DEFAULT 1,
    profile_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_version INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    source_ref TEXT,
    job_title TEXT,
    company TEXT,
    raw_input TEXT,
    analysis_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tailored_cvs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_id INTEGER NOT NULL UNIQUE,
    diff_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    grade_json TEXT,
    cv_json TEXT,
    FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
`);

const existing = await remote.execute("SELECT COUNT(*) c FROM analyses");
const existingProfile = await remote.execute("SELECT COUNT(*) c FROM profile");
const occupied = Number(existing.rows[0].c) + Number(existingProfile.rows[0].c);
if (occupied > 0 && !force) {
  console.error(
    `Target already has data (${Number(existingProfile.rows[0].c)} profile, ${Number(
      existing.rows[0].c
    )} analyses). Re-run with --force to overwrite.`
  );
  process.exit(1);
}

if (force) {
  await remote.batch(
    [
      "DELETE FROM tailored_cvs",
      "DELETE FROM analyses",
      "DELETE FROM profile",
      "DELETE FROM settings",
    ],
    "write"
  );
  console.log("cleared target tables");
}

const profile = await local.execute("SELECT * FROM profile");
for (const r of profile.rows) {
  await remote.execute({
    sql: "INSERT INTO profile (id, version, profile_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    args: [Number(r.id), Number(r.version), r.profile_json, r.created_at, r.updated_at],
  });
}
console.log(`profile rows copied: ${profile.rows.length}`);

const analyses = await local.execute("SELECT * FROM analyses ORDER BY id");
for (const r of analyses.rows) {
  await remote.execute({
    sql: `INSERT INTO analyses (id, profile_version, source_type, source_ref, job_title, company, raw_input, analysis_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      Number(r.id),
      Number(r.profile_version),
      r.source_type,
      r.source_ref,
      r.job_title,
      r.company,
      r.raw_input,
      r.analysis_json,
      r.created_at,
    ],
  });
}
console.log(`analyses copied: ${analyses.rows.length}`);

const tailored = await local.execute("SELECT * FROM tailored_cvs ORDER BY id");
let skipped = 0;
for (const r of tailored.rows) {
  // Rows with no cv_json only pointed at files on the old machine and cannot be re-rendered.
  if (!r.cv_json) {
    skipped += 1;
    continue;
  }
  await remote.execute({
    sql: `INSERT INTO tailored_cvs (analysis_id, diff_json, created_at, grade_json, cv_json)
          VALUES (?, ?, ?, ?, ?)`,
    args: [Number(r.analysis_id), r.diff_json, r.created_at, r.grade_json, r.cv_json],
  });
}
console.log(
  `tailored CVs copied: ${tailored.rows.length - skipped}` +
    (skipped ? ` (${skipped} skipped — no stored content to re-render)` : "")
);

// Carries over the app password and AI key so the deploy is usable immediately.
const settings = await local.execute("SELECT * FROM settings");
for (const r of settings.rows) {
  await remote.execute({
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [r.key, r.value, r.updated_at],
  });
}
console.log(`settings copied: ${settings.rows.length} (includes your app password and AI key)`);

console.log("\nMigration complete.");
