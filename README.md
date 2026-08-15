# CareerFit

Personal job-match assistant: ingest your CV into a structured skill profile, score job descriptions (text, screenshot, or URL) with Gemini, and generate ATS-friendly tailored CVs — without inventing experience.

## Architecture

| Layer | Tech | Role |
| --- | --- | --- |
| Web UI | React + Vite (PWA) | Shared frontend for browser + desktop |
| API | Express (Node) | AI key, PDF/DOCX parse, URL fetch, CV export |
| AI | Pluggable API key (auto-routed) | Profile extract/merge, match scoring, tailored CV |
| Storage | libSQL — local file or Turso | Profile versions, match history, tailored CV content |
| Desktop | Tauri (wraps same web build) | Native PC shell; packaging only |

**Stateless by design.** Nothing is written to disk at runtime. Tailored CVs are stored as JSON and the DOCX/PDF are rendered on each download, so the app deploys to hosts that offer no persistent volume. Point `TURSO_DATABASE_URL` at Turso and the same code runs in the cloud; leave it unset and it uses a local SQLite file.

**Fit score:** 0–100 with labels — Low (&lt;40), Medium (40–64), High (65–84), Strong (≥85).

**Data sensitivity:** run locally and your CV content stays on your machine in SQLite under `./data`. Deploy it and that data moves to Turso instead. Your AI API key lives only on the server (environment and/or **Settings**) — never in the frontend.

## Access control

CareerFit ships unlocked, which is fine when it only listens on your own machine. **Set an app password before the server is reachable from anywhere else** — every endpoint (profile, history, tailored CV downloads, API key management) is otherwise open to whoever can reach the port.

Set one under **Settings → App password**, or headlessly with `APP_PASSWORD=...` in `.env`.

| Behaviour | Detail |
| --- | --- |
| Password storage | scrypt hash + per-install random salt, in SQLite |
| Session | HttpOnly cookie, 30 days, token stored only as a SHA-256 hash |
| Sign out | Ends that device's session only |
| Change password | Revokes every session everywhere |
| Brute force | 8 failed attempts per IP triggers a 5-minute block |

`APP_PASSWORD` in the environment takes effect whenever no password is set in the app, and **Remove password** cannot switch it off — delete it from `.env` instead.

## Setup

1. Copy env file (optional — you can also paste a key in the app under **Settings**):

```bash
copy .env.example .env
```

Set `AI_API_KEY=...` if you want it in the env file.

2. Install and run (web + API):

```bash
npm install
npm run dev
```

- Web: http://localhost:5173  
- API: http://localhost:3001  
- Settings: http://localhost:5173/settings  

3. Production-style (API serves built web):

```bash
npm run build
npm start
```

## Web mode vs app mode

The header has a mode button so the same install can be used either way:

| Where you are | Button shows | What it does |
| --- | --- | --- |
| Browser tab | **Install app** | Installs CareerFit as a standalone window (Chrome/Edge desktop, Android) |
| Installed window | **Use in browser** | Opens the same URL back in a normal browser tab |
| Tauri desktop build | **Desktop app** (label) | Already native; nothing to install |

Install requires the production build over `localhost` or HTTPS:

```bash
npm run build
npm start
# then open http://localhost:3001 and click Install app
```

Uninstalling can't be done from inside the page — remove it from your OS or browser (Chrome/Edge: open the installed app menu → Uninstall). The button reflects the current mode automatically.

**Using it from your phone:** run `npm start` on the PC and open `http://<pc-lan-ip>:3001` on the phone. Over plain HTTP the browser treats it as an insecure context, so installing and offline caching are disabled there — normal browser use works fine. For LAN access to the Vite dev server instead, run `npm run dev:web -- --host`.

## Reaching it away from home

Two approaches, with a decisive difference: only the first works when your PC is off.

### Deploy it (recommended)

The app is stateless, so any container host works. Storage lives in Turso's free tier and documents are rendered on request.

1. **Database** — create a free database at [turso.tech](https://turso.tech) and copy its URL and auth token.
2. **Bring your data across** (optional, keeps your existing profile and history):

```bash
TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... node scripts/migrate-to-turso.mjs
```

3. **Deploy** — push to GitHub, then create a Render web service from the repo. `render.yaml` selects the Docker build, the free plan, and `/api/health` as the health check.
4. **Set environment variables** in the host: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `AI_API_KEY`, and `APP_PASSWORD`.

You get HTTPS automatically, which means iPhone **Add to Home Screen** installs a real PWA with offline caching. On Render's free plan the service sleeps after 15 minutes idle, so the first request after a pause takes roughly 50 seconds; the data is in Turso, so nothing is lost.

### Tailscale (keeps data on your PC)

A private network between your devices — no public URL, works on mobile data, but **only while the PC is awake and running the server**.

1. Install on the PC (`winget install Tailscale.Tailscale`) and the phone, signing both into the same account.
2. Find the PC's address with `tailscale ip -4`.
3. Run `npm start` and open `http://<tailscale-ip>:3001` on the phone.

## Desktop (Tauri)

Requires [Rust](https://rustup.rs/) and Tauri system deps.

```bash
npm install
npm run build -w web
cd src-tauri
cargo tauri dev
```

The desktop shell loads the web UI and talks to the local API (`http://localhost:3001`). Start the API (`npm run dev:server`) alongside Tauri during development.

## Verification checklist

1. Upload/paste CV → review/edit skill profile  
2. Add a note → confirm merge diff (not blind append)  
3. Paste a job description → score + gaps  
4. Upload a job screenshot → vision extract + match  
5. Paste a job URL (and a failing URL) → fetch or clear fallback  
6. Generate tailored CV → DOCX/PDF + honest diff  
7. Check layout at ~375px width  
8. Set an app password → reload → lock screen appears; `npm run test:auth` passes  
9. Download a tailored CV twice → both render fresh; `npm run test:downloads` passes  

## Scripts

- `npm run dev` — API + Vite together  
- `npm run build` — build web + compile server  
- `npm start` — serve API + static web from `web/dist`  
- `npm run icons` — regenerate PWA and Tauri icons
- `npm run test:auth` — end-to-end password gate checks
- `npm run test:downloads` — proves DOCX/PDF render on request with no files on disk
- `node scripts/check-db-compat.mjs` — confirms an existing local database opens under libSQL
- `node scripts/migrate-to-turso.mjs` — copy local data into Turso before deploying

The two test scripts expect a throwaway server, so they never touch your real data:

```bash
PORT=3022 DATA_DIR=tmp-dl node server/dist/index.js
npm run test:downloads -- http://localhost:3022 tmp-dl
```
