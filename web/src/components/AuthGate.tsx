import {
  createContext,
  FormEvent,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { api, onAuthRequired } from "../api";

interface AuthContextValue {
  enabled: boolean;
  authenticated: boolean;
  username: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  enabled: true,
  authenticated: false,
  username: null,
  refresh: async () => {},
  signOut: async () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const status = await api.authStatus();
      setAuthenticated(Boolean(status.authenticated));
      setUsername(status.username || null);
      setStatusError(null);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    setAuthenticated(false);
    setUsername(null);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    onAuthRequired(() => {
      setAuthenticated(false);
      setUsername(null);
    });
    return () => onAuthRequired(null);
  }, []);

  if (loading) {
    return (
      <div className="lock-screen">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (statusError) {
    return (
      <div className="lock-screen">
        <div className="lock-card stack">
          <h1>Can't reach CareerFit</h1>
          <div className="error">{statusError}</div>
          <button className="btn btn-primary" onClick={() => refresh()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return <AccountScreen onUnlocked={refresh} />;
  }

  return (
    <AuthContext.Provider
      value={{ enabled: true, authenticated, username, refresh, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function AccountScreen({ onUnlocked }: { onUnlocked: () => Promise<void> }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = mode === "signup" && confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < 8;
  const canSubmit =
    username.trim().length >= 3 &&
    password.length >= 8 &&
    !mismatch &&
    (mode === "login" || password === confirm);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        await api.signup(username.trim(), password);
      } else {
        await api.login(username.trim(), password);
      }
      setPassword("");
      setConfirm("");
      await onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not continue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lock-screen">
      <form className="lock-card stack" onSubmit={onSubmit}>
        <div>
          <h1 className="brand">
            Career<span>Fit</span>
          </h1>
          <p className="lede">
            {mode === "login"
              ? "Sign in to your account. Your CVs and job matches stay private to you."
              : "Create a free account. You will add your own AI key in Settings."}
          </p>
        </div>

        <div className="tabs">
          <button type="button" className={`tab ${mode === "login" ? "active" : ""}`} onClick={() => setMode("login")}>
            Sign in
          </button>
          <button type="button" className={`tab ${mode === "signup" ? "active" : ""}`} onClick={() => setMode("signup")}>
            Create account
          </button>
        </div>

        {error && <div className="error">{error}</div>}

        <label className="field">
          Username
          <input
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </label>
        <label className="field">
          Password
          <input
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </label>
        {mode === "signup" && (
          <label className="field">
            Confirm password
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
        {tooShort && <p className="muted">Use at least 8 characters.</p>}
        {mismatch && <p className="muted">Passwords don't match.</p>}

        <button className="btn btn-primary" disabled={busy || !canSubmit}>
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>
    </div>
  );
}
