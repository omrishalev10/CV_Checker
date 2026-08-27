import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "./AuthGate";
import AppModeToggle from "./AppModeToggle";
import ThemeToggle from "./ThemeToggle";

export default function AccountMenu() {
  const { username, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const initial = (username || "?").slice(0, 1).toUpperCase();

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="account-menu" ref={wrapRef}>
      <button
        type="button"
        className="avatar-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={username ? `Account menu for ${username}` : "Account menu"}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="avatar-name">{username}</span>
      </button>
      {open && (
        <div className="account-popover" id={menuId}>
          <div className="account-head">
            <span className="avatar" aria-hidden="true">
              {initial}
            </span>
            <div>
              <strong>{username}</strong>
              <p className="muted">Your private studio</p>
            </div>
          </div>
          <Link to="/settings" className="menu-item" onClick={() => setOpen(false)}>
            Settings
          </Link>
          <ThemeToggle variant="row" />
          <AppModeToggle variant="menu" />
          <button
            type="button"
            className="menu-item danger"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
