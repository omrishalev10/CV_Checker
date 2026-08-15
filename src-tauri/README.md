# Desktop packaging notes

CareerFit's desktop app is a Tauri shell around the same React frontend.

## Dev

1. Terminal A: `npm run dev:server` (API + SQLite + Claude)
2. Terminal B: with Rust installed — `cargo tauri dev` from `src-tauri` (or install `@tauri-apps/cli` and run `npm exec tauri dev`)

The web UI proxies `/api` to `localhost:3001` in Vite; for production builds served by Express, the API and UI share origin.

## Why Tauri

Smaller binary and lower memory than Electron; the heavy lifting stays in the shared Node API process for Claude, file parsing, and SQLite.
