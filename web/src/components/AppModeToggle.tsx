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

export default function AppModeToggle({ variant = "button" }: { variant?: "button" | "menu" }) {
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
    return variant === "menu" ? (
      <div className="menu-item is-static">Desktop app</div>
    ) : (
      <span className="mode-chip">Desktop app</span>
    );
  }

  if (mode === "installed") {
    const control = (
      <button
        type="button"
        className={variant === "menu" ? "menu-item" : "mode-btn"}
        onClick={onOpenInBrowser}
        role={variant === "menu" ? "menuitem" : undefined}
      >
        Open in browser
      </button>
    );
    return variant === "menu" ? control : <div className="mode-toggle">{control}</div>;
  }

  const help = showHelp && !installEvent && (
    <div className={variant === "menu" ? "menu-help" : "mode-help panel"}>
      <strong>Install CareerFit</strong>
      {isIos() ? (
        <p className="muted">
          On iPhone or iPad: tap Share, then <em>Add to Home Screen</em>.
        </p>
      ) : (
        <p className="muted">
          Look for the install icon in the address bar, or open the browser menu and choose{" "}
          <em>Install CareerFit</em>. Firefox cannot install web apps.
        </p>
      )}
      {variant !== "menu" && (
        <button type="button" className="btn btn-ghost" onClick={() => setShowHelp(false)}>
          Close
        </button>
      )}
    </div>
  );

  const control = (
    <button
      type="button"
      className={variant === "menu" ? "menu-item" : "mode-btn"}
      onClick={onInstall}
      aria-expanded={showHelp}
      role={variant === "menu" ? "menuitem" : undefined}
    >
      {installEvent ? "Install app" : "Install on this device"}
    </button>
  );

  if (variant === "menu") {
    return (
      <>
        {control}
        {help}
      </>
    );
  }

  return (
    <div className="mode-toggle">
      {control}
      {help}
    </div>
  );
}
