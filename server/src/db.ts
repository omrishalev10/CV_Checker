import { createClient, type Client, type Row } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import {
  bindAuthClient,
  createUserWithHash,
  legacyPasswordHash,
  normalizeUsername,
  userCount,
} from "./auth.js";
import { currentUserId } from "./context.js";
import { copyLegacySettingsToUser, loadSettingsCache } from "./settings.js";
import type { MatchAnalysis, SkillProfile, TailorDiff, TailoredCvGrade } from "./types.js";

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
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    );

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

    CREATE TABLE IF NOT EXISTS profile_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      mime TEXT,
      size INTEGER NOT NULL,
      content BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  await addMissingColumns("tailored_cvs", {
    grade_json: "TEXT",
    cv_json: "TEXT",
  });

  await loadSettingsCache(client);
  bindAuthClient(client);
  await migrateToMultiUser();
  return client;
}

async function tableColumns(table: string): Promise<Set<string>> {
  const info = await client.execute(`PRAGMA table_info(${table})`);
  return new Set(info.rows.map((r) => String(r.name)));
}

async function addMissingColumns(table: string, columns: Record<string, string>): Promise<void> {
  const existing = await tableColumns(table);
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
}

async function migrateToMultiUser(): Promise<void> {
  const sessionCols = await tableColumns("sessions");
  if (!sessionCols.has("user_id")) {
    await client.execute("DROP TABLE sessions");
    await client.execute(`
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `);
  }

  const ownerId = await ensureLegacyOwner();

  await addMissingColumns("analyses", { user_id: "INTEGER" });
  await addMissingColumns("profile_files", { user_id: "INTEGER" });

  if (ownerId) {
    await client.execute({
      sql: "UPDATE analyses SET user_id = ? WHERE user_id IS NULL",
      args: [ownerId],
    });
    await client.execute({
      sql: "UPDATE profile_files SET user_id = ? WHERE user_id IS NULL",
      args: [ownerId],
    });
  }

  await migrateProfileTable(ownerId);
}

async function ensureLegacyOwner(): Promise<number | null> {
  if ((await userCount()) > 0) {
    const first = await client.execute("SELECT id FROM users ORDER BY id LIMIT 1");
    return first.rows[0] ? Number(first.rows[0].id) : null;
  }

  const profile = await client.execute("SELECT COUNT(*) AS c FROM profile");
  const analyses = await client.execute("SELECT COUNT(*) AS c FROM analyses");
  const files = await client.execute("SELECT COUNT(*) AS c FROM profile_files");
  const hasData =
    Number(profile.rows[0]?.c || 0) > 0 ||
    Number(analyses.rows[0]?.c || 0) > 0 ||
    Number(files.rows[0]?.c || 0) > 0;

  const passwordHash = legacyPasswordHash();
  if (!hasData && !passwordHash) return null;

  if (!passwordHash) {
    console.log(
      "Existing data has no app password to attach to. The first person to sign up will own that data."
    );
    return null;
  }

  const username = normalizeUsername(process.env.OWNER_USERNAME || "omri");
  const owner = await createUserWithHash(username, passwordHash);
  await copyLegacySettingsToUser(owner.id);
  console.log(`Migrated existing CareerFit data to account "${username}".`);
  return owner.id;
}

export async function claimOrphanDataIfNeeded(userId: number): Promise<void> {
  const profileCols = await tableColumns("profile");
  if (profileCols.has("user_id")) {
    const owned = await client.execute({
      sql: "SELECT COUNT(*) AS c FROM profile WHERE user_id = ?",
      args: [userId],
    });
    if (Number(owned.rows[0]?.c || 0) > 0) return;
  }

  const unownedAnalyses = await client.execute(
    "SELECT COUNT(*) AS c FROM analyses WHERE user_id IS NULL"
  );
  const unownedFiles = await client.execute(
    "SELECT COUNT(*) AS c FROM profile_files WHERE user_id IS NULL"
  );
  const legacyProfile = profileCols.has("id") && !profileCols.has("user_id");

  const hasOrphans =
    Number(unownedAnalyses.rows[0]?.c || 0) > 0 ||
    Number(unownedFiles.rows[0]?.c || 0) > 0 ||
    legacyProfile;

  if (!hasOrphans) return;

  if (Number(unownedAnalyses.rows[0]?.c || 0) > 0) {
    await client.execute({
      sql: "UPDATE analyses SET user_id = ? WHERE user_id IS NULL",
      args: [userId],
    });
  }
  if (Number(unownedFiles.rows[0]?.c || 0) > 0) {
    await client.execute({
      sql: "UPDATE profile_files SET user_id = ? WHERE user_id IS NULL",
      args: [userId],
    });
  }
  await copyLegacySettingsToUser(userId);
  await migrateProfileTable(userId);
}

