import { fetchGithubEvidence } from "../server/src/services/github.ts";
import type { SkillProfile } from "../server/src/types.ts";

const profile: SkillProfile = {
  skills: [],
  experience: [],
  education: [],
  certifications: [],
  links: [{ label: "gh", url: "https://github.com/octocat" }],
};

const evidence = await fetchGithubEvidence(profile);
console.log("username:", evidence.username);
console.log("note:", evidence.note);
console.log("repos:", evidence.projects.length);
console.log(
  "sample:",
  evidence.projects.slice(0, 3).map((p) => `${p.name}${p.language ? ` (${p.language})` : ""}`)
);
if (!evidence.username || evidence.projects.length === 0) {
  console.error("FAIL: expected public repos for octocat");
  process.exit(1);
}
console.log("PASS live GitHub fetch");
