import { Router } from "express";
import multer from "multer";
import {
  deleteAnalysis,
  deleteProfileFile,
  getAnalysis,
  getMainCvFile,
  getProfile,
  getProfileFile,
  getTailoredCv,
  getTailoredCvById,
  insertAnalysis,
  insertProfileFile,
  listAnalyses,
  listProfileFiles,
  listTailoredCvs,
  saveProfile,
  saveTailoredCv,
  setMainCvFileId,
  updateTailoredCvGrade,
  type TailoredCvRow,
} from "../db.js";
import { extractTextFromBuffer } from "../services/cvParse.js";
import {
  analyzeJobFromImage,
  analyzeJobMatch,
  extractProfileFromCvText,
  generateTailoredCvContent,
  gradeTailoredCv,
  mergeProfileUpdate,
  resetAiClient,
} from "../services/ai.js";
import { fetchGithubEvidence, githubUrlFromProfile, withGithubLink, withGithubUrl } from "../services/github.js";
import { fetchJobUrl } from "../services/urlFetch.js";
import { renderDocx, renderPdf, type TailoredCvDoc } from "../services/tailorExport.js";
import type { SkillProfile } from "../types.js";
import { emptyProfile } from "../types.js";
import { resetCvAgent, resolveCvAgent, saveCvAgent } from "../agents/cvAgent.js";
import { deleteUserSetting, maskSecret, resolveApiKey, setUserSetting } from "../settings.js";
import { currentUserId } from "../context.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

function toTailoredPayload(row: TailoredCvRow) {
  return {
    id: row.id,
    diff: JSON.parse(row.diff_json),
    grade: row.grade_json ? JSON.parse(row.grade_json) : null,
    hasDocx: Boolean(row.cv_json),
    hasPdf: Boolean(row.cv_json),
    createdAt: row.created_at,
  };
}

