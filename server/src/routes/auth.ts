import { Router } from "express";
import {
  clearLoginFailures,
  clearSessionCookie,
  createSession,
  createUser,
  findUserByUsername,
  getRequestUser,
  getSessionToken,
  loginBlockedFor,
  MIN_PASSWORD_LENGTH,
  passwordMatches,
  recordLoginFailure,
  requireAuth,
  revokeSession,
  setSessionCookie,
  setUserPassword,
  USERNAME_PATTERN,
  userCount,
} from "../auth.js";
import { claimOrphanDataIfNeeded } from "../db.js";

export function createAuthRouter(): Router {
  const router = Router();

  router.get("/status", async (req, res, next) => {
    try {
      const user = await getRequestUser(req);
      res.json({
        enabled: true,
        authenticated: Boolean(user),
        username: user?.username ?? null,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/signup", async (req, res, next) => {
    try {
      const ip = req.ip || "unknown";
      const blockedMs = loginBlockedFor(ip);
      if (blockedMs > 0) {
        res.status(429).json({
          error: `Too many attempts. Try again in ${Math.ceil(blockedMs / 1000)}s.`,
        });
        return;
      }

      const username = String(req.body?.username || "");
      const password = String(req.body?.password || "");
      if (!USERNAME_PATTERN.test(username.trim().toLowerCase())) {
        res.status(400).json({ error: "Username must be 3–32 letters, numbers, or underscores." });
        return;
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        res.status(400).json({ error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` });
        return;
      }

      try {
        const user = await createUser(username, password);
        if ((await userCount()) === 1) {
          await claimOrphanDataIfNeeded(user.id);
        }
        const { token, maxAgeMs } = await createSession(user.id);
        setSessionCookie(req, res, token, maxAgeMs);
        res.json({ enabled: true, authenticated: true, username: user.username });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not create account.";
        if (/already taken/i.test(message)) {
          recordLoginFailure(ip);
          res.status(409).json({ error: message });
          return;
        }
        res.status(400).json({ error: message });
      }
    } catch (err) {
      next(err);
    }
  });

  router.post("/login", async (req, res, next) => {
    try {
      const ip = req.ip || "unknown";
      const blockedMs = loginBlockedFor(ip);
      if (blockedMs > 0) {
        res.status(429).json({
          error: `Too many attempts. Try again in ${Math.ceil(blockedMs / 1000)}s.`,
        });
        return;
      }

      const username = String(req.body?.username || "");
      const password = String(req.body?.password || "");
      const user = await findUserByUsername(username);
      if (!user || !passwordMatches(user.password_hash, password)) {
        recordLoginFailure(ip);
        res.status(401).json({ error: "Incorrect username or password." });
        return;
      }

      clearLoginFailures(ip);
      const { token, maxAgeMs } = await createSession(user.id);
      setSessionCookie(req, res, token, maxAgeMs);
      res.json({ enabled: true, authenticated: true, username: user.username });
    } catch (err) {
      next(err);
    }
  });

  router.post("/logout", async (req, res, next) => {
    try {
      const token = getSessionToken(req);
      if (token) await revokeSession(token);
      clearSessionCookie(req, res);
      res.json({ enabled: true, authenticated: false, username: null });
    } catch (err) {
      next(err);
    }
  });

  router.put("/password", requireAuth, async (req, res, next) => {
    try {
      const currentPassword = String(req.body?.currentPassword || "");
      const newPassword = String(req.body?.newPassword || req.body?.password || "");
      const user = await findUserByUsername(req.username || "");
      if (!user) {
        res.status(401).json({ error: "Sign in to change the password.", authRequired: true });
        return;
      }
      if (currentPassword && !passwordMatches(user.password_hash, currentPassword)) {
        res.status(401).json({ error: "Current password is incorrect." });
        return;
      }
      await setUserPassword(user.id, newPassword);
      const { token, maxAgeMs } = await createSession(user.id);
      setSessionCookie(req, res, token, maxAgeMs);
      res.json({ enabled: true, authenticated: true, username: user.username });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not change password.";
      res.status(400).json({ error: message });
    }
  });

  return router;
}
