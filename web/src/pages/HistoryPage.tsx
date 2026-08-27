import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, MatchSummary } from "../api";
import { downloadFromApi } from "../download";

function fitClass(score: number, label?: string | null): string {
  if (label) return label.toLowerCase();
  if (score >= 85) return "strong";
  if (score >= 65) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export default function HistoryPage() {
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  function load() {
    api
      .listMatches()
      .then((data) => setMatches(data.matches || []))
      .catch((e) => setError(e.message));
  }

  useEffect(load, []);

  async function onPdf(m: MatchSummary) {
    setDownloadingId(m.id);
    setError(null);
    try {
      await downloadFromApi(`/api/matches/${m.id}/cv/pdf`, `CareerFit-tailored-${m.id}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloadingId(null);
    }
  }

  async function onDelete(m: MatchSummary) {
    setDeletingId(m.id);
    setError(null);
    setInfo(null);
    try {
      await api.deleteMatch(m.id);
      setMatches((prev) => prev.filter((x) => x.id !== m.id));
      setInfo(`Removed "${m.jobTitle || "Untitled role"}" and any tailored CV files.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  }

  return (
    <section className="stack">
      <div>
        <p className="kicker">History</p>
        <h1>My jobs</h1>
        <p className="lede">Jobs you already checked, with scores and any tailored CVs.</p>
      </div>
      {error && <div className="error">{error}</div>}
      {info && <div className="success">{info}</div>}
      <div className="panel">
        {matches.length === 0 ? (
          <div className="empty-state stack">
            <p className="kicker">Nothing here yet</p>
            <h2>Check a role to start a history.</h2>
            <p className="muted">
              Scores, gaps, and tailored CVs will live here so you can compare without hunting through files.
            </p>
            <div className="row" style={{ justifyContent: "center" }}>
              <Link className="btn btn-primary" to="/match">
                Check a job
              </Link>
            </div>
          </div>
        ) : (
          matches.map((m) => (
            <div className="history-row" key={m.id}>
              <Link to={`/history/${m.id}`} className="history-item">
                <div className="row spread">
                  <strong className="title">
                    {m.jobTitle || "Untitled role"}
                    {m.company ? ` · ${m.company}` : ""}
                  </strong>
                  <span className={`badge ${m.label.toLowerCase()}`}>
                    {m.score} · {m.label}
                  </span>
                </div>
                <div className="muted">
                  {new Date(m.createdAt).toLocaleString()} · {m.sourceType}
                  {m.hasTailoredCv
                    ? m.tailoredScore !== null
                      ? ` · ${m.tailoredCvCount || 1} tailored CV${(m.tailoredCvCount || 1) === 1 ? "" : "s"} · graded ${m.tailoredScore}`
                      : ` · ${m.tailoredCvCount || 1} tailored CV${(m.tailoredCvCount || 1) === 1 ? "" : "s"} ready`
                    : ""}
                </div>
                <div>{m.recommendation}</div>
              </Link>
              <div className="history-actions">
                {m.hasTailoredCv && confirmId !== m.id && (
                  <div className="history-pdf">
                    {m.tailoredScore !== null && (
                      <span
                        className={`badge ${fitClass(m.tailoredScore, m.tailoredLabel)}`}
                        title="Latest tailored CV fit"
                      >
                        {m.tailoredScore}
                      </span>
                    )}
                    <button
                      className="btn btn-ghost"
                      onClick={() => onPdf(m)}
                      disabled={downloadingId === m.id || deletingId === m.id}
                      aria-label={`Download latest tailored PDF for ${m.jobTitle || "this job"}`}
                    >
                      {downloadingId === m.id
                        ? "Preparing…"
                        : (m.tailoredCvCount || 1) > 1
                          ? `PDF · ${m.tailoredCvCount}`
                          : "PDF"}
                    </button>
                  </div>
                )}
                {confirmId === m.id ? (
                  <>
                    <button
                      className="btn btn-danger"
                      onClick={() => onDelete(m)}
                      disabled={deletingId === m.id}
                    >
                      {deletingId === m.id ? "Removing…" : "Confirm"}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => setConfirmId(null)}
                      disabled={deletingId === m.id}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-ghost"
                    onClick={() => setConfirmId(m.id)}
                    aria-label={`Remove ${m.jobTitle || "match"} from history`}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
