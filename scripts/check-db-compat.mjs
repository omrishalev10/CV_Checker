/** Confirms an existing local database opens and reads correctly under the libSQL client. */
import { createClient } from "@libsql/client";
import path from "node:path";

const dataDir = process.argv[2] || "data";
const dbPath = path.resolve(dataDir, "careerfit.sqlite");
const client = createClient({ url: `file:${dbPath}` });

console.log(`opening ${dbPath}`);

const tables = await client.execute(
  "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
);
console.log("tables:", tables.rows.map((r) => r.name).join(", "));

for (const table of ["profile", "analyses", "tailored_cvs", "settings", "sessions"]) {
  try {
    const result = await client.execute(`SELECT COUNT(*) c FROM ${table}`);
    console.log(`  ${table}: ${Number(result.rows[0].c)} rows`);
  } catch (err) {
    console.log(`  ${table}: missing (${err instanceof Error ? err.message : err})`);
  }
}

const cols = await client.execute("PRAGMA table_info(tailored_cvs)");
console.log("tailored_cvs columns:", cols.rows.map((r) => r.name).join(", "));

const tailored = await client.execute(
  "SELECT analysis_id, cv_json IS NOT NULL AS has_cv FROM tailored_cvs"
);
if (tailored.rows.length) {
  const renderable = tailored.rows.filter((r) => Number(r.has_cv) === 1).length;
  console.log(
    `tailored CVs: ${renderable}/${tailored.rows.length} can be re-rendered on download`
  );
}

console.log("OK — database is readable under libSQL");
