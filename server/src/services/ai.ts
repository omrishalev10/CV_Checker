import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type {
  MatchAnalysis,
  ProfileDiff,
  SkillProfile,
  TailorDiff,
  TailoredCvGrade,
} from "../types.js";
import { scoreToLabel } from "../types.js";
import { resolveCvAgent } from "../agents/cvAgent.js";
import { getModel, getProvider, resolveApiKey } from "../settings.js";
import { fetchGithubEvidence, type GithubEvidence, withGithubLink } from "./github.js";
import {
  humanizeAiError,
  isModelMissingError,
  isRetryableAiError,
  isTimeoutError,
  sleep,
} from "./aiErrors.js";
import { parseJsonLoose } from "./jsonParse.js";

const GEMINI_FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];
const GEMINI_ATTEMPT_MS = 25_000;

function geminiModelChain(): string[] {
  const primary = getModel();
  return [primary, ...GEMINI_FALLBACK_MODELS.filter((model) => model !== primary)];
}

const geminiByKey = new Map<string, GoogleGenAI>();
const anthropicByKey = new Map<string, Anthropic>();

export function resetAiClient(): void {
  geminiByKey.clear();
  anthropicByKey.clear();
}

async function requireKey(): Promise<string> {
  const key = await resolveApiKey();
  if (!key) {
    throw new Error("AI API key is not configured. Add it in Settings.");
  }
  return key;
}

async function getGemini(): Promise<GoogleGenAI> {
  const key = await requireKey();
  let client = geminiByKey.get(key);
  if (!client) {
    client = new GoogleGenAI({ apiKey: key });
    geminiByKey.set(key, client);
  }
  return client;
}

async function getAnthropic(): Promise<Anthropic> {
  const key = await requireKey();
  let client = anthropicByKey.get(key);
  if (!client) {
    client = new Anthropic({ apiKey: key, timeout: GEMINI_ATTEMPT_MS });
    anthropicByKey.set(key, client);
  }
  return client;
}

type TextOrVision =
  | string
  | {
      text: string;
      image?: { mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string };
    };

interface CompleteOptions {
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

function thinkingConfigFor(model: string): { thinkingLevel: ThinkingLevel } | { thinkingBudget: number } | undefined {
  if (/gemini-3/i.test(model)) return { thinkingLevel: ThinkingLevel.MINIMAL };
  if (/gemini-2\.5/i.test(model)) return { thinkingBudget: 0 };
  return undefined;
}

async function completeJsonGemini<T>(
  system: string,
  user: TextOrVision,
  opts: CompleteOptions = {}
): Promise<T> {
  const contents =
    typeof user === "string"
      ? user
      : user.image
        ? [
            { text: user.text },
            { inlineData: { mimeType: user.image.mediaType, data: user.image.data } },
          ]
        : user.text;

  const models = geminiModelChain();
  let lastError: unknown;

  for (const model of models) {
    const retries = 2;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const thinkingConfig = thinkingConfigFor(model);
        console.log(`[ai] ${model} attempt ${attempt + 1}`);
        const response = await (await getGemini()).models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: `${system}\n\nRespond with valid JSON only. No markdown fences, no commentary.`,
            responseMimeType: "application/json",
            temperature: opts.temperature ?? 0.2,
            maxOutputTokens: opts.maxOutputTokens ?? 8192,
            abortSignal: AbortSignal.timeout(opts.timeoutMs ?? GEMINI_ATTEMPT_MS),
            ...(thinkingConfig ? { thinkingConfig } : {}),
          },
        });

        if (response.candidates?.[0]?.finishReason === "MAX_TOKENS") {
          throw new Error(
            "The AI response was cut off before it finished. Try again, or shorten the job description."
          );
        }

        const text = response.text;
        if (!text) throw new Error("AI returned an empty response.");
        return parseJsonLoose<T>(text);
      } catch (err) {
        lastError = err;
        if (isTimeoutError(err)) {
          console.warn(`[ai] ${model} timed out`);
          break;
        }
        if (isModelMissingError(err)) break;
        if (!isRetryableAiError(err)) throw humanizeAiError(err);
        if (attempt === 0) {
          await sleep(400 + Math.floor(Math.random() * 250));
        }
      }
    }
  }

  throw humanizeAiError(lastError);
}

