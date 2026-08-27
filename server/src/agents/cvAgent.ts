import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tryCurrentUserId } from "../context.js";
import { deleteUserSetting, getUserSetting, setUserSetting } from "../settings.js";

export const DEFAULT_CV_AGENT_NAME = "Elite HR, Recruiter & ATS Resume Strategist";

export const CV_AGENT_NAME_KEY = "cv_agent_name";
export const CV_AGENT_INSTRUCTIONS_KEY = "cv_agent_instructions";

const MAX_INSTRUCTIONS_CHARS = 80_000;
const MAX_NAME_CHARS = 120;

let cachedDefaultInstructions: string | null = null;

export type CvAgent = {
  name: string;
  instructions: string;
  usingDefault: boolean;
  defaultName: string;
};

export function defaultCvAgentInstructions(): string {
  if (cachedDefaultInstructions) return cachedDefaultInstructions;
  const here = dirname(fileURLToPath(import.meta.url));
  cachedDefaultInstructions = readFileSync(join(here, "elite-hr-resume.md"), "utf8");
  return cachedDefaultInstructions;
}

export async function resolveCvAgent(): Promise<CvAgent> {
  const userId = tryCurrentUserId();
  const fallback: CvAgent = {
    name: DEFAULT_CV_AGENT_NAME,
    instructions: defaultCvAgentInstructions(),
    usingDefault: true,
    defaultName: DEFAULT_CV_AGENT_NAME,
  };
  if (!userId) return fallback;

  const customInstructions = (await getUserSetting(userId, CV_AGENT_INSTRUCTIONS_KEY))?.trim() || "";
  if (!customInstructions) return fallback;

  const customName = (await getUserSetting(userId, CV_AGENT_NAME_KEY))?.trim() || "Custom CV agent";
  return {
    name: customName.slice(0, MAX_NAME_CHARS),
    instructions: customInstructions,
    usingDefault: false,
    defaultName: DEFAULT_CV_AGENT_NAME,
  };
}

export async function saveCvAgent(name: string, instructions: string): Promise<CvAgent> {
  const userId = tryCurrentUserId();
  if (!userId) throw new Error("Not signed in.");

  const trimmedName = name.trim().slice(0, MAX_NAME_CHARS) || DEFAULT_CV_AGENT_NAME;
  const trimmed = instructions.trim();
  if (!trimmed) {
    return resetCvAgent();
  }
  if (trimmed.length > MAX_INSTRUCTIONS_CHARS) {
    throw new Error(`Agent instructions are too long (max ${MAX_INSTRUCTIONS_CHARS.toLocaleString()} characters).`);
  }

  await setUserSetting(userId, CV_AGENT_NAME_KEY, trimmedName);
  await setUserSetting(userId, CV_AGENT_INSTRUCTIONS_KEY, trimmed);
  return resolveCvAgent();
}

export async function resetCvAgent(): Promise<CvAgent> {
  const userId = tryCurrentUserId();
  if (!userId) throw new Error("Not signed in.");
  await deleteUserSetting(userId, CV_AGENT_NAME_KEY);
  await deleteUserSetting(userId, CV_AGENT_INSTRUCTIONS_KEY);
  return resolveCvAgent();
}
