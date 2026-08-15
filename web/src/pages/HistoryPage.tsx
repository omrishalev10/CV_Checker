import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, MatchSummary } from "../api";

export default function HistoryPage() {
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function load() {
    api
      .listMatches()
      .then((data) => setMatches(data.matches || []))
      .catch((e) => setError(e.message));
  }

  useEffect(load, []);

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
        <h1>Match history</h1>
        <p className="lede">Revisit past analyses and any tailored CVs linked to them.</p>
      </div>
      {error && <div className="error">{error}</div>}
      {info && <div className="success">{info}</div>}
      <div className="panel">
        {matches.length === 0 ? (
          <p className="muted">No matches yet. Analyze a job to see it here.</p>
        ) : (
          matches.map((m) => (
            <div className="history-row" key={m.id}>
              <Link to={`/history/${m.id}`} className="history-item">
                <div className="row" style={{ justifyContent: "space-between" }}>
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
                      ? ` · tailored CV graded ${m.tailoredScore}`
                      : " · tailored CV ready"
                    : ""}
                </div>
                <div>{m.recommendation}</div>
              </Link>
              <div className="history-actions">
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