async function completeJsonAnthropic<T>(
  system: string,
  user: TextOrVision,
  opts: CompleteOptions = {}
): Promise<T> {
  const content: Anthropic.MessageCreateParams["messages"][0]["content"] =
    typeof user === "string"
      ? user
      : user.image
        ? [
            { type: "text", text: user.text },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: user.image.mediaType,
                data: user.image.data,
              },
            },
          ]
        : user.text;

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await (await getAnthropic()).messages.create(
        {
          model: getModel(),
          max_tokens: opts.maxOutputTokens ?? 8192,
          temperature: opts.temperature ?? 0.2,
          system: `${system}\n\nRespond with valid JSON only. No markdown fences, no commentary.`,
          messages: [{ role: "user", content }],
        },
        { timeout: opts.timeoutMs ?? GEMINI_ATTEMPT_MS }
      );

      if (response.stop_reason === "max_tokens") {
        throw new Error(
          "The AI response was cut off before it finished. Try again, or shorten the job description."
        );
      }

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (!text) throw new Error("AI returned an empty response.");
      return parseJsonLoose<T>(text);
    } catch (err) {
      lastError = err;
      if (!isRetryableAiError(err) || attempt === 1) throw humanizeAiError(err);
      await sleep(400 + Math.floor(Math.random() * 250));
    }
  }

  throw humanizeAiError(lastError);
}

async function completeJson<T>(
  system: string,
  user: TextOrVision,
  opts: CompleteOptions = {}
): Promise<T> {
  if ((await getProvider()) === "anthropic") return completeJsonAnthropic<T>(system, user, opts);
  return completeJsonGemini<T>(system, user, opts);
}

export async function extractProfileFromCvText(cvText: string): Promise<SkillProfile> {
  return completeJson<SkillProfile>(
    `You extract structured career profiles from CVs.
Return JSON matching:
{
  "summary": string,
  "skills": [{"name": string, "category": "technical"|"soft"|"tool"|"other", "level": "beginner"|"intermediate"|"advanced"|"expert", "years": number|null}],
  "experience": [{"title": string, "company": string, "startDate": string|null, "endDate": string|null, "current": boolean, "responsibilities": string[], "technologies": string[]}],
  "education": [{"degree": string, "institution": string, "year": string|null, "details": string|null}],
  "certifications": [{"name": string, "issuer": string|null, "year": string|null}],
  "seniority": string|null,
  "totalYearsExperience": number|null,
  "targetRoles": [],
  "learningNow": [],
  "links": [{"label": string, "url": string}],
  "notes": []
}
Put GitHub, LinkedIn, portfolio, and similar URLs into links when they appear in the CV.
Infer skill levels conservatively from evidence. Never invent employers, degrees, or certifications not in the text.`,
    `Extract a Skill Profile from this CV:\n\n${cvText.slice(0, 100000)}`
  );
}

export async function mergeProfileUpdate(
  current: SkillProfile,
  addition: { kind: string; content: string }
): Promise<{ profile: SkillProfile; diff: ProfileDiff }> {
  return completeJson<{ profile: SkillProfile; diff: ProfileDiff }>(
    `You maintain a structured Skill Profile for a job-seeker.
Merge new information into the existing profile intelligently:
- Update levels/years when evidence supports it
- Add new skills/experience without duplicating
- Honor removals or preference changes ("no longer interested in X")
- Never invent facts not supported by existing profile or the new info

Return JSON:
{
  "profile": <full updated SkillProfile>,
  "diff": {
    "added": string[],
    "updated": string[],
    "removed": string[],
    "summary": string
  }
}`,
    `Current profile JSON:\n${JSON.stringify(current, null, 2)}\n\nNew info (${addition.kind}):\n${addition.content}`
  );
}

export async function analyzeJobMatch(
  profile: SkillProfile,
  jobText: string,
  meta?: { source?: string }
): Promise<MatchAnalysis> {
  const result = await completeJson<Omit<MatchAnalysis, "label"> & { label?: string }>(
    `You are a candid career advisor comparing a candidate Skill Profile to a job description.
Score overall fit 0-100 based on hard requirements, seniority, and demonstrated experience.
Be honest — do not inflate scores to be encouraging.

Return JSON:
{
  "score": number,
  "explanation": string,
  "matched": string[],
  "gapsHard": string[],
  "gapsNice": string[],
  "recommendation": string,
  "jobTitle": string|null,
  "company": string|null,
  "extractedText": string
}
recommendation should be one short direct verdict like "Strong match, worth applying" / "Stretch role, apply if interested in growth" / "Not a good fit right now".
extractedText should be the cleaned job description text you analyzed.`,
    `Candidate Skill Profile:\n${JSON.stringify(profile, null, 2)}\n\nJob description${meta?.source ? ` (source: ${meta.source})` : ""}:\n${jobText.slice(0, 24000)}`
  );

  const score = Math.max(0, Math.min(100, Math.round(Number(result.score) || 0)));
  return {
    ...result,
    score,
    label: scoreToLabel(score),
    matched: result.matched || [],
    gapsHard: result.gapsHard || [],
    gapsNice: result.gapsNice || [],
  };
}

