import {
  parseGithubUsername,
  githubUsernameFromProfile,
  githubUrlFromProfile,
  githubProfileUrl,
  withGithubUrl,
  withGithubLink,
} from "../server/src/services/github.ts";
import type { SkillProfile } from "../server/src/types.ts";

const empty: SkillProfile = {
  skills: [],
  experience: [],
  education: [],
  certifications: [],
};

let failures = 0;
function check(label, actual, expected) {
  const pass = actual === expected;
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

check("https url", parseGithubUsername("https://github.com/octocat"), "octocat");
check("http www", parseGithubUsername("http://www.github.com/octocat/hello-world"), "octocat");
check("bare host", parseGithubUsername("github.com/octocat"), "octocat");
check("with query", parseGithubUsername("https://github.com/octocat?tab=repositories"), "octocat");
check("reserved path", parseGithubUsername("https://github.com/topics/javascript"), null);
check("empty", parseGithubUsername(""), null);
check("unrelated", parseGithubUsername("https://linkedin.com/in/octocat"), null);

check(
  "from profile links",
  githubUsernameFromProfile({
    ...empty,
    links: [{ label: "Code", url: "https://github.com/torvalds" }],
  }),
  "torvalds"
);

check(
  "withGithubUrl sets link",
  githubUrlFromProfile(withGithubUrl(empty, "https://github.com/octocat")),
  "https://github.com/octocat"
);

check(
  "no github link",
  githubUsernameFromProfile({
    ...empty,
    links: [{ label: "Site", url: "https://example.com" }],
  }),
  null
);

check(
  "profile url ignores repo path",
  githubProfileUrl({
    ...empty,
    links: [{ label: "GitHub", url: "https://github.com/omrishalev10/CV_Checker" }],
  }),
  "https://github.com/omrishalev10"
);

const stamped = withGithubLink(
  { headline: "Engineer", links: [{ label: "LinkedIn", url: "https://linkedin.com/in/x" }] },
  { ...empty, links: [{ label: "GitHub", url: "https://github.com/omrishalev10" }] }
);
check("stamps github first", stamped.links[0].url, "https://github.com/omrishalev10");
check("keeps other links", stamped.links[1].url, "https://linkedin.com/in/x");

const twice = withGithubLink(stamped, {
  ...empty,
  links: [{ label: "GitHub", url: "https://github.com/omrishalev10" }],
});
check("does not duplicate", twice.links.length, 2);

console.log(failures === 0 ? "\nAll GitHub parse checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
