export type SkillLevel = "beginner" | "intermediate" | "advanced" | "expert";

export interface Skill {
  name: string;
  category: "technical" | "soft" | "tool" | "other";
  level: SkillLevel;
  years?: number;
}

export interface Experience {
  title: string;
  company: string;
  startDate?: string;
  endDate?: string | null;
  current?: boolean;
  responsibilities: string[];
  technologies?: string[];
}

export interface Education {
  degree: string;
  institution: string;
  year?: string;
  details?: string;
}

export interface Certification {
  name: string;
  issuer?: string;
  year?: string;
}

export interface SkillProfile {
  summary?: string;
  skills: Skill[];
  experience: Experience[];
  education: Education[];
  certifications: Certification[];
  seniority?: string;
  totalYearsExperience?: number;
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
  jobTitle?: string;
  company?: string;
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
  warning?: string;
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

export function scoreToLabel(score: number): FitLabel {
  if (score >= 85) return "Strong";
  if (score >= 65) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

export function emptyProfile(): SkillProfile {
  return {
    skills: [],
    experience: [],
    education: [],
    certifications: [],
    links: [],
    notes: [],
    targetRoles: [],
    learningNow: [],
  };
}
