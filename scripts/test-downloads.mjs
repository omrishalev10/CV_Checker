/**
 * Verifies tailored CV documents are generated on request instead of read from disk.
 * Run against a throwaway unlocked server, e.g.:
 *   PORT=3022 DATA_DIR=tmp-dl node server/dist/index.js
 *   node scripts/test-downloads.mjs http://localhost:3022
 */
import { createClient } from "@libsql/client";
import path from "node:path";

const base = process.argv[2] || "http://localhost:3022";
const dataDir = process.argv[3] || "tmp-dl";

let failures = 0;
function check(label, actual, expected) {
  const pass = actual === expected;
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label} (got ${actual}, expected ${expected})`);
}

const client = createClient({
  url: `file:${path.resolve(dataDir, "careerfit.sqlite")}`,
});

const now = new Date().toISOString();
const analysis = await client.execute({
  sql: `INSERT INTO analyses (profile_version, source_type, source_ref, job_title, company, raw_input, analysis_json, created_at)
        VALUES (1, 'text', NULL, 'Download test', 'Test Co', 'job text', ?, ?)`,
  args: [
    JSON.stringify({
      score: 50,
      label: "Medium",
      explanation: "t",
      matched: [],
      gapsHard: [],
      gapsNice: [],
      recommendation: "t",
    }),
    now,
  ],
});
const id = Number(analysis.lastInsertRowid);

const cv = {
  name: "Alex Rivera",
  headline: "Senior Frontend Engineer",
  summary: "React and TypeScript engineer.",
  skills: ["React", "TypeScript"],
  experience: [
    {
      title: "Senior Engineer",
      company: "Northwind Labs",
      dates: "2021–Present",
      bullets: ["Led a team of 4"],
    },
  ],
  education: [{ line: "B.S. Computer Science (2018)" }],
  certifications: ["AWS Certified Developer"],
};

await client.execute({
  sql: `INSERT INTO tailored_cvs (analysis_id, diff_json, created_at, grade_json, cv_json)
        VALUES (?, '{"changes":[],"notAdded":[]}', ?, NULL, ?)
        ON CONFLICT(analysis_id) DO UPDATE SET cv_json = excluded.cv_json`,
  args: [id, now, JSON.stringify(cv)],
});
console.log(`seeded analysis id=${id} with cv_json and no files on disk\n`);

const pdfRes = await fetch(`${base}/api/matches/${id}/cv/pdf`);
const pdf = Buffer.from(await pdfRes.arrayBuffer());
check("pdf request succeeds", pdfRes.status, 200);
check("pdf content type", pdfRes.headers.get("content-type"), "application/pdf");
check("pdf has valid header", pdf.subarray(0, 4).toString(), "%PDF");
check("pdf is non-trivial", pdf.length > 1000, true);

const docxRes = await fetch(`${base}/api/matches/${id}/cv/docx`);
const docx = Buffer.from(await docxRes.arrayBuffer());
check("docx request succeeds", docxRes.status, 200);
check(
  "docx content type",
  docxRes.headers.get("content-type"),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
);
// DOCX is a zip archive, so it must start with the PK signature.
check("docx has zip signature", docx.subarray(0, 2).toString(), "PK");
check("docx is non-trivial", docx.length > 1000, true);

check(
  "attachment filename set",
  (docxRes.headers.get("content-disposition") || "").includes(`CareerFit-tailored-${id}.docx`),
  true
);

// Repeat requests must keep working, proving nothing depends on a cached file.
const again = await fetch(`${base}/api/matches/${id}/cv/pdf`);
check("second pdf request also succeeds", again.status, 200);

// A row without cv_json cannot be re-rendered and should say so clearly.
await client.execute({
  sql: "UPDATE tailored_cvs SET cv_json = NULL WHERE analysis_id = ?",
  args: [id],
});
const legacy = await fetch(`${base}/api/matches/${id}/cv/pdf`);
check("legacy row without content returns 409", legacy.status, 409);

await client.execute({ sql: "DELETE FROM tailored_cvs WHERE analysis_id = ?", args: [id] });
await client.execute({ sql: "DELETE FROM analyses WHERE id = ?", args: [id] });

console.log(failures === 0 ? "\nAll download checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
