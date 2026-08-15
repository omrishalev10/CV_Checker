import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export type UrlFetchResult =
  | { ok: true; title: string | null; text: string; url: string }
  | { ok: false; error: string; url: string };

export async function fetchJobUrl(rawUrl: string): Promise<UrlFetchResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      return { ok: false, error: "Only http/https URLs are supported.", url: rawUrl };
    }
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL.", url: rawUrl };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; CareerFit/1.0; +https://localhost) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return {
        ok: false,
        error: `Could not fetch the page (HTTP ${res.status}). It may be paywalled or blocked — paste the job text instead.`,
        url: url.toString(),
      };
    }

    const html = await res.text();
    if (!html || html.length < 50) {
      return {
        ok: false,
        error: "The page returned almost no content. It may be JavaScript-rendered — paste the job text instead.",
        url: url.toString(),
      };
    }

    const dom = new JSDOM(html, { url: url.toString() });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    const text = (article?.textContent || dom.window.document.body?.textContent || "").replace(/\s+\n/g, "\n").trim();

    if (text.length < 120) {
      return {
        ok: false,
        error:
          "Couldn't extract a readable job description from this URL (possible paywall or JS-only page). Paste the text instead.",
        url: url.toString(),
      };
    }

    return {
      ok: true,
      title: article?.title || dom.window.document.title || null,
      text: text.slice(0, 100000),
      url: url.toString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown fetch error";
    return {
      ok: false,
      error: `Failed to fetch URL (${message}). Paste the job text instead.`,
      url: url.toString(),
    };
  }
}
