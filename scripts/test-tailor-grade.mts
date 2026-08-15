const id = Number(process.argv[2] || 2);

const res = await fetch(`http://localhost:3001/api/matches/${id}/tailor`, { method: "POST" });
const body = await res.json();
console.log("status", res.status);

if (!res.ok) {
  console.log("error", body);
} else {
  console.log("diff.changes:", body.diff?.changes?.slice(0, 3));
  console.log("diff.notAdded:", body.diff?.notAdded?.slice(0, 5));
  console.log("--- grade ---");
  console.log("baseline:", body.grade?.baselineScore, "→ tailored:", body.grade?.score, `(${body.grade?.label})`);
  console.log("delta:", body.grade?.delta);
  console.log("explanation:", body.grade?.explanation);
  console.log("covered:", body.grade?.keywordsCovered);
  console.log("missing:", body.grade?.keywordsMissing);
  console.log("atsIssues:", body.grade?.atsIssues);
  console.log("unsupportedClaims:", body.grade?.unsupportedClaims);
}

const detail = await fetch(`http://localhost:3001/api/matches/${id}`).then((r) => r.json());
console.log("persisted grade score:", detail.tailored?.grade?.score);
