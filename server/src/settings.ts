import type { Client } from "@libsql/client";

export type AiProvider = "gemini" | "anthropic";

let clientRef: Client | null = null;

/**
 * Settings are read on nearly every request but written rarely, so the table is
 * mirrored in memory. That keeps reads synchronous for callers like the AI client
 * and the auth middleware even though libSQL is async.
 * Assumes a single server instance, which is what the free hosting tiers give us.
 */
const cache = new Map<string, string>();

export async function loadSettingsCache(client: Client): Promise<void> {
  clientRef = client;
  cache.clear();
  const result = await client.execute("SELECT key, value FROM settings");
  for (const row of result.rows) {
    cache.set(String(row.key), String(row.value));
  }
  await seedKeysFromEnv();
}

function db(): Client {
  if (!clientRef) throw new Error("Settings DB not initialized");
  return clientRef;
}

export function getSetting(key: string): string | null {
  return cache.get(key) ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const now = new Date().toISOString();
  await db().execute({
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [key, value, now],
  });
  cache.set(key, value);
}

export async function deleteSetting(key: string): Promise<void> {
  await db().execute({ sql: "DELETE FROM settings WHERE key = ?", args: [key] });
  cache.delete(key);
}

export function maskSecret(secret: string): string {
  if (secret.length <= 10) return "••••••••";
  return `${secret.slice(0, 6)}…${secret.slice(-4)}`;
}

/** Infer provider from key shape so the UI stays provider-agnostic. */
export function detectProviderFromKey(apiKey: string): AiProvider {
  const key = apiKey.trim();
  if (key.startsWith("sk-ant")) return "anthropic";
  if (key.startsWith("AQ.") || key.startsWith("AIza")) return "gemini";
  // Default: treat unknown keys as Gemini-compatible (common free-tier keys)
  return "gemini";
}

export function resolveApiKey(): string | null {
  const fromDb = getSetting("api_key")?.trim();
  if (fromDb) return fromDb;

  const unified = (process.env.AI_API_KEY || "").trim();
  if (unified && !unified.includes("your-key-here")) return unified;

  const gemini = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  if (gemini && !gemini.includes("your-key-here")) return gemini;
  const anthropic = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (anthropic && !anthropic.includes("your-key-here")) return anthropic;

  const legacyGemini = getSetting("gemini_api_key")?.trim();
  if (legacyGemini) return legacyGemini;
  const legacyAnthropic = getSetting("anthropic_api_key")?.trim();
  if (legacyAnthropic) return legacyAnthropic;

  return null;
}

export function getProvider(): AiProvider {
  const key = resolveApiKey();
  if (key) return detectProviderFromKey(key);

  const envProvider = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (envProvider === "anthropic" || envProvider === "gemini") return envProvider;
  return "gemini";
}

export function getModel(): string {
  const fromDb = getSetting("ai_model")?.trim();
  if (fromDb) return fromDb;

  const provider = getProvider();
  if (provider === "anthropic") {
    return process.env.CLAUDE_MODEL || "claude-sonnet-4-5";
  }
  return process.env.GEMINI_MODEL || "gemini-3.5-flash";
}

export async function seedKeysFromEnv(): Promise<void> {
  if (getSetting("api_key")) return;

  const unified = (process.env.AI_API_KEY || "").trim();
  if (unified && !unified.includes("your-key-here")) {
    await setSetting("api_key", unified);
    return;
  }

  const gemini = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  if (gemini && !gemini.includes("your-key-here")) {
    await setSetting("api_key", gemini);
    return;
  }
  const anthropic = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (anthropic && !anthropic.includes("your-key-here")) {
    await setSetting("api_key", anthropic);
    return;
  }

  // Migrate older per-provider settings into the generic key
  const legacy = getSetting("gemini_api_key") || getSetting("anthropic_api_key");
  if (legacy) await setSetting("api_key", legacy);
}