async function migrateProfileTable(ownerId: number | null): Promise<void> {
  const cols = await tableColumns("profile");
  if (cols.has("user_id") && !cols.has("id")) return;

  const counted = await client.execute("SELECT COUNT(*) AS c FROM profile");
  const empty = Number(counted.rows[0]?.c || 0) === 0;
  if (!ownerId && !empty) return;

  await client.execute(`
    CREATE TABLE IF NOT EXISTS profile_mt (
      user_id INTEGER PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1,
      profile_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  if (ownerId && cols.has("id")) {
    const old = await client.execute("SELECT * FROM profile WHERE id = 1");
    const row = old.rows[0];
    if (row) {
      await client.execute({
        sql: `INSERT OR IGNORE INTO profile_mt (user_id, version, profile_json, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?)`,
        args: [
          ownerId,
          Number(row.version),
          String(row.profile_json),
          String(row.created_at),
          String(row.updated_at),
        ],
      });
    }
  }

  await client.execute("DROP TABLE profile");
  await client.execute("ALTER TABLE profile_mt RENAME TO profile");
}

export function getClient(): Client {
  if (!client) throw new Error("Database not initialized");
  return client;
}

function uid(): number {
  return currentUserId();
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
  const result = await getClient().execute({
    sql: "SELECT * FROM profile WHERE user_id = ?",
    args: [uid()],
  });
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
  const userId = uid();
  const existing = await getProfile();
  const version = existing ? (bumpVersion ? existing.version + 1 : existing.version) : 1;
  const withStamp = { ...profile, updatedAt: now };
  const json = JSON.stringify(withStamp);

  if (existing) {
    await getClient().execute({
      sql: "UPDATE profile SET version = ?, profile_json = ?, updated_at = ? WHERE user_id = ?",
      args: [version, json, now, userId],
    });
  } else {
    await getClient().execute({
      sql: "INSERT INTO profile (user_id, version, profile_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      args: [userId, version, json, now, now],
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
          (user_id, profile_version, source_type, source_ref, job_title, company, raw_input, analysis_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      uid(),
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
    sql: "SELECT * FROM analyses WHERE id = ? AND user_id = ?",
    args: [Number(result.lastInsertRowid), uid()],
  });
  return toAnalysisRow(inserted.rows[0]);
}

export async function listAnalyses(): Promise<AnalysisRow[]> {
  const result = await getClient().execute({
    sql: "SELECT * FROM analyses WHERE user_id = ? ORDER BY datetime(created_at) DESC",
    args: [uid()],
  });
  return result.rows.map(toAnalysisRow);
}

export async function getAnalysis(id: number): Promise<AnalysisRow | undefined> {
  const result = await getClient().execute({
    sql: "SELECT * FROM analyses WHERE id = ? AND user_id = ?",
    args: [id, uid()],
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
  if (!(await getAnalysis(input.analysisId))) {
    throw new Error("Match not found.");
  }
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
  if (!(await getAnalysis(analysisId))) return undefined;
  const result = await getClient().execute({
    sql: "SELECT * FROM tailored_cvs WHERE analysis_id = ?",
    args: [analysisId],
  });
  const row = result.rows[0];
  return row ? toTailoredRow(row) : undefined;
}

export async function deleteAnalysis(analysisId: number): Promise<void> {
  if (!(await getAnalysis(analysisId))) return;
  await getClient().batch(
    [
      { sql: "DELETE FROM tailored_cvs WHERE analysis_id = ?", args: [analysisId] },
      { sql: "DELETE FROM analyses WHERE id = ? AND user_id = ?", args: [analysisId, uid()] },
    ],
    "write"
  );
}

export interface ProfileFileMeta {
  id: number;
  filename: string;
  mime: string | null;
  size: number;
  createdAt: string;
}

export async function listProfileFiles(): Promise<ProfileFileMeta[]> {
  const result = await getClient().execute({
    sql: "SELECT id, filename, mime, size, created_at FROM profile_files WHERE user_id = ? ORDER BY datetime(created_at) DESC",
    args: [uid()],
  });
  return result.rows.map((row) => ({
    id: Number(row.id),
    filename: str(row.filename),
    mime: strOrNull(row.mime),
    size: Number(row.size) || 0,
    createdAt: str(row.created_at),
  }));
}

export async function insertProfileFile(input: {
  filename: string;
  mime: string | null;
  content: Uint8Array;
}): Promise<ProfileFileMeta> {
  const existing = await listProfileFiles();
  if (existing.length >= 40) {
    throw new Error("You already have 40 files. Remove one before uploading another.");
  }
  const now = new Date().toISOString();
  const result = await getClient().execute({
    sql: "INSERT INTO profile_files (user_id, filename, mime, size, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [uid(), input.filename, input.mime, input.content.byteLength, input.content, now],
  });
  const id = Number(result.lastInsertRowid);
  return {
    id,
    filename: input.filename,
    mime: input.mime,
    size: input.content.byteLength,
    createdAt: now,
  };
}

export async function getProfileFile(
  id: number
): Promise<(ProfileFileMeta & { content: Uint8Array }) | undefined> {
  const result = await getClient().execute({
    sql: "SELECT id, filename, mime, size, created_at, content FROM profile_files WHERE id = ? AND user_id = ?",
    args: [id, uid()],
  });
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    id: Number(row.id),
    filename: str(row.filename),
    mime: strOrNull(row.mime),
    size: Number(row.size) || 0,
    createdAt: str(row.created_at),
    content: toBytes(row.content),
  };
}

export async function deleteProfileFile(id: number): Promise<boolean> {
  const result = await getClient().execute({
    sql: "DELETE FROM profile_files WHERE id = ? AND user_id = ?",
    args: [id, uid()],
  });
  return Number(result.rowsAffected) > 0;
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (typeof value === "string") return Buffer.from(value, "base64");
  return new Uint8Array();
}
