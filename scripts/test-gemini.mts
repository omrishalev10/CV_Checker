const settings = await fetch("http://localhost:3001/api/settings").then((r) => r.json());
console.log("settings", settings);

const text = `Jane Doe
Software Engineer with 5 years experience in React, TypeScript, and Node.js.
Worked at Acme Corp as Frontend Engineer (2020-2025).
BSc Computer Science, Tech University.`;

const res = await fetch("http://localhost:3001/api/profile/from-text", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text }),
});
const body = await res.json();
console.log("extract status", res.status);
if (res.ok) {
  console.log("skills", (body.profile?.skills || []).slice(0, 5).map((s: { name: string }) => s.name));
  console.log("summary", body.profile?.summary?.slice(0, 120));
} else {
  console.log("error", body);
}
