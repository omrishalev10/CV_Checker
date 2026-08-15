import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Mode = "browser" | "installed" | "desktop-shell";

function detectMode(): Mode {
  if (typeof window === "undefined") return "browser";
  if ("__TAURI_INTERNALS__" in window || "__TAURI__" in window) return "desktop-shell";
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone ? "installed" : "browser";
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export default function AppModeToggle() {
  const [mode, setMode] = useState<Mode>(detectMode);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstallEvent(null);
      setShowHelp(false);
    }
    const displayQuery = window.matchMedia("(display-mode: standalone)");
    function onDisplayChange() {
      setMode(detectMode());
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    displayQuery.addEventListener("change", onDisplayChange);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      displayQuery.removeEventListener("change", onDisplayChange);
    };
  }, []);

  async function onInstall() {
    if (!installEvent) {
      setShowHelp((v) => !v);
      return;
    }
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") setInstallEvent(null);
  }

  function onOpenInBrowser() {
    window.open(window.location.href, "_blank", "noopener");
  }

  if (mode === "desktop-shell") {
    return <span className="mode-chip">Desktop app</span>;
  }

  if (mode === "installed") {
    return (
      <div className="mode-toggle">
        <button className="mode-btn" onClick={onOpenInBrowser} title="Open CareerFit in a browser tab">
          Use in browser
        </button>
      </div>
    );
  }

  return (
    <div className="mode-toggle">
      <button
        className="mode-btn"
        onClick={onInstall}
        aria-expanded={showHelp}
        title="Install CareerFit as a desktop app"
      >
        {installEvent ? "Install app" : "Install app…"}
      </button>
      {showHelp && !installEvent && (
        <div className="mode-help panel">
          <strong>Installing from this browser</strong>
          {isIos() ? (
            <p className="muted">
              On iPhone/iPad: tap the Share button, then <em>Add to Home Screen</em>.
            </p>
          ) : (
            <p className="muted">
              Look for the install icon in the address bar (Chrome or Edge), or open the browser menu and
              choose <em>Install CareerFit</em>. Firefox does not support installing web apps.
            </p>
          )}
          <p className="muted">
            Install needs the production build over <code>localhost</code> or HTTPS — open{" "}
            <code>http://localhost:3001</code> after running <code>npm start</code>.
          </p>
          <p className="muted">To go back to web-only, uninstall the app from your OS or browser.</p>
          <button className="btn btn-ghost" onClick={() => setShowHelp(false)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
