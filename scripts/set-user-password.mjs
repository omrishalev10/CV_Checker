/**
 * Set a user's password (local/Turso). Example:
 *   node scripts/set-user-password.mjs omri "your-new-password"
 */
import { createClient } from "@libsql/client";
import crypto from "node:crypto";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(".env") });

const username = (process.argv[2] || "").trim().toLowerCase();
const password = process.argv[3] || "";
if (!username || password.length < 8) {
  console.error("Usage: node scripts/set-user-password.mjs <username> <password>");
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync(password.normalize("NFKC"), salt, 64).toString("hex");
const stored = `scrypt$${salt}$${hash}`;

const url = (process.env.TURSO_DATABASE_URL || "").trim();
const client = url
  ? createClient({ url, authToken: (process.env.TURSO_AUTH_TOKEN || "").trim() || undefined })
  : createClient({ url: `file:${path.resolve("data", "careerfit.sqlite")}` });

const found = await client.execute({
  sql: "SELECT id FROM users WHERE username = ?",
  args: [username],
});
if (!found.rows[0]) {
  console.error(`No user named "${username}".`);
  process.exit(1);
}

await client.execute({
  sql: "UPDATE users SET password_hash = ? WHERE username = ?",
  args: [stored, username],
});
await client.execute({
  sql: "DELETE FROM sessions WHERE user_id = ?",
  args: [Number(found.rows[0].id)],
});
console.log(`Password updated for "${username}". Sign in with that username and the new password.`);
