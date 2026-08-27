export type SkillLevel = "beginner" | "intermediate" | "advanced" | "expert";

export interface Skill {
  name: string;
  category: "technical" | "soft" | "tool" | "other";
  level: SkillLevel;
  years?: number | null;
}

export interface Experience {
  title: string;
  company: string;
  startDate?: string | null;
  endDate?: string | null;
  current?: boolean;
  responsibilities: string[];
  technologies?: string[];
}

export interface Education {
  degree: string;
  institution: string;
  year?: string | null;
  details?: string | null;
}

export interface Certification {
  name: string;
  issuer?: string | null;
  year?: string | null;
}

export interface SkillProfile {
  summary?: string;
  skills: Skill[];
  experience: Experience[];
  education: Education[];
  certifications: Certification[];
  seniority?: string | null;
  totalYearsExperience?: number | null;
  targetRoles?: string[];
  learningNow?: string[];
  links?: { label: string; url: string }[];
  notes?: string[];
  updatedAt?: string;
}

export type FitLabel = "Low" | "Medium" | "High" | "Strong";

export interface MatchAnalysis {
  score: number;
  label: FitLabel;
  explanation: string;
  matched: string[];
  gapsHard: string[];
  gapsNice: string[];
  recommendation: string;
  jobTitle?: string | null;
  company?: string | null;
  extractedText?: string;
}

export interface ProfileDiff {
  added: string[];
  updated: string[];
  removed: string[];
  summary: string;
}

export interface TailorDiff {
  changes: string[];
  notAdded: string[];
  warning?: string | null;
}

export interface TailoredCvGrade {
  score: number;
  label: FitLabel;
  baselineScore: number;
  delta: number;
  explanation: string;
  keywordsCovered: string[];
  keywordsMissing: string[];
  atsIssues: string[];
  unsupportedClaims: string[];
}

export interface MatchSummary {
  id: number;
  profileVersion: number;
  sourceType: string;
  sourceRef: string | null;
  jobTitle: string | null;
  company: string | null;
  score: number;
  label: FitLabel;
  recommendation: string;
  createdAt: string;
  hasTailoredCv: boolean;
  tailoredScore: number | null;
}

export interface AuthStatus {
  enabled: boolean;
  authenticated: boolean;
  username?: string | null;
}

/** Set by AuthGate so an expired session anywhere in the app bounces back to the lock screen. */
let authRequiredHandler: (() => void) | null = null;

export function onAuthRequired(handler: (() => void) | null): void {
  authRequiredHandler = handler;
}

function humanizeClientError(raw: unknown, status: number): string {
  if (raw && typeof raw === "object" && "message" in raw && typeof (raw as { message: unknown }).message === "string") {
    return humanizeClientError((raw as { message: string }).message, status);
  }
  const text = typeof raw === "string" ? raw : raw != null ? JSON.stringify(raw) : `Request failed (${status})`;
  try {
    const parsed = JSON.parse(text) as { error?: { code?: number; message?: string; status?: string }; message?: string; status?: string; code?: number };
    const inner = parsed.error ?? parsed;
    const blob = `${inner.code ?? ""} ${inner.status ?? ""} ${inner.message ?? ""}`;
    if (inner.code === 503 || inner.status === "UNAVAILABLE" || /high demand|overloaded/i.test(blob)) {
      return "The AI model is busy right now. Wait about a minute and try again.";
    }
    if (typeof inner.message === "string" && inner.message.trim()) return inner.message;
  } catch {
    /* not provider JSON */
  }
  if (/high demand|UNAVAILABLE|"code":\s*503/i.test(text)) {
    return "The AI model is busy right now. Wait about a minute and try again.";
  }
  return text;
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.authRequired) authRequiredHandler?.();
  throw new Error(humanizeClientError(data.error ?? data, res.status));
}

async function parseJson(res: Response) {
  await throwIfNotOk(res);
  return res.json();
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (star?.[1]) return decodeURIComponent(star[1]);
  const quoted = header.match(/filename="([^"]+)"/i);
  if (quoted?.[1]) return quoted[1];
  const plain = header.match(/filename=([^;]+)/i);
  return plain?.[1]?.trim() || null;
}

export async function fetchDownload(url: string): Promise<{ blob: Blob; filename: string | null }> {
  const res = await fetch(url, { credentials: "same-origin" });
  await throwIfNotOk(res);
  return {
    blob: await res.blob(),
    filename: filenameFromDisposition(res.headers.get("content-disposition")),
  };
}

export const api = {
  getProfile: () => fetch("/api/profile").then(parseJson),
  saveProfile: (profile: SkillProfile) =>
    fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile }),
    }).then(parseJson),
  profileFromText: (text: string) =>
    fetch("/api/profile/from-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).then(parseJson),
  profileUpload: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch("/api/profile/upload", { method: "POST", body: fd }).then(parseJson);
  },
  supplement: (kind: string, content: string) =>
    fetch("/api/profile/supplement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, content }),
    }).then(parseJson),
  chatPreview: (message: string) =>
    fetch("/api/profile/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    }).then(parseJson),
  chatConfirm: (profile: SkillProfile) =>
    fetch("/api/profile/chat/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile }),
    }).then(parseJson),
  matchText: (text: string) =>
    fetch("/api/match/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).then(parseJson),
  matchUrl: (url: string) =>
    fetch("/api/match/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }).then(parseJson),
  matchImage: (file: File) => {
    const fd = new FormData();
    fd.append("image", file);
    return fetch("/api/match/image", { method: "POST", body: fd }).then(parseJson);
  },
  listMatches: () => fetch("/api/matches").then(parseJson),
  getMatch: (id: number) => fetch(`/api/matches/${id}`).then(parseJson),
  tailor: (id: number) => fetch(`/api/matches/${id}/tailor`, { method: "POST" }).then(parseJson),
  gradeCv: (id: number) => fetch(`/api/matches/${id}/grade`, { method: "POST" }).then(parseJson),
  deleteMatch: (id: number) => fetch(`/api/matches/${id}`, { method: "DELETE" }).then(parseJson),
  getSettings: () => fetch("/api/settings").then(parseJson),
  saveApiKey: (apiKey: string) =>
    fetch("/api/settings/api-key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    }).then(parseJson),
  clearApiKey: () => fetch("/api/settings/api-key", { method: "DELETE" }).then(parseJson),
  authStatus: (): Promise<AuthStatus> => fetch("/api/auth/status").then(parseJson),
  signup: (username: string, password: string): Promise<AuthStatus> =>
    fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).then(parseJson),
  login: (username: string, password: string): Promise<AuthStatus> =>
    fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).then(parseJson),
  logout: (): Promise<AuthStatus> => fetch("/api/auth/logout", { method: "POST" }).then(parseJson),
  setPassword: (password: string, currentPassword?: string): Promise<AuthStatus> =>
    fetch("/api/auth/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, currentPassword, newPassword: password }),
    }).then(parseJson),
  saveGithub: (url: string) =>
    fetch("/api/profile/github", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }).then(parseJson),
  listFiles: () => fetch("/api/profile/files").then(parseJson),
  uploadFile: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch("/api/profile/files", { method: "POST", body: fd }).then(parseJson);
  },
  deleteFile: (id: number) => fetch(`/api/profile/files/${id}`, { method: "DELETE" }).then(parseJson),
  applyFiles: (ids: number[]) =>
    fetch("/api/profile/files/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }).then(parseJson),
};
