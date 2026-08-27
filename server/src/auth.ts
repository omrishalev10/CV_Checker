import crypto from "node:crypto";
import type { Client } from "@libsql/client";
import type { NextFunction, Request, Response } from "express";
import { runWithUser } from "./context.js";
import { getSetting } from "./settings.js";

const COOKIE_NAME = "cf_session";
const SESSION_DAYS = 30;
const SCRYPT_KEYLEN = 64;
export const MIN_PASSWORD_LENGTH = 8;
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,32}$/;

export interface AuthUser {
  id: number;
  username: string;
  password_hash: string;
}

let clientRef: Client | null = null;

export function bindAuthClient(client: Client): void {
  clientRef = client;
}

function db(): Client {
  if (!clientRef) throw new Error("Auth DB not initialized");
  return clientRef;
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password.normalize("NFKC"), salt, SCRYPT_KEYLEN).toString("hex");
}

export function encodeStoredPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt$${salt}$${hashPassword(password, salt)}`;
}

function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function passwordMatches(stored: string, password: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  return safeEquals(hashPassword(password, salt), hash);
}

export async function findUserByUsername(username: string): Promise<AuthUser | null> {
  const result = await db().execute({
    sql: "SELECT id, username, password_hash FROM users WHERE username = ?",
    args: [normalizeUsername(username)],
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    username: String(row.username),
    password_hash: String(row.password_hash),
  };
}

export async function findUserById(id: number): Promise<AuthUser | null> {
  const result = await db().execute({
    sql: "SELECT id, username, password_hash FROM users WHERE id = ?",
    args: [id],
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    username: String(row.username),
    password_hash: String(row.password_hash),
  };
}

export async function createUser(username: string, password: string): Promise<AuthUser> {
  const normalized = normalizeUsername(username);
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new Error("Username must be 3–32 letters, numbers, or underscores.");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`);
  }
  const now = new Date().toISOString();
  try {
    const result = await db().execute({
      sql: "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
      args: [normalized, encodeStoredPassword(password), now],
    });
    return {
      id: Number(result.lastInsertRowid),
      username: normalized,
      password_hash: "",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/unique|constraint/i.test(message)) {
      throw new Error("That username is already taken.");
    }
    throw err;
  }
}

export async function createUserWithHash(username: string, passwordHash: string): Promise<AuthUser> {
  const normalized = normalizeUsername(username);
  const now = new Date().toISOString();
  const result = await db().execute({
    sql: "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
    args: [normalized, passwordHash, now],
  });
  return { id: Number(result.lastInsertRowid), username: normalized, password_hash: passwordHash };
}

export async function userCount(): Promise<number> {
  const result = await db().execute("SELECT COUNT(*) AS c FROM users");
  return Number(result.rows[0]?.c || 0);
}

export async function setUserPassword(userId: number, password: string): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`);
  }
  await db().execute({
    sql: "UPDATE users SET password_hash = ? WHERE id = ?",
    args: [encodeStoredPassword(password), userId],
  });
  await revokeUserSessions(userId);
}

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function purgeExpiredSessions(): Promise<void> {
  await db().execute("DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now')");
}

export async function createSession(userId: number): Promise<{ token: string; maxAgeMs: number }> {
  await purgeExpiredSessions();
  const token = crypto.randomBytes(32).toString("base64url");
  const maxAgeMs = SESSION_DAYS * 24 * 60 * 60 * 1000;
  const now = new Date();
  await db().execute({
    sql: "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    args: [tokenHash(token), userId, now.toISOString(), new Date(now.getTime() + maxAgeMs).toISOString()],
  });
  return { token, maxAgeMs };
}

export async function revokeSession(token: string): Promise<void> {
  await db().execute({
    sql: "DELETE FROM sessions WHERE token_hash = ?",
    args: [tokenHash(token)],
  });
}

export async function revokeUserSessions(userId: number): Promise<void> {
  await db().execute({ sql: "DELETE FROM sessions WHERE user_id = ?", args: [userId] });
}

async function userIdForSession(token: string): Promise<number | null> {
  const result = await db().execute({
    sql: "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?",
    args: [tokenHash(token)],
  });
  const row = result.rows[0];
  if (!row) return null;
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
    await revokeSession(token);
    return null;
  }
  return Number(row.user_id);
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

export async function getRequestUser(req: Request): Promise<AuthUser | null> {
  const token = getSessionToken(req);
  if (!token) return null;
  const userId = await userIdForSession(token);
  if (!userId) return null;
  return findUserById(userId);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  getRequestUser(req)
    .then((user) => {
      if (!user) {
        res.status(401).json({ error: "Sign in to continue.", authRequired: true });
        return;
      }
      req.userId = user.id;
      req.username = user.username;
      runWithUser({ userId: user.id, username: user.username }, () => next());
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

/** Used only while migrating the original single-user install. */
export function legacyPasswordHash(): string | null {
  const stored = getSetting("auth_password")?.trim();
  if (stored) return stored;
  const env = (process.env.APP_PASSWORD || "").trim();
  if (!env) return null;
  return encodeStoredPassword(env);
}
