import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, MatchAnalysis, TailoredCvGrade, TailoredCvVersion } from "../api";
import { downloadFromApi } from "../download";

export default function MatchDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const matchId = Number(id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [analysis, setAnalysis] = useState<MatchAnalysis | null>(null);
  const [meta, setMeta] = useState<{
    profileVersion: number;
    sourceType: string;
    sourceRef: string | null;
    createdAt: string;
  } | null>(null);
  const [tailored, setTailored] = useState<TailoredCvVersion | null>(null);
  const [versions, setVersions] = useState<TailoredCvVersion[]>([]);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function load() {
    const [data, settings] = await Promise.all([
      api.getMatch(matchId),
      api.getSettings().catch(() => null),
    ]);
    setAnalysis(data.analysis);
    setMeta({
      profileVersion: data.profileVersion,
      sourceType: data.sourceType,
      sourceRef: data.sourceRef,
      createdAt: data.createdAt,
    });
    setTailored(data.tailored);
    setVersions(data.versions || (data.tailored ? [data.tailored] : []));
    if (settings?.cvAgent?.name) setAgentName(settings.cvAgent.name);
  }

  useEffect(() => {
    if (!matchId) return;
    load().catch((e) => setError(e.message));
  }, [matchId]);

  async function onTailor() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const data = await api.tailor(matchId);
      if (data.agent?.name) setAgentName(data.agent.name);
      setInfo(
        analysis && analysis.score < 40
          ? "Generated with gaps left honest — low fit roles are not spun to look qualified."
          : "Tailored CV generated."
      );
      if (data.gradeError) {
        setError(`CV saved, but grading failed: ${data.gradeError}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tailor failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteMatch(matchId);
      navigate("/history");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setBusy(false);
    }
  }

  async function onDownload(format: "docx" | "pdf", cvId?: number) {
    const key = cvId ? `${format}-${cvId}` : format;
    setDownloading(key);
    setError(null);
    try {
      const url = cvId
        ? `/api/matches/${matchId}/cvs/${cvId}/${format}`
        : `/api/matches/${matchId}/cv/${format}`;
      await downloadFromApi(url, `CareerFit-tailored-${matchId}${cvId ? `-${cvId}` : ""}.${format}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(null);
    }
  }

  async function onGrade() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await api.gradeCv(matchId);
      await load();
      setInfo("Tailored CV graded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Grading failed");
    } finally {
      setBusy(false);
    }
  }

  if (!analysis) {
    return (
      <section className="stack">
        {error ? <div className="error">{error}</div> : <div className="loading-banner"><span className="spinner" /> Loading…</div>}
      </section>
    );
  }

  return (
    <section className="stack">
      <div className="match-hero">
        <div>
          <Link className="back-link" to="/history">
            ← My jobs
          </Link>
          <h1>
            {analysis.jobTitle || "Job match"}
            {analysis.company ? ` · ${analysis.company}` : ""}
          </h1>
          {meta && (
            <p className="lede">
              {new Date(meta.createdAt).toLocaleString()} · {meta.sourceType}
              {meta.sourceRef ? ` · ${meta.sourceRef}` : ""} · profile v{meta.profileVersion}
            </p>
          )}
        </div>
        <div className="score-mark">
          <div
            className={`score-ring ${analysis.label.toLowerCase()}`}
            style={{ ["--p" as string]: analysis.score }}
          >
            <strong>{analysis.score}</strong>
          </div>
          <span className={`badge ${analysis.label.toLowerCase()}`}>{analysis.label} fit</span>
        </div>
      </div>

      <div className="row spread">
        <p className="verdict">{analysis.recommendation}</p>
        <div className="history-actions">
          {confirmDelete ? (
            <>
              <button className="btn btn-danger" onClick={onDelete} disabled={busy}>
                Confirm remove
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn btn-ghost" onClick={() => setConfirmDelete(true)} disabled={busy}>
              Remove from history
            </button>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {info && <div className="success">{info}</div>}
      {busy && (
        <div className="loading-banner">
          <span className="spinner" />
        Generating and grading tailored CV… (uses your CV writing agent, plus a GitHub lookup if the profile has a link)
        </div>
      )}

      <div className="grid-2">
        <div className="panel stack">
          <p className="kicker">Evidence</p>
          <h2>Why this score</h2>
          <p>{analysis.explanation}</p>
          <h3>Matched</h3>
          <ul className="list">
            {(analysis.matched || []).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
        <div className="panel stack">
          <p className="kicker">Honesty</p>
          <h2>Gaps</h2>
          <h3>Hard requirements missing</h3>
          <ul className="list">
            {(analysis.gapsHard || []).length ? (
              analysis.gapsHard.map((g) => <li key={g}>{g}</li>)
            ) : (
              <li className="muted">None flagged</li>
            )}
          </ul>
          <h3>Nice-to-haves missing</h3>
          <ul className="list">
            {(analysis.gapsNice || []).length ? (
              analysis.gapsNice.map((g) => <li key={g}>{g}</li>)
            ) : (
              <li className="muted">None flagged</li>
            )}
          </ul>
        </div>
      </div>

      <div className="panel stack">
        <p className="kicker">Next move</p>
        <h2>Tailored CV</h2>
        <p className="muted">
          Reorders, expands real strengths, and can add matching public GitHub projects.
          Starts from your main CV when one is set on Profile. Writing follows{" "}
          {agentName ? <strong>{agentName}</strong> : "the CV agent"} in Settings. Gaps stay honest.
        </p>
        <div className="row">
          <button className="btn btn-primary" onClick={onTailor} disabled={busy}>
            {tailored ? "Regenerate tailored CV" : "Generate tailored CV"}
          </button>
          {tailored?.hasDocx && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onDownload("docx")}
              disabled={busy || Boolean(downloading)}
            >
              {downloading === "docx" ? "Preparing DOCX…" : "Download DOCX"}
            </button>
          )}
          {tailored?.hasPdf && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onDownload("pdf")}
              disabled={busy || Boolean(downloading)}
            >
              {downloading === "pdf" ? "Preparing PDF…" : "Download latest PDF"}
            </button>
          )}
          {tailored && !tailored.grade && (
            <button className="btn btn-ghost" onClick={onGrade} disabled={busy}>
              Grade this CV
            </button>
          )}
        </div>
        {versions.length > 0 && (
          <div className="stack">
            <strong>Saved versions</strong>
            <p className="muted" style={{ margin: 0 }}>
              Each generate is kept. Download any PDF without losing the others.
            </p>
            <ul className="version-list">
              {versions.map((v, i) => {
                const n = versions.length - i;
                const latest = i === 0;
                return (
                  <li className={`version-row ${latest ? "is-latest" : ""}`} key={v.id}>
                    <div>
                      <strong>
                        Version {n}
                        {latest ? " · latest" : ""}
                      </strong>
                      <div className="muted">
                        {new Date(v.createdAt).toLocaleString()}
                        {v.grade ? ` · graded ${v.grade.score}` : ""}
                      </div>
                    </div>
                    <div className="row">
                      {v.hasPdf && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => onDownload("pdf", v.id)}
                          disabled={busy || Boolean(downloading)}
                        >
                          {downloading === `pdf-${v.id}` ? "Preparing…" : "PDF"}
                        </button>
                      )}
                      {v.hasDocx && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => onDownload("docx", v.id)}
                          disabled={busy || Boolean(downloading)}
                        >
                          {downloading === `docx-${v.id}` ? "Preparing…" : "DOCX"}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {tailored?.grade && <GradeCard grade={tailored.grade} />}
        {tailored?.diff && (
          <div className="stack">
            {tailored.diff.warning && <div className="error">{tailored.diff.warning}</div>}
            <div>
              <strong>What changed</strong>
              <ul className="list">
                {(tailored.diff.changes || []).map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
            <div>
              <strong>Not added (not in your profile)</strong>
              <ul className="list">
                {(tailored.diff.notAdded || []).length ? (
                  tailored.diff.notAdded.map((c) => <li key={c}>{c}</li>)
                ) : (
                  <li className="muted">Nothing withheld</li>
                )}
              </ul>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function GradeCard({ grade }: { grade: TailoredCvGrade }) {
  const deltaText =
    grade.delta > 0 ? `+${grade.delta}` : grade.delta < 0 ? `${grade.delta}` : "no change";

  return (
    <div className="stack" style={{ borderTop: "1px solid var(--line)", paddingTop: "1rem" }}>
      <div className="row spread">
        <div>
          <h3 style={{ margin: 0 }}>Tailored CV grade</h3>
          <p className="muted" style={{ margin: 0 }}>
            Base profile scored {grade.baselineScore} · tailored CV scores {grade.score} ({deltaText})
          </p>
        </div>
        <div className={`score-ring ${grade.label.toLowerCase()}`} style={{ ["--p" as string]: grade.score }}>
          <strong>{grade.score}</strong>
        </div>
      </div>

      <div className="row">
        <span className={`badge ${grade.label.toLowerCase()}`}>{grade.label}</span>
        {grade.unsupportedClaims.length === 0 ? (
          <span className="badge high">No unsupported claims</span>
        ) : (
          <span className="badge low">{grade.unsupportedClaims.length} unsupported claim(s)</span>
        )}
      </div>

      <p>{grade.explanation}</p>

      {grade.unsupportedClaims.length > 0 && (
        <div className="error">
          <strong>Claims not backed by your profile — remove before sending</strong>
          <ul className="list">
            {grade.unsupportedClaims.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid-2">
        <div>
          <strong>Job keywords covered</strong>
          <div className="chip-row" style={{ marginTop: "0.4rem" }}>
            {grade.keywordsCovered.length ? (
              grade.keywordsCovered.map((k) => (
                <span className="chip" key={k}>
                  {k}
                </span>
              ))
            ) : (
              <span className="muted">None detected</span>
            )}
          </div>
        </div>
        <div>
          <strong>Still missing (genuine gaps)</strong>
          <div className="chip-row" style={{ marginTop: "0.4rem" }}>
            {grade.keywordsMissing.length ? (
              grade.keywordsMissing.map((k) => (
                <span className="chip" key={k}>
                  {k}
                </span>
              ))
            ) : (
              <span className="muted">None</span>
            )}
          </div>
        </div>
      </div>

      {grade.atsIssues.length > 0 && (
        <div>
          <strong>ATS parsing risks</strong>
          <ul className="list">
            {grade.atsIssues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