export function createApiRouter(): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true, service: "careerfit" });
  });

  router.get("/settings", async (_req, res, next) => {
    try {
      const key = await resolveApiKey();
      const cvAgent = await resolveCvAgent();
      res.json({
        configured: Boolean(key),
        maskedKey: key ? maskSecret(key) : null,
        cvAgent,
      });
    } catch (err) {
      next(err);
    }
  });

  router.put("/settings/cv-agent", async (req, res, next) => {
    try {
      const name = String(req.body?.name || "");
      const instructions = String(req.body?.instructions || "");
      const cvAgent = await saveCvAgent(name, instructions);
      res.json({ cvAgent });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save CV agent.";
      if (message.includes("too long")) {
        res.status(400).json({ error: message });
        return;
      }
      next(err);
    }
  });

  router.delete("/settings/cv-agent", async (_req, res, next) => {
    try {
      const cvAgent = await resetCvAgent();
      res.json({ cvAgent });
    } catch (err) {
      next(err);
    }
  });

  router.put("/settings/api-key", async (req, res, next) => {
    try {
      const apiKey = String(req.body?.apiKey || "").trim();
      if (!apiKey) {
        res.status(400).json({ error: "apiKey is required." });
        return;
      }
      if (apiKey.length < 20) {
        res.status(400).json({ error: "That doesn't look like a valid API key." });
        return;
      }
      await setUserSetting(currentUserId(), "api_key", apiKey);
      resetAiClient();
      res.json({ configured: true, maskedKey: maskSecret(apiKey) });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/settings/api-key", async (_req, res, next) => {
    try {
      const userId = currentUserId();
      await deleteUserSetting(userId, "api_key");
      await deleteUserSetting(userId, "gemini_api_key");
      await deleteUserSetting(userId, "anthropic_api_key");
      resetAiClient();
      res.json({ configured: false, maskedKey: null });
    } catch (err) {
      next(err);
    }
  });

  router.get("/profile", async (_req, res, next) => {
    try {
      const current = await getProfile();
      const mainCv = await getMainCvFile();
      if (!current) {
        res.json({ version: 0, profile: emptyProfile(), exists: false, mainCv });
        return;
      }
      res.json({ ...current, exists: true, mainCv });
    } catch (err) {
      next(err);
    }
  });

  router.put("/profile", async (req, res, next) => {
    try {
      const profile = req.body?.profile as SkillProfile | undefined;
      if (!profile || typeof profile !== "object") {
        res.status(400).json({ error: "Body must include a profile object." });
        return;
      }
      res.json(await saveProfile(profile, true));
    } catch (err) {
      next(err);
    }
  });

  router.put("/profile/github", async (req, res, next) => {
    try {
      const url = String(req.body?.url || "");
      const current = (await getProfile())?.profile ?? emptyProfile();
      const updated = withGithubUrl(current, url);
      const saved = await saveProfile(updated, Boolean(await getProfile()));
      res.json({ ...saved, exists: true, githubUrl: githubUrlFromProfile(saved.profile) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/profile/files", async (_req, res, next) => {
    try {
      res.json({ files: await listProfileFiles(), mainCv: await getMainCvFile() });
    } catch (err) {
      next(err);
    }
  });

  router.put("/profile/main-cv", async (req, res, next) => {
    try {
      const raw = req.body?.id;
      const id = raw === null || raw === "" ? null : Number(raw);
      if (id !== null && !Number.isInteger(id)) {
        res.status(400).json({ error: "id is required." });
        return;
      }
      const mainCv = await setMainCvFileId(id);
      res.json({ mainCv });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not set main CV.";
      res.status(400).json({ error: message });
    }
  });

  router.post("/profile/files", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded." });
        return;
      }
      const saved = await insertProfileFile({
        filename: req.file.originalname || "upload",
        mime: req.file.mimetype || null,
        content: new Uint8Array(req.file.buffer),
      });
      const asMain = String(req.body?.main || req.query.main || "") === "1" || String(req.body?.main || "") === "true";
      if (asMain || !(await getMainCvFile())) {
        await setMainCvFileId(saved.id);
      }
      res.json({ ...saved, mainCv: await getMainCvFile() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "File upload failed" });
    }
  });

  router.get("/profile/files/:id", async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const file = await getProfileFile(id);
      if (!file) {
        res.status(404).json({ error: "File not found." });
        return;
      }
      res.setHeader("Content-Type", file.mime || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${file.filename.replace(/"/g, "")}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(Buffer.from(file.content));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/profile/files/:id", async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!(await deleteProfileFile(id))) {
        res.status(404).json({ error: "File not found." });
        return;
      }
      res.json({ deleted: id });
    } catch (err) {
      next(err);
    }
  });

  router.post("/profile/files/apply", async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
      if (!ids.length) {
        res.status(400).json({ error: "Select at least one file." });
        return;
      }
      if (ids.length > 8) {
        res.status(400).json({ error: "Apply at most 8 files at a time." });
        return;
      }

      let current = await getProfile();
      const diffs: { filename: string; summary: string }[] = [];

      for (const id of ids) {
        const file = await getProfileFile(id);
        if (!file) {
          res.status(404).json({ error: `File ${id} not found.` });
          return;
        }
        const text = await extractTextFromBuffer(Buffer.from(file.content), file.filename, file.mime || "");
        if (text.trim().length < 40) {
          res.status(400).json({
            error: `"${file.filename}" doesn't contain enough text to update the profile.`,
          });
          return;
        }

        if (!current) {
          const extracted = await extractProfileFromCvText(text);
          current = await saveProfile(extracted, true);
          diffs.push({ filename: file.filename, summary: "Created profile from this file." });
        } else {
          const merged = await mergeProfileUpdate(current.profile, { kind: "cv", content: text });
          current = await saveProfile(merged.profile, true);
          diffs.push({ filename: file.filename, summary: merged.diff.summary });
        }
      }

      res.json({ ...current, exists: true, diffs });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Could not update profile from files" });
    }
  });

  router.post("/profile/from-text", async (req, res) => {
    try {
      const text = String(req.body?.text || "").trim();
      if (text.length < 40) {
        res.status(400).json({ error: "Paste a fuller CV or bio (at least a few sentences)." });
        return;
      }
      const profile = await extractProfileFromCvText(text);
      res.json(await saveProfile(profile, true));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Profile extraction failed" });
    }
  });

  router.post("/profile/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded." });
        return;
      }
      const text = await extractTextFromBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
      const profile = await extractProfileFromCvText(text);
      const saved = await saveProfile(profile, true);
      res.json({ ...saved, extractedChars: text.length });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "CV upload failed" });
    }
  });

  router.post("/profile/supplement", async (req, res) => {
    try {
      const current = await getProfile();
      if (!current) {
        res.status(400).json({ error: "Create a profile first (upload or paste a CV)." });
        return;
      }
      const kind = String(req.body?.kind || "note");
      const content = String(req.body?.content || "").trim();
      if (!content) {
        res.status(400).json({ error: "Content is required." });
        return;
      }
      const merged = await mergeProfileUpdate(current.profile, { kind, content });
      const saved = await saveProfile(merged.profile, true);
      res.json({ ...saved, diff: merged.diff });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Profile update failed" });
    }
  });

  router.post("/profile/chat", async (req, res) => {
    try {
      const current = await getProfile();
      if (!current) {
        res.status(400).json({ error: "Create a profile first." });
        return;
      }
      const message = String(req.body?.message || "").trim();
      if (!message) {
        res.status(400).json({ error: "Message is required." });
        return;
      }
      const merged = await mergeProfileUpdate(current.profile, { kind: "chat", content: message });
      // Preview only — client confirms via PUT or /profile/chat/confirm
      res.json({
        preview: merged.profile,
        diff: merged.diff,
        currentVersion: current.version,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Chat update failed" });
    }
  });

  router.post("/profile/chat/confirm", async (req, res, next) => {
    try {
      const profile = req.body?.profile as SkillProfile | undefined;
      if (!profile) {
        res.status(400).json({ error: "Confirmed profile is required." });
        return;
      }
      res.json(await saveProfile(profile, true));
    } catch (err) {
      next(err);
    }
  });

  async function requireProfile(res: import("express").Response) {
    const current = await getProfile();
    if (!current) {
      res.status(400).json({ error: "Create a skill profile before matching jobs." });
      return null;
    }
    return current;
  }

  router.post("/match/text", async (req, res) => {
    try {
      const current = await requireProfile(res);
      if (!current) return;
      const text = String(req.body?.text || "").trim();
      if (text.length < 40) {
        res.status(400).json({ error: "Paste a fuller job description." });
        return;
      }
      console.log(`match/text ${text.length} chars`);
      const analysis = await analyzeJobMatch(current.profile, text, { source: "pasted text" });
      const row = await insertAnalysis({
        profileVersion: current.version,
        sourceType: "text",
        analysis,
        rawInput: text,
      });
      res.json({ id: row.id, profileVersion: current.version, analysis });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Match analysis failed" });
    }
  });

  router.post("/match/url", async (req, res) => {
    try {
      const current = await requireProfile(res);
      if (!current) return;
      const url = String(req.body?.url || "").trim();
      if (!url) {
        res.status(400).json({ error: "URL is required." });
        return;
      }
      const fetched = await fetchJobUrl(url);
      if (!fetched.ok) {
        res.status(422).json({ error: fetched.error, fallback: "paste", url: fetched.url });
        return;
      }
      const analysis = await analyzeJobMatch(current.profile, fetched.text, { source: fetched.url });
      if (!analysis.jobTitle && fetched.title) analysis.jobTitle = fetched.title;
      const row = await insertAnalysis({
        profileVersion: current.version,
        sourceType: "url",
        sourceRef: fetched.url,
        analysis,
        rawInput: fetched.text,
      });
      res.json({ id: row.id, profileVersion: current.version, analysis, sourceUrl: fetched.url });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "URL match failed" });
    }
  });

  router.post("/match/image", upload.single("image"), async (req, res) => {
    try {
      const current = await requireProfile(res);
      if (!current) return;
      if (!req.file) {
        res.status(400).json({ error: "No image uploaded." });
        return;
      }
      const mime = req.file.mimetype as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
      if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mime)) {
        res.status(400).json({ error: "Use JPEG, PNG, GIF, or WebP images." });
        return;
      }
      const base64 = req.file.buffer.toString("base64");
      const analysis = await analyzeJobFromImage(current.profile, base64, mime);
      const row = await insertAnalysis({
        profileVersion: current.version,
        sourceType: "image",
        sourceRef: req.file.originalname,
        analysis,
        rawInput: analysis.extractedText || null,
      });
      res.json({ id: row.id, profileVersion: current.version, analysis });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Image match failed" });
    }
  });

  router.get("/matches", async (_req, res, next) => {
    try {
      const rows = await listAnalyses();
      const matches = [];
      for (const r of rows) {
        const analysis = JSON.parse(r.analysis_json);
        const versions = await listTailoredCvs(r.id);
        const tailored = versions[0];
        matches.push({
          id: r.id,
          profileVersion: r.profile_version,
          sourceType: r.source_type,
          sourceRef: r.source_ref,
          jobTitle: r.job_title,
          company: r.company,
          score: analysis.score,
          label: analysis.label,
          recommendation: analysis.recommendation,
          createdAt: r.created_at,
          hasTailoredCv: Boolean(tailored),
          tailoredCvCount: versions.length,
          tailoredScore: tailored?.grade_json
            ? (JSON.parse(tailored.grade_json).score as number)
            : null,
          tailoredLabel: tailored?.grade_json
            ? String(JSON.parse(tailored.grade_json).label || "")
            : null,
        });
      }
      res.json({ matches });
    } catch (err) {
      next(err);
    }
  });

  router.get("/matches/:id", async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const row = await getAnalysis(id);
      if (!row) {
        res.status(404).json({ error: "Match not found." });
        return;
      }
      const versions = await listTailoredCvs(id);
      const tailored = versions[0];
      res.json({
        id: row.id,
        profileVersion: row.profile_version,
        sourceType: row.source_type,
        sourceRef: row.source_ref,
        createdAt: row.created_at,
        analysis: JSON.parse(row.analysis_json),
        rawInput: row.raw_input,
        tailored: tailored ? toTailoredPayload(tailored) : null,
        versions: versions.map(toTailoredPayload),
      });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/matches/:id", async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        res.status(400).json({ error: "Invalid match id." });
        return;
      }
      if (!(await getAnalysis(id))) {
        res.status(404).json({ error: "Match not found." });
        return;
      }
      await deleteAnalysis(id);
      res.json({ deleted: id });
    } catch (err) {
      next(err);
    }
  });

  router.post("/matches/:id/tailor", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const row = await getAnalysis(id);
      if (!row) {
        res.status(404).json({ error: "Match not found." });
        return;
      }
      const current = await getProfile();
      if (!current) {
        res.status(400).json({ error: "Profile missing." });
        return;
      }
      const analysis = JSON.parse(row.analysis_json);
      const jobText = row.raw_input || analysis.extractedText || "";
      let baseCvText: string | null = null;
      const mainCv = await getMainCvFile();
      if (mainCv) {
        const file = await getProfileFile(mainCv.id);
        if (file) {
          const text = await extractTextFromBuffer(Buffer.from(file.content), file.filename, file.mime || "");
          if (text.trim().length >= 40) baseCvText = text;
        }
      }
      const generated = await generateTailoredCvContent(current.profile, analysis, jobText, baseCvText);

      // Persist the CV before grading so a grading failure never loses the generated content.
      let saved = await saveTailoredCv({
        analysisId: id,
        diff: generated.diff,
        cv: generated.cv,
      });

      let grade = null;
      let gradeError: string | null = null;
      try {
        grade = await gradeTailoredCv({
          profile: current.profile,
          cv: generated.cv,
          jobText,
          baselineScore: Number(analysis.score) || 0,
          github: generated.github,
        });
        saved = (await updateTailoredCvGrade(saved.id, grade)) ?? saved;
      } catch (err) {
        gradeError = err instanceof Error ? err.message : "Grading failed";
      }

      res.json({
        analysisId: id,
        diff: generated.diff,
        grade,
        gradeError,
        agent: generated.agent,
        downloads: {
          docx: `/api/matches/${id}/cv/docx`,
          pdf: `/api/matches/${id}/cv/pdf`,
        },
        tailored: toTailoredPayload(saved),
        createdAt: saved.created_at,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Tailored CV generation failed" });
    }
  });

  router.post("/matches/:id/grade", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const row = await getAnalysis(id);
      const tailored = await getTailoredCv(id);
      if (!row || !tailored) {
        res.status(404).json({ error: "No tailored CV for this match. Generate one first." });
        return;
      }
      if (!tailored.cv_json) {
        res.status(400).json({ error: "This tailored CV predates grading. Regenerate it to grade." });
        return;
      }
      const current = await getProfile();
      if (!current) {
        res.status(400).json({ error: "Profile missing." });
        return;
      }
      const analysis = JSON.parse(row.analysis_json);
      const github = await fetchGithubEvidence(current.profile);
      const grade = await gradeTailoredCv({
        profile: current.profile,
        cv: JSON.parse(tailored.cv_json),
        jobText: row.raw_input || analysis.extractedText || "",
        baselineScore: Number(analysis.score) || 0,
        github,
      });
      await updateTailoredCvGrade(tailored.id, grade);
      res.json({ analysisId: id, grade });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Grading failed" });
    }
  });

  router.get("/matches/:id/cvs/:cvId/:format", async (req, res, next) => {
    try {
      const cvId = Number(req.params.cvId);
      const tailored = await getTailoredCvById(cvId);
      if (!tailored || tailored.analysis_id !== Number(req.params.id)) {
        res.status(404).json({ error: "No tailored CV for this match." });
        return;
      }
      await sendTailoredDownload(req, res, tailored);
    } catch (err) {
      next(err);
    }
  });

  router.get("/matches/:id/cv/:format", async (req, res, next) => {
    try {
      const tailored = await getTailoredCv(Number(req.params.id));
      if (!tailored) {
        res.status(404).json({ error: "No tailored CV for this match." });
        return;
      }
      await sendTailoredDownload(req, res, tailored);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

async function sendTailoredDownload(
  req: import("express").Request,
  res: import("express").Response,
  tailored: TailoredCvRow
): Promise<void> {
  const wantsPdf = req.params.format === "pdf";
  if (!wantsPdf && req.params.format !== "docx") {
    res.status(404).json({ error: "Use pdf or docx." });
    return;
  }
  if (!tailored.cv_json) {
    res.status(409).json({
      error: "This tailored CV was saved by an older version. Regenerate it to download.",
    });
    return;
  }

  const cv = withGithubLink(
    JSON.parse(tailored.cv_json) as TailoredCvDoc,
    (await getProfile())?.profile ?? emptyProfile()
  );
  const buffer = wantsPdf ? await renderPdf(cv) : await renderDocx(cv);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Type",
    wantsPdf
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="CareerFit-tailored-${tailored.analysis_id}-${tailored.id}.${wantsPdf ? "pdf" : "docx"}"`
  );
  res.send(buffer);
}
