/**
 * Verifies history deletion removes the analysis and its tailored CV row.
 * Needs a running server; pass a password if the app is locked:
 *   npx tsx scripts/test-delete.mts http://localhost:3001 mypassword
 */
import path from "node:path";
import { getClient, initDb } from "../server/src/db.ts";

const base = process.argv[2] || "http://localhost:3001";
const password = process.argv[3] || process.env.APP_PASSWORD || "";

let cookie = "";
if (password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  console.log("login status:", res.status);
}
const headers = cookie ? { cookie } : undefined;

await initDb(path.resolve("./data"));
const client = getClient();

const countAnalyses = async () => {
  const r = await client.execute("SELECT COUNT(*) c FROM analyses");
  return Number(r.rows[0].c);
};

const before = await countAnalyses();

const now = new Date().toISOString();
const inserted = await client.execute({
  sql: `INSERT INTO analyses (profile_version, source_type, source_ref, job_title, company, raw_input, analysis_json, created_at)
        VALUES (1, 'text', NULL, 'THROWAWAY delete test', 'Test Co', 'job text', ?, ?)`,
  args: [
    JSON.stringify({
      score: 10,
      label: "Low",
      explanation: "test",
      matched: [],
      gapsHard: [],
      gapsNice: [],
      recommendation: "test",
    }),
    now,
  ],
});
const id = Number(inserted.lastInsertRowid);

await client.execute({
  sql: `INSERT INTO tailored_cvs (analysis_id, diff_json, created_at, grade_json, cv_json)
        VALUES (?, '{"changes":[],"notAdded":[]}', ?, NULL, '{}')`,
  args: [id, now],
});
console.log(`seeded throwaway analysis id=${id}`);

const del = await fetch(`${base}/api/matches/${id}`, { method: "DELETE", headers });
console.log("delete status:", del.status, await del.text());

const detail = await fetch(`${base}/api/matches/${id}`, { headers });
console.log("detail after delete (expect 404):", detail.status);

const again = await fetch(`${base}/api/matches/${id}`, { method: "DELETE", headers });
console.log("second delete (expect 404):", again.status);

const after = await countAnalyses();
const orphanRows = await client.execute({
  sql: "SELECT COUNT(*) c FROM tailored_cvs WHERE analysis_id = ?",
  args: [id],
});
const orphans = Number(orphanRows.rows[0].c);

console.log(`analyses before=${before} after=${after} | orphan tailored rows=${orphans}`);
console.log(after === before && orphans === 0 ? "PASS" : "FAIL");
process.exit(after === before && orphans === 0 ? 0 : 1);