export async function analyzeJobFromImage(
  profile: SkillProfile,
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
): Promise<MatchAnalysis> {
  const result = await completeJson<Omit<MatchAnalysis, "label"> & { label?: string }>(
    `You are a candid career advisor. Read the job description from the provided screenshot using vision, then compare it to the candidate Skill Profile.
Score overall fit 0-100 honestly.

Return JSON:
{
  "score": number,
  "explanation": string,
  "matched": string[],
  "gapsHard": string[],
  "gapsNice": string[],
  "recommendation": string,
  "jobTitle": string|null,
  "company": string|null,
  "extractedText": string
}
extractedText must contain the full job description text you read from the image.`,
    {
      text: `Candidate Skill Profile:\n${JSON.stringify(profile, null, 2)}\n\nExtract the job description from this screenshot and analyze fit.`,
      image: { mediaType, data: imageBase64 },
    }
  );

  const score = Math.max(0, Math.min(100, Math.round(Number(result.score) || 0)));
  return {
    ...result,
    score,
    label: scoreToLabel(score),
    matched: result.matched || [],
    gapsHard: result.gapsHard || [],
    gapsNice: result.gapsNice || [],
  };
}

export async function gradeTailoredCv(input: {
  profile: SkillProfile;
  cv: unknown;
  jobText: string;
  baselineScore: number;
  github?: GithubEvidence;
}): Promise<TailoredCvGrade> {
  const result = await completeJson<Omit<TailoredCvGrade, "label" | "delta">>(
    `You grade a tailored CV against a specific job description, and audit it for honesty.

Score 0-100 how well this CV presents the candidate for THIS job, judging:
- coverage of the job's hard requirements and keywords a recruiter/ATS would scan for
- whether the most relevant experience appears early and prominently
- whether real strengths were expanded (more concrete bullets, relevant projects) rather than the CV being shrunk to hide gaps
- clarity and ATS-parseability of the structure

Sources of truth: the Skill Profile AND the GitHub evidence payload (public repos actually fetched).
A project on the CV is allowed if it matches a repo in the GitHub evidence. Do NOT treat those as invented.
Any other claim not supported by the Skill Profile or GitHub evidence is a serious defect: list it in unsupportedClaims and lower the score.
Genuine gaps that remain unaddressed are expected and should be reported, not penalized as dishonesty.
Do NOT lower the score for keeping unrelated-but-real experience on the CV — omitting real history is not an improvement.

Return JSON:
{
  "score": number,
  "explanation": string,
  "keywordsCovered": string[],
  "keywordsMissing": string[],
  "atsIssues": string[],
  "unsupportedClaims": string[]
}
explanation: 1-3 sentences, direct, no cheerleading.
keywordsMissing: job keywords absent from the CV because the candidate genuinely lacks them.
atsIssues: structural problems an ATS parser could trip on (empty array if none).`,
    `Skill Profile:\n${JSON.stringify(input.profile, null, 2)}\n\nGitHub evidence:\n${JSON.stringify(input.github ?? { note: "not fetched" }, null, 2)}\n\nTailored CV:\n${JSON.stringify(input.cv, null, 2)}\n\nJob description:\n${input.jobText.slice(0, 24000)}`,
    { temperature: 0, maxOutputTokens: 8192 }
  );

  const score = Math.max(0, Math.min(100, Math.round(Number(result.score) || 0)));
  const baselineScore = Math.max(0, Math.min(100, Math.round(input.baselineScore || 0)));
  return {
    ...result,
    score,
    label: scoreToLabel(score),
    baselineScore,
    delta: score - baselineScore,
    keywordsCovered: result.keywordsCovered || [],
    keywordsMissing: result.keywordsMissing || [],
    atsIssues: result.atsIssues || [],
    unsupportedClaims: result.unsupportedClaims || [],
  };
}

