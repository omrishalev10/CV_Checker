import path from "node:path";
import { initDb, saveTailoredCv } from "../server/src/db.ts";

await initDb(path.resolve("./data"));
const cv = {
  name: "Alex Rivera",
  headline: "Senior Frontend Engineer",
  summary: "React and TypeScript engineer with team leadership experience.",
  skills: ["React", "TypeScript", "Node.js", "team leadership"],
  experience: [
    {
      title: "Senior Software Engineer",
      company: "Northwind Labs",
      dates: "2021–Present",
      bullets: ["Led a team of 4 engineers delivering a React customer portal"],
    },
  ],
  education: [{ line: "B.S. Computer Science — State University (2018)" }],
  certifications: ["AWS Certified Developer – Associate (2023)"],
};

// Documents are rendered on download from cv_json, so only the content is stored.
await saveTailoredCv({
  analysisId: 1,
  diff: {
    changes: ["Moved React leadership experience higher", "Mirrored 'team leadership' terminology"],
    notAdded: ["GraphQL", "Kubernetes"],
    warning: null,
  },
  cv,
});
console.log("tailored cv seeded");
