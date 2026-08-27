import { createContext, ReactNode, useContext, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Mode = "browser" | "installed" | "desktop-shell";

interface InstallContextValue {
  mode: Mode;
  canPrompt: boolean;
  showHelp: boolean;
  install: () => void;
  openInBrowser: () => void;
  isIos: boolean;
}

declare global {
  interface Window {
    __CF_PWA_PROMPT?: BeforeInstallPromptEvent | null;
  }
}

const InstallContext = createContext<InstallContextValue | null>(null);

function storedPrompt(): BeforeInstallPromptEvent | null {
  return typeof window === "undefined" ? null : window.__CF_PWA_PROMPT || null;
}

function detectMode(): Mode {
  if (typeof window === "undefined") return "browser";
  if ("__TAURI_INTERNALS__" in window || "__TAURI__" in window) return "desktop-shell";
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone ? "installed" : "browser";
}

function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function AppInstallProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(detectMode);
  const [canPrompt, setCanPrompt] = useState(Boolean(storedPrompt()));
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    function sync() {
      setCanPrompt(Boolean(storedPrompt()));
      setMode(detectMode());
    }
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      window.__CF_PWA_PROMPT = e as BeforeInstallPromptEvent;
      setCanPrompt(true);
      setShowHelp(false);
    }
    function onInstalled() {
      window.__CF_PWA_PROMPT = null;
      setCanPrompt(false);
      setMode(detectMode());
    }
    const displayQuery = window.matchMedia("(display-mode: standalone)");
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    displayQuery.addEventListener("change", sync);
    sync();
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      displayQuery.removeEventListener("change", sync);
    };
  }, []);

  function install() {
    const event = storedPrompt();
    if (!event) {
      setShowHelp(true);
      return;
    }
    void event.prompt().then(() => event.userChoice).then((choice) => {
      if (choice.outcome === "accepted") {
        window.__CF_PWA_PROMPT = null;
        setCanPrompt(false);
      }
    });
  }

  function openInBrowser() {
    window.open(window.location.href, "_blank", "noopener");
  }

  return (
    <InstallContext.Provider
      value={{
        mode,
        canPrompt,
        showHelp,
        install,
        openInBrowser,
        isIos: isIosDevice(),
      }}
    >
      {children}
    </InstallContext.Provider>
  );
}

function useAppInstall(): InstallContextValue {
  const value = useContext(InstallContext);
  if (!value) {
    throw new Error("useAppInstall must be used within AppInstallProvider");
  }
  return value;
}

export default function AppModeToggle({ variant = "button" }: { variant?: "button" | "menu" }) {
  const { mode, canPrompt, showHelp, install, openInBrowser, isIos } = useAppInstall();

  if (mode === "desktop-shell") {
    return variant === "menu" ? (
      <div className="menu-item is-static">Desktop app</div>
    ) : (
      <span className="mode-chip">Desktop app</span>
    );
  }

  if (mode === "installed") {
    const control = (
      <button type="button" className={variant === "menu" ? "menu-item" : "mode-btn"} onClick={openInBrowser}>
        Open in browser
      </button>
    );
    return variant === "menu" ? control : <div className="mode-toggle">{control}</div>;
  }

  const help = showHelp && !canPrompt && (
    <div className={variant === "menu" ? "menu-help" : "mode-help panel"}>
      <strong>Install from the browser</strong>
      {isIos ? (
        <p className="muted">
          Tap Share, then <em>Add to Home Screen</em>.
        </p>
      ) : (
        <p className="muted">
          Use Chrome or Edge. Click the install icon in the address bar (a monitor with a download arrow), or open the
          browser menu and choose <em>Install CareerFit</em>.
        </p>
      )}
    </div>
  );

  const control = (
    <button
      type="button"
      className={variant === "menu" ? "menu-item" : "mode-btn"}
      onClick={install}
      aria-expanded={showHelp}
    >
      Install app
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
