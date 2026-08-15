import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../components/AuthGate";

export default function SettingsPage() {
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
      setOk("API key saved. It stays on this device and is never shown in full again.");
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
        <h1>Settings</h1>
        <p className="lede">API key, app password, and appearance. Dark mode is in the header on every page.</p>
      </div>

      {error && <div className="error">{error}</div>}
      {ok && <div className="success">{ok}</div>}

      <form className="panel stack" onSubmit={onSave}>
        <h2>API key</h2>
        <p>
          Status:{" "}
          {configured ? (
            <span className="badge strong">Saved · {maskedKey}</span>
          ) : (
            <span className="badge low">Not set</span>
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
    </section>
  );
}

function PasswordPanel() {
  const { enabled, refresh, signOut } = useAuth();
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
      await api.setPassword(password);
      setPassword("");
      setConfirm("");
      await refresh();
      setOk("Password set. Other signed-in devices were logged out.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set password");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const data = await api.removePassword();
      await refresh();
      setOk(data.note || "Password removed. Anyone who can reach this server now has full access.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel stack" onSubmit={onSave}>
      <h2>App password</h2>
      <p>
        Status:{" "}
        {enabled ? (
          <span className="badge strong">Locked</span>
        ) : (
          <span className="badge low">No password — open to anyone on your network</span>
        )}
      </p>

      {error && <div className="error">{error}</div>}
      {ok && <div className="success">{ok}</div>}

      <label className="field">
        {enabled ? "New password" : "Password"}
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
      </label>
      <label className="field">
        Confirm
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

      <div className="row">
        <button
          className="btn btn-primary"
          disabled={busy || password.length < 8 || password !== confirm}
        >
          {enabled ? "Change password" : "Set password"}
        </button>
        {enabled && (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => signOut()} disabled={busy}>
              Sign out
            </button>
            <button type="button" className="btn btn-danger" onClick={onRemove} disabled={busy}>
              Remove password
            </button>
          </>
        )}
      </div>
    </form>
  );
}
