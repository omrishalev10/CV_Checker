import type { SkillProfile } from "../types.js";

export interface GithubProject {
  name: string;
  url: string;
  description: string | null;
  language: string | null;
  topics: string[];
  stars: number;
  updatedAt: string;
  homepage: string | null;
}

export interface GithubEvidence {
  username: string | null;
  projects: GithubProject[];
  note: string;
}

interface GithubRepoJson {
  name?: string;
  html_url?: string;
  description?: string | null;
  language?: string | null;
  topics?: string[];
  stargazers_count?: number;
  updated_at?: string;
  homepage?: string | null;
  fork?: boolean;
  private?: boolean;
}

const RESERVED = new Set([
  "topics",
  "orgs",
  "settings",
  "features",
  "about",
  "login",
  "marketplace",
  "pricing",
  "explore",
  "notifications",
  "pulls",
  "issues",
  "search",
  "new",
  "apps",
  "collections",
  "events",
  "sponsors",
  "customer-stories",
  "readme",
]);

/** Pull a GitHub username from a URL, label, or free text. */
export function parseGithubUsername(text: string): string | null {
  if (!text) return null;
  const match = text.match(
    /(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})(?:\/|$|\?|#|\s)/i
  );
  if (!match) return null;
  const username = match[1];
  if (RESERVED.has(username.toLowerCase())) return null;
  return username;
}

export function githubUsernameFromProfile(profile: SkillProfile): string | null {
  const blobs: string[] = [];
  for (const link of profile.links || []) {
    if (link.url) blobs.push(link.url);
    if (link.label) blobs.push(link.label);
  }
  if (profile.summary) blobs.push(profile.summary);
  for (const note of profile.notes || []) blobs.push(note);

  for (const blob of blobs) {
    const username = parseGithubUsername(blob);
    if (username) return username;
  }
  return null;
}

export function githubUrlFromProfile(profile: SkillProfile): string {
  for (const link of profile.links || []) {
    if (link.url && parseGithubUsername(link.url)) return link.url;
  }
  const username = githubUsernameFromProfile(profile);
  return username ? `https://github.com/${username}` : "";
}

/** Upsert or remove the GitHub link without touching other profile links. */
export function withGithubUrl(profile: SkillProfile, url: string): SkillProfile {
  const trimmed = url.trim();
  const links = [...(profile.links || [])];
  const idx = links.findIndex(
    (link) => parseGithubUsername(link.url || "") || /github/i.test(link.label || "")
  );

  if (!trimmed) {
    if (idx >= 0) links.splice(idx, 1);
    return { ...profile, links };
  }

  const parsed = parseGithubUsername(trimmed);
  const normalized = parsed
    ? trimmed.startsWith("http")
      ? trimmed.split(/[?#]/)[0].replace(/\/+$/, "")
      : `https://github.com/${parsed}`
    : `https://github.com/${trimmed.replace(/^@/, "").replace(/^https?:\/\/[^/]+\//, "").split("/")[0]}`;
  const entry = { label: "GitHub", url: normalized };

  if (idx >= 0) links[idx] = entry;
  else links.push(entry);
  return { ...profile, links };
}

async function githubGet(path: string): Promise<{ ok: boolean; status: number; json: unknown }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "CareerFit",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = (process.env.GITHUB_TOKEN || "").trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com${path}`, {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

/**
 * Public GitHub REST only — never scrapes github.com HTML.
 * Failures are non-fatal: tailor still runs from the Skill Profile alone.
 */
export async function fetchGithubEvidence(profile: SkillProfile): Promise<GithubEvidence> {
  const username = githubUsernameFromProfile(profile);
  if (!username) {
    return {
      username: null,
      projects: [],
      note: "No GitHub link in the profile. Add one under links (e.g. https://github.com/your-user) to include public repos.",
    };
  }

  try {
    const result = await githubGet(
      `/users/${encodeURIComponent(username)}/repos?per_page=100&sort=updated&type=owner`
    );
    if (!result.ok) {
      const reason =
        result.status === 404
          ? `GitHub user "${username}" was not found.`
          : result.status === 403
            ? "GitHub rate limit hit. Set GITHUB_TOKEN to raise it, or try again later."
            : `GitHub returned HTTP ${result.status}.`;
      return { username, projects: [], note: reason };
    }

    const rows = Array.isArray(result.json) ? (result.json as GithubRepoJson[]) : [];
    const projects: GithubProject[] = rows
      .filter((row) => row && typeof row === "object" && !row.fork && !row.private)
      .map((row) => ({
        name: String(row.name || ""),
        url: String(row.html_url || `https://github.com/${username}/${row.name}`),
        description: row.description ? String(row.description) : null,
        language: row.language ? String(row.language) : null,
        topics: Array.isArray(row.topics) ? row.topics.map(String) : [],
        stars: Number(row.stargazers_count) || 0,
        updatedAt: String(row.updated_at || ""),
        homepage: row.homepage ? String(row.homepage) : null,
      }))
      .filter((p) => p.name && p.name !== ".github")
      .slice(0, 40);

    return {
      username,
      projects,
      note: projects.length
        ? `Loaded ${projects.length} public non-fork repos for ${username}.`
        : `GitHub user "${username}" has no public non-fork repos to draw from.`,
    };
  } catch (err) {
    return {
      username,
      projects: [],
      note: `GitHub lookup failed: ${err instanceof Error ? err.message : "network error"}`,
    };
  }
}
