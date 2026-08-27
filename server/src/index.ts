import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireAuth } from "./auth.js";
import { initDb } from "./db.js";
import { createApiRouter } from "./routes/api.js";
import { createAuthRouter } from "./routes/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
dotenv.config({ path: path.join(root, ".env") });
dotenv.config(); // also allow server/.env

const configuredDataDir = process.env.DATA_DIR;
const dataDir = configuredDataDir
  ? path.isAbsolute(configuredDataDir)
    ? configuredDataDir
    : path.resolve(root, configuredDataDir)
  : path.join(root, "data");
const port = Number(process.env.PORT || 3001);

await initDb(dataDir);

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Public so platform health checks pass without credentials. Reveals nothing.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "careerfit" });
});

app.use("/api/auth", createAuthRouter());
app.use("/api", requireAuth, createApiRouter());

const webDist = path.resolve(root, "web", "dist");
app.use(express.static(webDist));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  const index = path.join(webDist, "index.html");
  res.sendFile(index, (err) => {
    if (err) next();
  });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
});

// Hosts like Render route external traffic to this port and require binding on all interfaces.
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`CareerFit API on port ${port}`);
  console.log("Accounts: sign up or log in required");
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use — another CareerFit server is probably still running.\n` +
        `Stop it, or start this one on a different port with: PORT=3002 npm start`
    );
    process.exit(1);
  }
  throw err;
});
