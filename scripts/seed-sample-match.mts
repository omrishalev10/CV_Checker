import { initDb, insertAnalysis, getProfile, saveProfile } from "../server/src/db.ts";
import path from "node:path";
import { scoreToLabel } from "../server/src/types.ts";

initDb(path.resolve("./data"));
const current = getProfile() || saveProfile({
  summary: "Sample",
  skills: [{ name: "React", category: "technical", level: "advanced", years: 5 }],
  experience: [],
  education: [],
  certifications: [],
}, false);

const score = 78;
const row = insertAnalysis({
  profileVersion: current.version,
  sourceType: "text",
  analysis: {
    score,
    label: scoreToLabel(score),
    explanation: "Strong overlap on React/TypeScript and leadership signals.",
    matched: ["React", "TypeScript", "Team leadership"],
    gapsHard: ["GraphQL production experience"],
    gapsNice: ["Kubernetes"],
    recommendation: "Strong match, worth applying",
    jobTitle: "Senior Frontend Engineer",
    company: "Acme Corp",
    extractedText: "Sample job text",
  },
  rawInput: "Sample job text for fixture analysis",
});

console.log("seeded analysis id", row.id);
