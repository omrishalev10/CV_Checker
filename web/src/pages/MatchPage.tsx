import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import FileDrop from "../components/FileDrop";

type Mode = "text" | "image" | "url";

export default function MatchPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<number>) {
    setBusy(true);
    setError(null);
    try {
      const id = await fn();
      navigate(`/history/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Match failed");
    } finally {
      setBusy(false);
    }
  }

  async function onText(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const data = await api.matchText(text);
      return data.id as number;
    });
  }

  async function onUrl(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const data = await api.matchUrl(url);
      return data.id as number;
    });
  }

  async function onImage(file: File | null) {
    if (!file) return;
    await run(async () => {
      const data = await api.matchImage(file);
      return data.id as number;
    });
  }

  return (
    <section className="stack">
      <div>
        <p className="kicker">Fit check</p>
        <h1>Check a job</h1>
        <p className="lede">
          Paste text, drop a screenshot, or give a URL. CareerFit scores fit against your current skill
          profile — honestly.
        </p>
      </div>

      <div className="tabs">
        {(
          [
            ["text", "Paste text"],
            ["image", "Screenshot"],
            ["url", "URL"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={`tab ${mode === id ? "active" : ""}`} onClick={() => setMode(id)}>
            {label}
          </button>
        ))}
      </div>

      {busy && (
        <div className="loading-banner">
          <span className="spinner" />
          Analyzing with AI — usually 10–30 seconds.
        </div>
      )}
      {error && <div className="error">{error}</div>}

      {mode === "text" && (
        <form className="panel stack" onSubmit={onText}>
          <label className="field">
            Job description
            <textarea value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
          </label>
          <button className="btn btn-primary" disabled={busy || text.trim().length < 40}>
            Analyze fit
          </button>
        </form>
      )}

      {mode === "image" && (
        <div className="panel stack">
          <FileDrop
            accept="image/jpeg,image/png,image/gif,image/webp"
            capture
            disabled={busy}
            label="Drop a screenshot, or take one"
            hint="JPEG, PNG, GIF, or WebP — camera and gallery both work"
            onFile={(file) => onImage(file)}
          />
        </div>
      )}

      {mode === "url" && (
        <form className="panel stack" onSubmit={onUrl}>
          <label className="field">
            Job posting URL
            <input
              type="url"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
            />
          </label>
          <p className="muted">
            If the page is paywalled or JS-rendered, you'll get a clear error and can paste the text instead.
          </p>
          <button className="btn btn-primary" disabled={busy || !url.trim()}>
            Fetch &amp; analyze
          </button>
        </form>
      )}
    </section>
  );
}
