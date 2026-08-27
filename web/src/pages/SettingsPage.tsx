import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../components/AuthGate";

export default function SettingsPage() {
  const { username, signOut } = useAuth();
  const [configured, setConfigured] = useState(false);
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function refresh() {
    const data = await api.getSettings();
    setConfigured(Boolean(data.configured));
    setMaskedKey(data.maskedKey || null);
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const data = await api.saveApiKey(apiKey.trim());
      setConfigured(true);
      setMaskedKey(data.maskedKey);
      setApiKey("");
      setOk("API key saved for your account. It is never shown in full again.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await api.clearApiKey();
      setConfigured(false);
      setMaskedKey(null);
      setOk("API key cleared.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear key");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack">
      <div>
        <p className="kicker">Account</p>
        <h1>Settings</h1>
        <p className="lede">
          Signed in as <strong>{username}</strong>. Your profile, jobs, and API key belong only to this
          account.
        </p>
      </div>

      {error && <div className="error">{error}</div>}
      {ok && <div className="success">{ok}</div>}

      <form className="panel stack" onSubmit={onSave}>
        <h2>Your AI API key</h2>
        <p className="muted">
          Each account uses its own Gemini or Anthropic key. CareerFit does not share keys between users.
        </p>
        <p>
          Status:{" "}
          {configured ? (
            <span className="badge strong">Saved · {maskedKey}</span>
          ) : (
            <span className="badge low">Not set — add a key before checking jobs</span>
          )}
        </p>
        <label className="field">
          Paste API key
          <input
            type="password"
            autoComplete="off"
            placeholder={configured ? "Paste a new key to replace the current one" : "Paste your API key"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={busy}
          />
        </label>
        <div className="row">
          <button className="btn btn-primary" disabled={busy || apiKey.trim().length < 20}>
            Save key
          </button>
          {configured && (
            <button type="button" className="btn btn-danger" onClick={onClear} disabled={busy}>
              Clear key
            </button>
          )}
        </div>
      </form>

      <PasswordPanel />

      <div className="panel stack">
        <h2>Session</h2>
        <button type="button" className="btn btn-ghost" onClick={() => signOut()} disabled={busy}>
          Sign out
        </button>
      </div>
    </section>
  );
}

function PasswordPanel() {
  const { refresh } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && password !== confirm;

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await api.setPassword(password, currentPassword);
      setCurrentPassword("");
      setPassword("");
      setConfirm("");
      await refresh();
      setOk("Password updated. Other devices were signed out.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel stack" onSubmit={onSave}>
      <h2>Change password</h2>
      {error && <div className="error">{error}</div>}
      {ok && <div className="success">{ok}</div>}

      <label className="field">
        Current password
        <input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          disabled={busy}
        />
      </label>
      <label className="field">
        New password
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
      </label>
      <label className="field">
        Confirm new password
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={busy}
        />
      </label>

      {tooShort && <p className="muted">Use at least 8 characters.</p>}
      {mismatch && <p className="muted">Passwords don't match.</p>}

      <button
        className="btn btn-primary"
        disabled={busy || !currentPassword || password.length < 8 || password !== confirm}
      >
        Update password
      </button>
    </form>
  );
}
