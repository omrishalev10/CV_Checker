import { Link } from "react-router-dom";

export default function HomePage() {
  return (
    <section className="stack">
      <div>
        <h1>Know if a role fits — before you apply.</h1>
        <p className="lede">
          CareerFit builds a structured skill profile from your CV, scores job descriptions against it,
          and generates ATS-friendly tailored CVs without inventing experience.
        </p>
      </div>
      <div className="grid-2">
        <div className="panel stack">
          <h2>Start here</h2>
          <p className="muted">Upload files, add GitHub, review your profile, then check a job.</p>
          <div className="row">
            <Link className="btn btn-primary" to="/profile">
              Build profile
            </Link>
            <Link className="btn btn-ghost" to="/match">
              Check a job
            </Link>
          </div>
        </div>
        <div className="panel stack">
          <h2>How scoring works</h2>
          <p className="muted">
            Fit is scored 0–100: Low (&lt;40), Medium (40–64), High (65–84), Strong (85+). Recommendations
            stay direct — no false encouragement.
          </p>
          <p className="muted">
            Your data lives in your CareerFit database. Add an AI API key under Settings — it never
            leaves the server.
          </p>
        </div>
      </div>
    </section>
  );
}
