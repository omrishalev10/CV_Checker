import { parseJsonLoose } from "../server/src/services/jsonParse.ts";

const trailing = parseJsonLoose<{ score: number; jobTitle: string }>(
  `{"score": 72, "jobTitle": "Backend Engineer"} extra commentary { "oops": true }`
);
if (trailing.score !== 72 || trailing.jobTitle !== "Backend Engineer") {
  throw new Error("failed trailing junk");
}

const fenced = parseJsonLoose<{ a: number }>("```json\n{\"a\": 1}\n```\nnot json");
if (fenced.a !== 1) throw new Error("failed fences");

const nested = parseJsonLoose<{ inner: { x: string } }>(
  '{"inner": {"x": "brace } inside"}} trailing'
);
if (nested.inner.x !== "brace } inside") throw new Error("failed nested/string braces");

const doubled = parseJsonLoose<{ ok: boolean }>('{"ok": true}{"ok": false}');
if (doubled.ok !== true) throw new Error("failed concatenated objects");

console.log("json parse cases passed");
