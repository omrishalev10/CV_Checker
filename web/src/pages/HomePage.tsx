import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, MatchSummary } from "../api";

export default function HomePage() {
  const [ready, setReady] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [hasMainCv, setHasMainCv] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [latest, setLatest] = useState<MatchSummary | null>(null);

  useEffect(() => {
    Promise.all([
      api.getProfile().catch(() => null),
      api.getSettings().catch(() => null),
      api.listMatches().catch(() => null),
    ])
      .then(([profile, settings, history]) => {
        setHasProfile(Boolean(profile?.exists));
        setHasMainCv(Boolean(profile?.mainCv));
        setHasKey(Boolean(settings?.configured));
        setLatest(history?.matches?.[0] || null);
      })
      .finally(() => setReady(true));
  }, []);

  const next = !hasKey
    ? { to: "/settings", label: "Add your AI key", hint: "Needed before CareerFit can score a role." }
    : !hasMainCv
      ? { to: "/profile", label: "Upload your main CV", hint: "This becomes the source for tailored versions." }
      : !hasProfile
        ? { to: "/profile", label: "Build your profile", hint: "Update the skill profile from your CV, then review it." }
        : { to: "/match", label: "Check a job", hint: "Paste a description, screenshot, or URL." };

  return (
    <section className="stack">
      <div>
        <p className="kicker">Private career studio</p>
        <h1>Know if a role fits — before you apply.</h1>
        <p className="lede">
          CareerFit reads your CV, scores jobs against real experience, and writes ATS-ready tailored CVs
          without inventing a thing.
        </p>
      </div>

      <div className="grid-2">
        <div className="panel stack">
          <p className="kicker">Your next step</p>
          {ready ? (
            <>
              <h2>{next.label}</h2>
              <p className="muted">{next.hint}</p>
              <div className="row">
                <Link className="btn btn-primary" to={next.to}>
                  {next.label}
                </Link>
                {hasProfile && hasKey ? (
                  <Link className="btn btn-ghost" to="/history">
                    Open my jobs
                  </Link>
                ) : (
                  <Link className="btn btn-ghost" to="/profile">
                    Review profile
                  </Link>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="skeleton" style={{ width: "60%" }} />
              <div className="skeleton" />
            </>
          )}
        </div>

        <div className="panel stack">
          <p className="kicker">Setup</p>
          <h2>Three moves, then you&apos;re in.</h2>
          <ol className="journey">
            <li className={hasKey ? "done" : "current"}>
              <span className="step-index">{hasKey ? "✓" : "1"}</span>
              <div>
                <strong>AI key</strong>
                <div className="muted">{hasKey ? "Saved to this account" : "Add a Gemini or Anthropic key"}</div>
              </div>
              <Link to="/settings">{hasKey ? "Edit" : "Add"}</Link>
            </li>
            <li className={hasMainCv ? "done" : hasKey ? "current" : ""}>
              <span className="step-index">{hasMainCv ? "✓" : "2"}</span>
              <div>
                <strong>Main CV</strong>
                <div className="muted">{hasMainCv ? "Ready as the source file" : "Upload PDF, DOCX, or TXT"}</div>
              </div>
              <Link to="/profile">{hasMainCv ? "Open" : "Upload"}</Link>
            </li>
            <li className={hasProfile && hasMainCv ? "done" : hasMainCv ? "current" : ""}>
              <span className="step-index">{hasProfile ? "✓" : "3"}</span>
              <div>
                <strong>Check a role</strong>
                <div className="muted">Honest 0–100 fit. No false encouragement.</div>
              </div>
              <Link to="/match">Check</Link>
            </li>
          </ol>
        </div>
      </div>

      {latest && (
        <Link to={`/history/${latest.id}`} className="panel row spread" style={{ textDecoration: "none", color: "inherit" }}>
          <div>
            <p className="kicker">Latest check</p>
            <h2 style={{ margin: 0 }}>
              {latest.jobTitle || "Untitled role"}
              {latest.company ? ` · ${latest.company}` : ""}
            </h2>
            <p className="muted" style={{ margin: "0.35rem 0 0" }}>
              {latest.recommendation}
            </p>
          </div>
          <span className={`badge ${latest.label.toLowerCase()}`}>
            {latest.score} · {latest.label}
          </span>
        </Link>
      )}
    </section>
  );
}
