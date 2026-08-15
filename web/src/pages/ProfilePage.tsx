import { FormEvent, useEffect, useState } from "react";
import { api, ProfileDiff, SkillProfile } from "../api";

type Tab = "upload" | "paste" | "edit" | "add" | "chat";

export default function ProfilePage() {
  const [tab, setTab] = useState<Tab>("upload");
  const [profile, setProfile] = useState<SkillProfile | null>(null);
  const [version, setVersion] = useState(0);
  const [exists, setExists] = useState(false);
  const [paste, setPaste] = useState("");
  const [editJson, setEditJson] = useState("");
  const [note, setNote] = useState("");
  const [noteKind, setNoteKind] = useState("note");
  const [chatInput, setChatInput] = useState("");
  const [chatPreview, setChatPreview] = useState<{
    preview: SkillProfile;
    diff: ProfileDiff;
  } | null>(null);
  const [lastDiff, setLastDiff] = useState<ProfileDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function refresh() {
    const data = await api.getProfile();
    setProfile(data.profile);
    setVersion(data.version);
    setExists(Boolean(data.exists));
    setEditJson(JSON.stringify(data.profile, null, 2));
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

  async function onUpload(file: File | null) {
    if (!file) return;
    await run(async () => {
      await api.profileUpload(file);
      await refresh();
      setOk("Profile extracted. Review and edit anything that looks off.");
      setTab("edit");
    });
  }

  async function onPaste(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await api.profileFromText(paste);
      await refresh();
      setOk("Profile extracted from pasted text.");
      setTab("edit");
    });
  }

  async function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const parsed = JSON.parse(editJson) as SkillProfile;
      await api.saveProfile(parsed);
      await refresh();
      setOk("Profile saved.");
    });
  }

  async function onSupplement(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const data = await api.supplement(noteKind, note);
      setLastDiff(data.diff);
      await refresh();
      setNote("");
      setOk(data.diff?.summary || "Profile updated.");
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
      setTab("edit");
    });
  }

  return (
    <section className="stack">
      <div>
        <h1>Skill profile</h1>
        <p className="lede">
          {exists
            ? `Version ${version} · source of truth for matching and tailored CVs.`
            : "Upload or paste a CV to build your structured skill profile."}
        </p>
      </div>

      <div className="tabs">
        {(
          [
            ["upload", "Upload"],
            ["paste", "Paste"],
            ["edit", "Edit"],
            ["add", "Add info"],
            ["chat", "Chat"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={`tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {busy && (
        <div className="loading-banner">
          <span className="spinner" />
          Working with AI — this can take a few seconds…
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {ok && <div className="success">{ok}</div>}

      {tab === "upload" && (
        <div className="panel stack">
          <label className="field">
            CV file (PDF, DOCX, or TXT)
            <input
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,text/plain"
              onChange={(e) => onUpload(e.target.files?.[0] || null)}
              disabled={busy}
            />
          </label>
        </div>
      )}

      {tab === "paste" && (
        <form className="panel stack" onSubmit={onPaste}>
          <label className="field">
            Paste CV or bio text
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} disabled={busy} />
          </label>
          <button className="btn btn-primary" disabled={busy || paste.trim().length < 40}>
            Extract profile
          </button>
        </form>
      )}

      {tab === "edit" && (
        <form className="panel stack profile-editor" onSubmit={onSaveEdit}>
          <p className="muted">Edit the JSON carefully. Invalid JSON will be rejected.</p>
          <textarea value={editJson} onChange={(e) => setEditJson(e.target.value)} disabled={busy} />
          <button className="btn btn-primary" disabled={busy}>
            Save profile
          </button>
        </form>
      )}

      {tab === "add" && (
        <form className="panel stack" onSubmit={onSupplement}>
          <label className="field">
            Type
            <select value={noteKind} onChange={(e) => setNoteKind(e.target.value)}>
              <option value="note">Freeform note</option>
              <option value="link">Portfolio / GitHub / LinkedIn link</option>
              <option value="learning">What I'm learning</option>
              <option value="targets">Roles I'm targeting</option>
            </select>
          </label>
          <label className="field">
            Content
            <textarea value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </label>
          <button className="btn btn-primary" disabled={busy || !note.trim()}>
            Merge into profile
          </button>
          {lastDiff && <DiffView diff={lastDiff} />}
        </form>
      )}

      {tab === "chat" && (
        <div className="panel stack">
          <p className="muted">
            Tell CareerFit updates in plain language. You'll see a diff and confirm before anything is saved.
          </p>
          <form className="stack" onSubmit={onChat}>
            <label className="field">
              Message
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder='e.g. "I finished an AWS Solutions Architect cert" or "Stop targeting frontend roles"'
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
        </div>
      )}

      {profile && exists && tab !== "edit" && (
        <div className="panel stack">
          <h2>At a glance</h2>
          {profile.summary && <p>{profile.summary}</p>}
          <div className="chip-row">
            {(profile.skills || []).slice(0, 18).map((s) => (
              <span className="chip" key={`${s.name}-${s.level}`}>
                {s.name}
                {s.level ? ` · ${s.level}` : ""}
              </span>
            ))}
          </div>
          <p className="muted">
            {profile.experience?.length || 0} roles · {profile.education?.length || 0} education ·{" "}
            {profile.certifications?.length || 0} certifications
            {profile.seniority ? ` · ${profile.seniority}` : ""}
          </p>
        </div>
      )}
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