function tailorSystemPrompt(agentName: string, agentInstructions: string): string {
  return `${agentInstructions}

---

# CAREERFIT RUNTIME CONTRACT

You are running inside CareerFit as "${agentName}".
Follow the agent instructions above for job-description intelligence, keyword strategy, evidence classification, headline/summary/bullet quality, ATS structure, the three-person review, and interview defensibility.
Do that analysis internally. Do not emit markdown tables, match-analysis sections, or quality-score grids.

HARD RULES (these win if anything in the agent instructions conflicts):
- NEVER invent experience, skills, employers, degrees, certifications, metrics, or projects.
- You may reorder, re-emphasize, reword, and mirror job-description terminology ONLY when the candidate genuinely has the equivalent skill/experience.
- Prefer single-column, plain sections suitable for ATS parsers.
- Skills may only include skills the candidate actually has. Group them with labeled strings when useful (example: "Languages: C++, C, Python").
- ALWAYS put the candidate's GitHub profile URL in cv.links (https://github.com/<username> from the Skill Profile / GitHub evidence). Do not omit it. Other real profile links (LinkedIn, portfolio) may be included too.
- If a Base CV document is provided, start from that document. Keep its wording, bullets, and section shape unless a change is needed for this job. Skill Profile is the fact-check; do not invent facts that are in neither source.

EXPAND, DO NOT SHRINK:
- Keep EVERY employment role from the Skill Profile. Do not drop older or less-related jobs to make gaps look smaller.
- When the job has requirements the candidate lacks, compensate by going DEEPER on adjacent strengths: more concrete bullets, impact, scale, tools they actually used, and projects that demonstrate transfer.
- Put the most job-relevant roles and bullets first, then the rest of the real history.
- Summary should sell what they DO have for this role. Do not write a summary that mainly apologizes for gaps.
- Skills: include the candidate's real skills; lead with those that map to the job. Do not strip unrelated real skills.

PROJECTS:
- You MAY add a Projects section using GitHub evidence and any projects already in the Skill Profile (notes, experience, links).
- Only include GitHub repos that actually appear in the GitHub evidence payload.
- Prefer repos whose name, description, language, or topics overlap the job. 2–5 is enough; skip empty or unrelated repos.
- Project bullets must be grounded in the repo description/topics/language — no invented production claims.

Return JSON:
{
  "cv": {
    "name": string|null,
    "headline": string,
    "links": [{"label": string, "url": string}],
    "summary": string,
    "skills": string[],
    "experience": [{"title": string, "company": string, "dates": string, "bullets": string[]}],
    "projects": [{"name": string, "url": string|null, "stack": string[], "bullets": string[]}],
    "education": [{"line": string, "details": string|null}],
    "certifications": string[]
  },
  "diff": {
    "changes": string[],
    "notAdded": string[],
    "warning": string|null
  }
}
In diff.changes, put the change log (added, removed, repositioned, reworded) including expansions and which GitHub projects were added.
In diff.notAdded, list job requirements you deliberately did NOT claim because they are absent from the profile and GitHub evidence (the agent's Excluded keywords).
If fit is low, set warning explaining gaps remain and were not fabricated — the CV was expanded on real strengths instead.`;
}

export async function generateTailoredCvContent(
  profile: SkillProfile,
  analysis: MatchAnalysis,
  jobText: string,
  baseCvText?: string | null
): Promise<{
  cv: {
    name?: string;
    headline: string;
    links?: { label: string; url: string }[];
    summary: string;
    skills: string[];
    experience: {
      title: string;
      company: string;
      dates: string;
      bullets: string[];
    }[];
    projects: {
      name: string;
      url?: string | null;
      stack?: string[];
      bullets: string[];
    }[];
    education: { line: string; details?: string }[];
    certifications: string[];
  };
  diff: TailorDiff;
  github: GithubEvidence;
  agent: { name: string; usingDefault: boolean };
}> {
  const github = await fetchGithubEvidence(profile);
  const agent = await resolveCvAgent();

  const generated = await completeJson<{
    cv: {
      name?: string;
      headline: string;
      summary: string;
      skills: string[];
      experience: {
        title: string;
        company: string;
        dates: string;
        bullets: string[];
      }[];
      projects?: {
        name: string;
        url?: string | null;
        stack?: string[];
        bullets: string[];
      }[];
      education: { line: string; details?: string }[];
      certifications: string[];
    };
    diff: TailorDiff;
  }>(
    tailorSystemPrompt(agent.name, agent.instructions),
    `Skill Profile:\n${JSON.stringify(profile, null, 2)}\n\nMatch analysis:\n${JSON.stringify(analysis, null, 2)}\n\nGitHub evidence:\n${JSON.stringify(github, null, 2)}\n\nBase CV document (start from this; empty if none):\n${(baseCvText || "").slice(0, 24000) || "(none — use the Skill Profile only)"}\n\nJob text:\n${jobText.slice(0, 24000)}`,
    { maxOutputTokens: 16384, timeoutMs: 45_000 }
  );

  const projects = Array.isArray(generated.cv.projects) ? generated.cv.projects : [];
  const changes = [...(generated.diff.changes || [])];
  const cv = withGithubLink({ ...generated.cv, projects }, profile);
  if (cv.links?.some((l) => /github\.com/i.test(l.url))) {
    if (!changes.some((c) => c.toLowerCase().includes("github profile"))) {
      changes.push("Included GitHub profile link in the header.");
    }
  }
  if (github.note && !changes.includes(github.note)) {
    changes.push(github.note);
  }

  return {
    cv,
    diff: { ...generated.diff, changes },
    github,
    agent: { name: agent.name, usingDefault: agent.usingDefault },
  };
}
