import { createClient, type Client, type Row } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import type { MatchAnalysis, SkillProfile, TailorDiff, TailoredCvGrade } from "./types.js";
import { loadSettingsCache } from "./settings.js";
import { bindAuthClient } from "./auth.js";

export interface ProfileRow {
  id: number;
  version: number;
  profile_json: string;
  created_at: string;
  updated_at: string;
}

export interface AnalysisRow {
  id: number;
  profile_version: number;
  source_type: "text" | "image" | "url";
  source_ref: string | null;
  job_title: string | null;
  company: string | null;
  raw_input: string | null;
  analysis_json: string;
  created_at: string;
}

export interface TailoredCvRow {
  id: number;
  analysis_id: number;
  diff_json: string;
  created_at: string;
  grade_json: string | null;
  cv_json: string | null;
}

let client: Client;

/**
 * Uses Turso when TURSO_DATABASE_URL is set, otherwise a local SQLite file.
 * Both go through the same libSQL client so there is only one code path to maintain.
 */
export async function initDb(dataDir: string): Promise<Client> {
  const remoteUrl = (process.env.TURSO_DATABASE_URL || "").trim();

  if (remoteUrl) {
    client = createClient({
      url: remoteUrl,
      authToken: (process.env.TURSO_AUTH_TOKEN || "").trim() || undefined,
    });
    console.log(`Database: Turso (${new URL(remoteUrl).host})`);
  } else {
    fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, "careerfit.sqlite");
    client = createClient({ url: `file:${dbPath}` });
    console.log(`Database: local file (${dbPath})`);
  }

  await client.executeMultiple(`
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

  // Columns added after the original schema shipped; also covers legacy on-disk
  // path columns so existing local databases keep opening.
  await addMissingColumns("tailored_cvs", {
    grade_json: "TEXT",
    cv_json: "TEXT",
  });

  await loadSettingsCache(client);
  bindAuthClient(client);
  return client;
}

async function addMissingColumns(table: string, columns: Record<string, string>): Promise<void> {
  const info = await client.execute(`PRAGMA table_info(${table})`);
  const existing = new Set(info.rows.map((r) => String(r.name)));
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
}

export function getClient(): Client {
  if (!client) throw new Error("Database not initialized");
  return client;
}

function str(value: unknown): string {
  return String(value);
}

function strOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function toAnalysisRow(row: Row): AnalysisRow {
  return {
    id: Number(row.id),
    profile_version: Number(row.profile_version),
    source_type: str(row.source_type) as AnalysisRow["source_type"],
    source_ref: strOrNull(row.source_ref),
    job_title: strOrNull(row.job_title),
    company: strOrNull(row.company),
    raw_input: strOrNull(row.raw_input),
    analysis_json: str(row.analysis_json),
    created_at: str(row.created_at),
  };
}

function toTailoredRow(row: Row): TailoredCvRow {
  return {
    id: Number(row.id),
    analysis_id: Number(row.analysis_id),
    diff_json: str(row.diff_json),
    created_at: str(row.created_at),
    grade_json: strOrNull(row.grade_json),
    cv_json: strOrNull(row.cv_json),
  };
}

export async function getProfile(): Promise<{ version: number; profile: SkillProfile } | null> {
  const result = await getClient().execute("SELECT * FROM profile WHERE id = 1");
  const row = result.rows[0];
  if (!row) return null;
  return {
    version: Number(row.version),
    profile: JSON.parse(str(row.profile_json)) as SkillProfile,
  };
}

export async function saveProfile(
  profile: SkillProfile,
  bumpVersion = true
): Promise<{ version: number; profile: SkillProfile }> {
  const now = new Date().toISOString();
  const existing = await getProfile();
  const version = existing ? (bumpVersion ? existing.version + 1 : existing.version) : 1;
  const withStamp = { ...profile, updatedAt: now };
  const json = JSON.stringify(withStamp);

  if (existing) {
    await getClient().execute({
      sql: "UPDATE profile SET version = ?, profile_json = ?, updated_at = ? WHERE id = 1",
      args: [version, json, now],
    });
  } else {
    await getClient().execute({
      sql: "INSERT INTO profile (id, version, profile_json, created_at, updated_at) VALUES (1, ?, ?, ?, ?)",
      args: [version, json, now, now],
    });
  }
  return { version, profile: withStamp };
}

export async function insertAnalysis(input: {
  profileVersion: number;
  sourceType: "text" | "image" | "url";
  sourceRef?: string | null;
  analysis: MatchAnalysis;
  rawInput?: string | null;
}): Promise<AnalysisRow> {
  const now = new Date().toISOString();
  const result = await getClient().execute({
    sql: `INSERT INTO analyses
          (profile_version, source_type, source_ref, job_title, company, raw_input, analysis_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.profileVersion,
      input.sourceType,
      input.sourceRef ?? null,
      input.analysis.jobTitle ?? null,
      input.analysis.company ?? null,
      input.rawInput ?? null,
      JSON.stringify(input.analysis),
      now,
    ],
  });

  const inserted = await getClient().execute({
    sql: "SELECT * FROM analyses WHERE id = ?",
    args: [Number(result.lastInsertRowid)],
  });
  return toAnalysisRow(inserted.rows[0]);
}

export async function listAnalyses(): Promise<AnalysisRow[]> {
  const result = await getClient().execute(
    "SELECT * FROM analyses ORDER BY datetime(created_at) DESC"
  );
  return result.rows.map(toAnalysisRow);
}

export async function getAnalysis(id: number): Promise<AnalysisRow | undefined> {
  const result = await getClient().execute({
    sql: "SELECT * FROM analyses WHERE id = ?",
    args: [id],
  });
  const row = result.rows[0];
  return row ? toAnalysisRow(row) : undefined;
}

export async function saveTailoredCv(input: {
  analysisId: number;
  diff: TailorDiff;
  grade?: TailoredCvGrade | null;
  cv?: unknown;
}): Promise<TailoredCvRow> {
  const now = new Date().toISOString();
  await getClient().execute({
    sql: `INSERT INTO tailored_cvs (analysis_id, diff_json, created_at, grade_json, cv_json)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(analysis_id) DO UPDATE SET
            diff_json = excluded.diff_json,
            created_at = excluded.created_at,
            grade_json = excluded.grade_json,
            cv_json = excluded.cv_json`,
    args: [
      input.analysisId,
      JSON.stringify(input.diff),
      now,
      input.grade ? JSON.stringify(input.grade) : null,
      input.cv ? JSON.stringify(input.cv) : null,
    ],
  });

  const result = await getClient().execute({
    sql: "SELECT * FROM tailored_cvs WHERE analysis_id = ?",
    args: [input.analysisId],
  });
  return toTailoredRow(result.rows[0]);
}

export async function getTailoredCv(analysisId: number): Promise<TailoredCvRow | undefined> {
  const result = await getClient().execute({
    sql: "SELECT * FROM tailored_cvs WHERE analysis_id = ?",
    args: [analysisId],
  });
  const row = result.rows[0];
  return row ? toTailoredRow(row) : undefined;
}

export async function deleteAnalysis(analysisId: number): Promise<void> {
  await getClient().batch(
    [
      { sql: "DELETE FROM tailored_cvs WHERE analysis_id = ?", args: [analysisId] },
      { sql: "DELETE FROM analyses WHERE id = ?", args: [analysisId] },
    ],
    "write"
  );
}
