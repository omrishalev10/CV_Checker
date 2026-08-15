import fs from "node:fs";

const text = fs.readFileSync("./fixtures/sample-cv.txt", "utf8");
const res = await fetch("http://localhost:3001/api/profile/from-text", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text }),
});
console.log(res.status, await res.text());

const urlRes = await fetch("http://localhost:3001/api/match/url", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: "https://example.invalid/job" }),
});
console.log("url", urlRes.status, await urlRes.text());
