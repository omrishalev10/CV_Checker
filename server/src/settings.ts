import type { Client } from "@libsql/client";
import { tryCurrentUserId } from "./context.js";

export type AiProvider = "gemini" | "anthropic";

let clientRef: Client | null = null;

/** Global install settings (legacy keys during migration). Not used for per-user API keys. */
const cache = new Map<string, string>();

export async function loadSettingsCache(client: Client): Promise<void> {
  clientRef = client;
  cache.clear();
  const result = await client.execute("SELECT key, value FROM settings");
  for (const row of result.rows) {
    cache.set(String(row.key), String(row.value));
  }
}

function db(): Client {
  if (!clientRef) throw new Error("Settings DB not initialized");
  return clientRef;
}

export function getSetting(key: string): string | null {
  return cache.get(key) ?? null;
}

export async function getUserSetting(userId: number, key: string): Promise<string | null> {
  const result = await db().execute({
    sql: "SELECT value FROM user_settings WHERE user_id = ? AND key = ?",
    args: [userId, key],
  });
  const row = result.rows[0];
  return row ? String(row.value) : null;
}

export async function setUserSetting(userId: number, key: string, value: string): Promise<void> {
  const now = new Date().toISOString();
  await db().execute({
    sql: `INSERT INTO user_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [userId, key, value, now],
  });
}

export async function deleteUserSetting(userId: number, key: string): Promise<void> {
  await db().execute({
    sql: "DELETE FROM user_settings WHERE user_id = ? AND key = ?",
    args: [userId, key],
  });
}

export function maskSecret(secret: string): string {
  if (secret.length <= 10) return "••••••••";
  return `${secret.slice(0, 6)}…${secret.slice(-4)}`;
}

export function detectProviderFromKey(apiKey: string): AiProvider {
  const key = apiKey.trim();
  if (key.startsWith("sk-ant")) return "anthropic";
  if (key.startsWith("AQ.") || key.startsWith("AIza")) return "gemini";
  return "gemini";
}

function envApiKey(): string | null {
  const unified = (process.env.AI_API_KEY || "").trim();
  if (unified && !unified.includes("your-key-here")) return unified;
  const gemini = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  if (gemini && !gemini.includes("your-key-here")) return gemini;
  const anthropic = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (anthropic && !anthropic.includes("your-key-here")) return anthropic;
  return null;
}

export async function resolveApiKey(): Promise<string | null> {
  const userId = tryCurrentUserId();
  if (userId) {
    const fromDb = (await getUserSetting(userId, "api_key"))?.trim();
    if (fromDb) return fromDb;
    const legacyGemini = (await getUserSetting(userId, "gemini_api_key"))?.trim();
    if (legacyGemini) return legacyGemini;
    const legacyAnthropic = (await getUserSetting(userId, "anthropic_api_key"))?.trim();
    if (legacyAnthropic) return legacyAnthropic;
  }
  return null;
}

export async function getProvider(): Promise<AiProvider> {
  const key = await resolveApiKey();
  if (key) return detectProviderFromKey(key);
  const envProvider = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (envProvider === "anthropic" || envProvider === "gemini") return envProvider;
  return "gemini";
}

export function getModel(): string {
  const providerSync = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (providerSync === "anthropic") {
    return process.env.CLAUDE_MODEL || "claude-sonnet-4-5";
  }
  return process.env.GEMINI_MODEL || "gemini-3.5-flash";
}

export async function copyLegacySettingsToUser(userId: number): Promise<void> {
  const keys = ["api_key", "gemini_api_key", "anthropic_api_key", "ai_model"];
  for (const key of keys) {
    const value = getSetting(key)?.trim();
    if (value) await setUserSetting(userId, key, value);
  }
  if (!(await getUserSetting(userId, "api_key"))) {
    const envKey = envApiKey();
    if (envKey) await setUserSetting(userId, "api_key", envKey);
  }
}
