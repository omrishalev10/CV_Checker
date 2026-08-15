import { Router } from "express";
import {
  clearLoginFailures,
  clearPassword,
  clearSessionCookie,
  createSession,
  getSessionToken,
  isAuthConfigured,
  isAuthenticated,
  loginBlockedFor,
  recordLoginFailure,
  requireAuth,
  revokeSession,
  setPassword,
  setSessionCookie,
  verifyPassword,
} from "../auth.js";

const MIN_PASSWORD_LENGTH = 8;

export function createAuthRouter(): Router {
  const router = Router();

  router.get("/status", async (req, res, next) => {
    try {
      res.json({
        enabled: isAuthConfigured(),
        authenticated: await isAuthenticated(req),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/login", async (req, res, next) => {
    try {
      if (!isAuthConfigured()) {
        res.json({ enabled: false, authenticated: true });
        return;
      }

      const ip = req.ip || "unknown";
      const blockedMs = loginBlockedFor(ip);
      if (blockedMs > 0) {
        res.status(429).json({
          error: `Too many attempts. Try again in ${Math.ceil(blockedMs / 1000)}s.`,
        });
        return;
      }

      const password = String(req.body?.password || "");
      if (!verifyPassword(password)) {
        recordLoginFailure(ip);
        res.status(401).json({ error: "Incorrect password." });
        return;
      }

      clearLoginFailures(ip);
      const { token, maxAgeMs } = await createSession();
      setSessionCookie(req, res, token, maxAgeMs);
      res.json({ enabled: true, authenticated: true });
    } catch (err) {
      next(err);
    }
  });

  router.post("/logout", async (req, res, next) => {
    try {
      const token = getSessionToken(req);
      if (token) await revokeSession(token);
      clearSessionCookie(req, res);
      res.json({ enabled: isAuthConfigured(), authenticated: false });
    } catch (err) {
      next(err);
    }
  });

  // Setting the first password is open so a fresh install can lock itself;
  // once one exists, changing it requires an active session.
  router.put("/password", async (req, res, next) => {
    try {
      const alreadyConfigured = isAuthConfigured();
      if (alreadyConfigured && !(await isAuthenticated(req))) {
        res.status(401).json({ error: "Sign in to change the password.", authRequired: true });
        return;
      }

      const password = String(req.body?.password || "");
      if (password.length < MIN_PASSWORD_LENGTH) {
        res.status(400).json({ error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` });
        return;
      }

      await setPassword(password);
      const { token, maxAgeMs } = await createSession();
      setSessionCookie(req, res, token, maxAgeMs);
      res.json({ enabled: true, authenticated: true });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/password", requireAuth, async (req, res, next) => {
    try {
      await clearPassword();
      // An APP_PASSWORD in the environment survives this, so report the real state.
      clearSessionCookie(req, res);
      if (isAuthConfigured()) {
        res.json({
          enabled: true,
          authenticated: false,
          note: "APP_PASSWORD is set in the environment, so the lock stays on. Remove it from the environment to disable.",
        });
        return;
      }
      res.json({ enabled: false, authenticated: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
