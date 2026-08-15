import { FormEvent, useEffect, useState } from "react";
import { api, ProfileDiff, Skill, SkillProfile } from "../api";

function githubUrlFromProfile(profile: SkillProfile | null): string {
  if (!profile?.links) return "";
  const hit = profile.links.find(
    (l) => /github\.com/i.test(l.url || "") || /github/i.test(l.label || "")
  );
  return hit?.url || "";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

interface ProfileFile {
  id: number;
  filename: string;
  mime: string | null;
  size: number;
  createdAt: string;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<SkillProfile | null>(null);
  const [version, setVersion] = useState(0);
  const [exists, setExists] = useState(false);
  const [github, setGithub] = useState("");
  const [summary, setSummary] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [files, setFiles] = useState<ProfileFile[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [showEdit, setShowEdit] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [editJson, setEditJson] = useState("");
  const [paste, setPaste] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatPreview, setChatPreview] = useState<{ preview: SkillProfile; diff: ProfileDiff } | null>(
    null
  );
  const [lastDiff, setLastDiff] = useState<ProfileDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function refresh() {
    const data = await api.getProfile();
    setProfile(data.profile);
    setVersion(data.version);
    setExists(Boolean(data.exists));
    setGithub(githubUrlFromProfile(data.profile));
    setSummary(data.profile?.summary || "");
    setSkills(data.profile?.skills || []);
    setEditJson(JSON.stringify(data.profile, null, 2));
    const listed = await api.listFiles();
    setFiles(listed.files || []);
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveGithub(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await api.saveGithub(github.trim());
      await refresh();
      setOk(github.trim() ? "GitHub link saved." : "GitHub link removed.");
    });
  }

  async function onSaveSummary(e: FormEvent) {
    e.preventDefault();
    if (!profile) return;
    await run(async () => {
      await api.saveProfile({ ...profile, summary });
      await refresh();
      setOk("Summary saved.");
    });
  }

  async function onSaveSkills(e: FormEvent) {
    e.preventDefault();
    if (!profile) return;
    await run(async () => {
      await api.saveProfile({ ...profile, skills: skills.filter((s) => s.name.trim()) });
      await refresh();
      setOk("Skills saved.");
    });
  }

  async function onUploadFile(file: File | null) {
    if (!file) return;
    await run(async () => {
      await api.uploadFile(file);
      await refresh();
      setOk(`Saved “${file.name}” to your files.`);
    });
  }

  async function onDeleteFile(id: number) {
    await run(async () => {
      await api.deleteFile(id);
      setSelected((prev) => prev.filter((x) => x !== id));
      await refresh();
      setOk("File removed.");
    });
  }

  async function onApplySelected() {
    await run(async () => {
      const data = await api.applyFiles(selected);
      setLastDiff({
        added: [],
        updated: [],
        removed: [],
        summary: (data.diffs || [])
          .map((d: { filename: string; summary: string }) => `${d.filename}: ${d.summary}`)
          .join(" "),
      });
      setSelected([]);
      await refresh();
      setOk(
        `Updated profile from ${data.diffs?.length || selected.length} file${
          (data.diffs?.length || selected.length) === 1 ? "" : "s"
        }.`
      );
    });
  }

  function toggleFile(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function onPaste(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await api.profileFromText(paste);
      await refresh();
      setPaste("");
      setOk("Profile extracted from pasted text.");
    });
  }

  async function onSaveJson(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const parsed = JSON.parse(editJson) as SkillProfile;
      await api.saveProfile(parsed);
      await refresh();
      setOk("Profile saved.");
    });
  }

  async function onChat(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const data = await api.chatPreview(chatInput);
      setChatPreview({ preview: data.preview, diff: data.diff });
      setChatInput("");
    });
  }

  async function confirmChat() {
    if (!chatPreview) return;
    await run(async () => {
      await api.chatConfirm(chatPreview.preview);
      setLastDiff(chatPreview.diff);
      setChatPreview(null);
      await refresh();
      setOk("Chat update saved.");
    });
  }

  return (
    <section className="stack">
      <div>
        <h1>Profile</h1>
        <p className="lede">
          {exists
            ? `Version ${version}. Files, GitHub, summary and skills live here — this is what job matching uses.`
            : "Add a GitHub link and files, then build your profile from them or paste a CV."}
        </p>
      </div>

      {busy && (
        <div className="loading-banner">
          <span className="spinner" />
          Working with AI — this can take a few seconds…
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {ok && <div className="success">{ok}</div>}
      {lastDiff?.summary && <DiffView diff={lastDiff} />}

      <form className="panel stack" onSubmit={onSaveGithub}>
        <h2>GitHub</h2>
        <p className="muted">Used when generating a tailored CV, to pull matching public repos.</p>
        <label className="field">
          Profile URL
          <input
            type="url"
            placeholder="https://github.com/your-user"
            value={github}
            onChange={(e) => setGithub(e.target.value)}
            disabled={busy}
          />
        </label>
        <button className="btn btn-primary" disabled={busy}>
          Save GitHub
        </button>
      </form>

      <div className="panel stack">
        <h2>My files</h2>
        <p className="muted">
          Store CVs you built yourself, then tick one or more and update the skill profile from them.
        </p>
        <label className="field">
          Add a file (PDF, DOCX, or TXT)
          <input
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,text/plain"
            onChange={(e) => {
              onUploadFile(e.target.files?.[0] || null);
              e.target.value = "";
            }}
            disabled={busy}
          />
        </label>
        {files.length === 0 ? (
          <p className="muted">No files yet.</p>
        ) : (
          <ul className="file-list">
            {files.map((f) => (
              <li className="file-row" key={f.id}>
                <label className="file-pick">
                  <input
                    type="checkbox"
                    checked={selected.includes(f.id)}
                    onChange={() => toggleFile(f.id)}
                    disabled={busy}
                  />
                  <span>
                    <strong>{f.filename}</strong>
                    <span className="muted">
                      {" "}
                      · {formatBytes(f.size)} · {new Date(f.createdAt).toLocaleString()}
                    </span>
                  </span>
                </label>
                <div className="row">
                  <a className="btn btn-ghost" href={`/api/profile/files/${f.id}`}>
                    Download
                  </a>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => onDeleteFile(f.id)}
                    disabled={busy}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <button
          className="btn btn-primary"
          type="button"
          onClick={onApplySelected}
          disabled={busy || selected.length === 0}
        >
          Update profile from {selected.length || 0} selected
        </button>
      </div>

      <form className="panel stack" onSubmit={onSaveSummary}>
        <h2>My summary</h2>
        <label className="field">
          A short professional summary
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            disabled={busy}
            rows={5}
          />
        </label>
        <button className="btn btn-primary" disabled={busy || !profile}>
          Save summary
        </button>
      </form>

      <form className="panel stack" onSubmit={onSaveSkills}>
        <h2>Skills</h2>
        <p className="muted">Pulled from your files and notes. Edit anything that looks off.</p>
        {skills.length === 0 ? (
          <p className="muted">No skills yet — update the profile from a file or add one below.</p>
        ) : (
          <div className="stack">
            {skills.map((skill, i) => (
              <div className="skill-row" key={`${skill.name}-${i}`}>
                <input
                  type="text"
                  value={skill.name}
                  onChange={(e) =>
                    setSkills((prev) => prev.map((s, idx) => (idx === i ? { ...s, name: e.target.value } : s)))
                  }
                  disabled={busy}
                />
                <select
                  value={skill.level}
                  onChange={(e) =>
                    setSkills((prev) =>
                      prev.map((s, idx) => (idx === i ? { ...s, level: e.target.value as Skill["level"] } : s))
                    )
                  }
                  disabled={busy}
                >
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                  <option value="expert">Expert</option>
                </select>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setSkills((prev) => prev.filter((_, idx) => idx !== i))}
                  disabled={busy}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() =>
            setSkills((prev) => [...prev, { name: "", category: "technical", level: "intermediate" }])
          }
          disabled={busy}
        >
          Add skill
        </button>
        <button className="btn btn-primary" disabled={busy || !profile}>
          Save skills
        </button>
      </form>

      <div className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Edit everything</h2>
          <button type="button" className="btn btn-ghost" onClick={() => setShowEdit((v) => !v)}>
            {showEdit ? "Hide editor" : "Open editor"}
          </button>
        </div>
        {showEdit && (
          <form className="stack profile-editor" onSubmit={onSaveJson}>
            <p className="muted">
              Full profile as JSON — roles, education, certifications, target roles. Invalid JSON is rejected.
            </p>
            <textarea value={editJson} onChange={(e) => setEditJson(e.target.value)} disabled={busy} rows={18} />
            <button className="btn btn-primary" disabled={busy}>
              Save profile
            </button>
          </form>
        )}
      </div>

      <div className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>More ways to add info</h2>
          <button type="button" className="btn btn-ghost" onClick={() => setShowMore((v) => !v)}>
            {showMore ? "Hide" : "Show"}
          </button>
        </div>
        {showMore && (
          <>
            <form className="stack" onSubmit={onPaste}>
              <label className="field">
                Paste CV or bio text
                <textarea value={paste} onChange={(e) => setPaste(e.target.value)} disabled={busy} />
              </label>
              <button className="btn btn-primary" disabled={busy || paste.trim().length < 40}>
                Extract from text
              </button>
            </form>
            <form className="stack" onSubmit={onChat}>
              <label className="field">
                Tell CareerFit an update in plain language
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder='e.g. "I finished an AWS cert" or "Stop targeting frontend roles"'
                  disabled={busy}
                />
              </label>
              <button className="btn btn-primary" disabled={busy || !chatInput.trim()}>
                Preview update
              </button>
            </form>
            {chatPreview && (
              <div className="stack">
                <DiffView diff={chatPreview.diff} />
                <div className="row">
                  <button className="btn btn-primary" onClick={confirmChat} disabled={busy}>
                    Confirm &amp; save
                  </button>
                  <button className="btn btn-ghost" onClick={() => setChatPreview(null)} disabled={busy}>
                    Discard
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function DiffView({ diff }: { diff: ProfileDiff }) {
  return (
    <div className="success stack">
      <strong>{diff.summary}</strong>
      {diff.added?.length > 0 && (
        <div>
          Added:
          <ul className="list">
            {diff.added.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {diff.updated?.length > 0 && (
        <div>
          Updated:
          <ul className="list">
            {diff.updated.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {diff.removed?.length > 0 && (
        <div>
          Removed:
          <ul className="list">
            {diff.removed.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
