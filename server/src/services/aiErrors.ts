import { extractFirstJsonObject } from "./jsonParse.js";

interface ProviderError {
  code?: number;
  status?: string;
  message: string;
}

function rawErrorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function fromGooglePayload(payload: Record<string, unknown>): ProviderError | null {
  const inner = asRecord(payload.error) ?? payload;
  const message = inner.message;
  if (typeof message !== "string" && inner.code == null && inner.status == null) return null;
  return {
    code: typeof inner.code === "number" ? inner.code : Number(inner.code) || undefined,
    status: typeof inner.status === "string" ? inner.status : undefined,
    message: typeof message === "string" ? message : rawErrorText(payload),
  };
}

export function parseProviderError(err: unknown): ProviderError {
  const raw = rawErrorText(err);
  const object = extractFirstJsonObject(raw);
  if (object) {
    try {
      const parsed = fromGooglePayload(JSON.parse(object) as Record<string, unknown>);
      if (parsed) return parsed;
    } catch {
      /* not JSON after all */
    }
  }
  const statusMatch = raw.match(/\b(429|503|500|404)\b/);
  return {
    code: statusMatch ? Number(statusMatch[1]) : undefined,
    message: raw,
  };
}

export function isTimeoutError(err: unknown): boolean {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  const msg = rawErrorText(err);
  return name === "AbortError" || name === "TimeoutError" || /aborted|timed out|timeout/i.test(msg);
}

export function isRetryableAiError(err: unknown): boolean {
  const info = parseProviderError(err);
  const blob = `${info.code ?? ""} ${info.status ?? ""} ${info.message}`.toUpperCase();
  return (
    info.code === 429 ||
    info.code === 503 ||
    info.status === "UNAVAILABLE" ||
    info.status === "RESOURCE_EXHAUSTED" ||
    blob.includes("UNAVAILABLE") ||
    blob.includes("HIGH DEMAND") ||
    blob.includes("OVERLOADED") ||
    blob.includes("RESOURCE_EXHAUSTED") ||
    blob.includes("RATE LIMIT")
  );
}

export function isModelMissingError(err: unknown): boolean {
  const info = parseProviderError(err);
  const blob = `${info.code ?? ""} ${info.status ?? ""} ${info.message}`.toUpperCase();
  return info.code === 404 || info.status === "NOT_FOUND" || blob.includes("NOT FOUND") || blob.includes("NOT SUPPORTED");
}

export function humanizeAiError(err: unknown): Error {
  const info = parseProviderError(err);
  const blob = `${info.code ?? ""} ${info.status ?? ""} ${info.message}`;
  if (isTimeoutError(err) || /timed out/i.test(blob)) {
    return new Error("The AI model took too long. Try again, or paste a shorter job description.");
  }
  if (info.code === 503 || info.status === "UNAVAILABLE" || /high demand|overloaded/i.test(blob)) {
    return new Error("The AI model is busy right now. Wait about a minute and try again.");
  }
  if (info.code === 429 || info.status === "RESOURCE_EXHAUSTED" || /rate limit|resource exhausted/i.test(blob)) {
    return new Error("The AI service hit a rate limit. Wait a moment and try again.");
  }
  if (info.code === 401 || info.code === 403 || /api key|permission|unauthenticated/i.test(blob)) {
    return new Error("The AI API key was rejected. Check it in Settings.");
  }
  if (info.message.startsWith("{") || info.message.includes('"status"')) {
    return new Error(info.message.length < 180 ? info.message : "The AI service returned an error. Try again in a moment.");
  }
  return err instanceof Error ? err : new Error(info.message);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
