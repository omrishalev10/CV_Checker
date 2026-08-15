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
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  enabled: false,
  authenticated: true,
  refresh: async () => {},
  signOut: async () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [authenticated, setAuthenticated] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const status = await api.authStatus();
      setEnabled(status.enabled);
      setAuthenticated(status.authenticated);
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
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    onAuthRequired(() => {
      setEnabled(true);
      setAuthenticated(false);
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

  if (enabled && !authenticated) {
    return <LockScreen onUnlocked={refresh} />;
  }

  return (
    <AuthContext.Provider value={{ enabled, authenticated, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

function LockScreen({ onUnlocked }: { onUnlocked: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      setPassword("");
      await onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
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
          <p className="lede">Enter your app password to continue.</p>
        </div>
        {error && <div className="error">{error}</div>}
        <label className="field">
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </label>
        <button className="btn btn-primary" disabled={busy || !password}>
          {busy ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
