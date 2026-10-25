import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { Router } from "express";
import multer from "multer";
import { config } from "../../config";
import { err } from "../../errors";
import { requireRole } from "../../middleware/auth";
import type { Limiters } from "../../middleware/rateLimit";
import { audit } from "../../services/audit";
import { completeUpload, createUploadTicket, finalizeLocalUpload, getLocalTicket, localTmpDir, uploadsAvailable } from "../../services/media";
import { originOf } from "../../utils/origin";
import { idParam } from "../../utils/params";
import { parse } from "../../utils/validate";
import { mediaCompleteBody, mediaSignBody } from "../../validators";

const adminOrTrainer = requireRole("admin", "trainer");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    mkdir(localTmpDir(), { recursive: true }).then(
      () => cb(null, localTmpDir()),
      (error: Error) => cb(error, "")
    );
  },
  // The client's file name is never used: the stored name is random and its extension is chosen from the real content.
  filename: (_req, _file, cb) => cb(null, randomBytes(16).toString("hex")),
});
const limitsFor = (maxBytes: number) => ({ fileSize: maxBytes, files: 1, fields: 4, parts: 6 });
const imageUpload = multer({ storage, limits: limitsFor(config.media.maxImageBytes) }).single("file");
const videoUpload = multer({ storage, limits: limitsFor(config.media.maxVideoBytes) }).single("file");

/**
 * Direct uploads. The API never carries video bytes for S3/R2 or Cloudinary: it signs a short-lived
 * target (`/media/sign`), the browser uploads straight to the storage, then `/media/complete`
 * verifies the object. The `local` provider (development / single server) receives the file here.
 */
export function mediaRoutes(l: Limiters): Router {
  const r = Router();

  r.get("/media/config", adminOrTrainer, (_req, res) => {
    res.json({
      enabled: uploadsAvailable(),
      provider: config.media.provider,
      maxImageBytes: config.media.maxImageBytes,
      maxVideoBytes: config.media.maxVideoBytes,
      imageTypes: ["image/jpeg", "image/png", "image/webp"],
      videoTypes: ["video/mp4", "video/webm", "video/quicktime"],
    });
  });

  r.post("/media/sign", adminOrTrainer, l.mediaSign, async (req, res) => {
    const body = parse(mediaSignBody, req.body);
    const ticket = await createUploadTicket(req.user!, body);
    await audit(req, "media.upload_started", { type: "upload", id: ticket.uploadId }, { kind: body.kind, bytes: body.bytes });
    res.json(ticket);
  });

  r.post("/media/complete", adminOrTrainer, l.mediaSign, async (req, res) => {
    const body = parse(mediaCompleteBody, req.body);
    res.json(await completeUpload(req.user!, body));
  });

  // Local provider only: the browser posts the file here (multipart/form-data, field "file").
  r.post("/media/upload/:uploadId", adminOrTrainer, l.mediaSign, async (req, res, next) => {
    try {
      const ticket = await getLocalTicket(req.user!, idParam(req, "uploadId", "Upload"));
      const receive = ticket.kind === "image" ? imageUpload : videoUpload;
      receive(req, res, async (error?: unknown) => {
        if (error) {
          next(error);
          return;
        }
        try {
          if (!req.file) throw err("VALIDATION_ERROR", { message: "No file received (send it as the multipart field “file”)" });
          const result = await finalizeLocalUpload(ticket, req.file, originOf(req));
          await audit(req, "media.uploaded", { type: "upload", id: ticket.id }, { kind: ticket.kind, bytes: req.file.size });
          res.json(result);
        } catch (failure) {
          next(failure);
        }
      });
    } catch (failure) {
      next(failure);
    }
  });

  return r;
}
