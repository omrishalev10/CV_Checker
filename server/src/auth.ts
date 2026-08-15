import crypto from "node:crypto";
import type { Client } from "@libsql/client";
import type { NextFunction, Request, Response } from "express";
import { deleteSetting, getSetting, setSetting } from "./settings.js";

const PASSWORD_SETTING = "auth_password";
const COOKIE_NAME = "cf_session";
const SESSION_DAYS = 30;
const SCRYPT_KEYLEN = 64;

let clientRef: Client | null = null;

export function bindAuthClient(client: Client): void {
  clientRef = client;
}

function db(): Client {
  if (!clientRef) throw new Error("Auth DB not initialized");
  return clientRef;
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password.normalize("NFKC"), salt, SCRYPT_KEYLEN).toString("hex");
}

function encodeStoredPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt$${salt}$${hashPassword(password, salt)}`;
}

function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Env password is a fallback for headless deploys where nobody can click through Settings. */
function envPassword(): string | null {
  const value = (process.env.APP_PASSWORD || "").trim();
  return value ? value : null;
}

export function isAuthConfigured(): boolean {
  return Boolean(getSetting(PASSWORD_SETTING) || envPassword());
}

export async function setPassword(password: string): Promise<void> {
  await setSetting(PASSWORD_SETTING, encodeStoredPassword(password));
  await revokeAllSessions();
}

export async function clearPassword(): Promise<void> {
  await deleteSetting(PASSWORD_SETTING);
  await revokeAllSessions();
}

export function verifyPassword(password: string): boolean {
  const stored = getSetting(PASSWORD_SETTING);
  if (stored) {
    const [scheme, salt, hash] = stored.split("$");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    return safeEquals(hashPassword(password, salt), hash);
  }
  const fromEnv = envPassword();
  if (fromEnv) return safeEquals(password.normalize("NFKC"), fromEnv.normalize("NFKC"));
  return false;
}

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function purgeExpiredSessions(): Promise<void> {
  await db().execute("DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now')");
}

export async function createSession(): Promise<{ token: string; maxAgeMs: number }> {
  await purgeExpiredSessions();
  const token = crypto.randomBytes(32).toString("base64url");
  const maxAgeMs = SESSION_DAYS * 24 * 60 * 60 * 1000;
  const now = new Date();
  await db().execute({
    sql: "INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)",
    args: [tokenHash(token), now.toISOString(), new Date(now.getTime() + maxAgeMs).toISOString()],
  });
  return { token, maxAgeMs };
}

export async function revokeSession(token: string): Promise<void> {
  await db().execute({
    sql: "DELETE FROM sessions WHERE token_hash = ?",
    args: [tokenHash(token)],
  });
}

export async function revokeAllSessions(): Promise<void> {
  await db().execute("DELETE FROM sessions");
}

async function isValidSession(token: string): Promise<boolean> {
  const result = await db().execute({
    sql: "SELECT expires_at FROM sessions WHERE token_hash = ?",
    args: [tokenHash(token)],
  });
  const row = result.rows[0];
  if (!row) return false;
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
    await revokeSession(token);
    return false;
  }
  return true;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

function isSecureRequest(req: Request): boolean {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

export function setSessionCookie(req: Request, res: Response, token: string, maxAgeMs: number): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    maxAge: maxAgeMs,
    path: "/",
  });
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    path: "/",
  });
}

export function getSessionToken(req: Request): string | null {
  return readCookie(req, COOKIE_NAME);
}

export async function isAuthenticated(req: Request): Promise<boolean> {
  if (!isAuthConfigured()) return true;
  const token = getSessionToken(req);
  if (!token) return false;
  return isValidSession(token);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  isAuthenticated(req)
    .then((ok) => {
      if (ok) {
        next();
        return;
      }
      res.status(401).json({ error: "Sign in to continue.", authRequired: true });
    })
    .catch(next);
}

const attempts = new Map<string, { count: number; blockedUntil: number }>();
const MAX_ATTEMPTS = 8;
const BLOCK_MS = 5 * 60 * 1000;

export function loginBlockedFor(ip: string): number {
  const entry = attempts.get(ip);
  if (!entry) return 0;
  return Math.max(0, entry.blockedUntil - Date.now());
}

export function recordLoginFailure(ip: string): void {
  const entry = attempts.get(ip) ?? { count: 0, blockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = Date.now() + BLOCK_MS;
    entry.count = 0;
  }
  attempts.set(ip, entry);
}

export function clearLoginFailures(ip: string): void {
  attempts.delete(ip);
}
