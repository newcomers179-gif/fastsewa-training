import { once } from "node:events";
import { Router } from "express";
import { normalizeUsername } from "@shared/validation";
import { err } from "../../errors";
import { logger } from "../../logger";
import { requireRole } from "../../middleware/auth";
import type { Limiters } from "../../middleware/rateLimit";
import { eraseAccount } from "../../services/accounts";
import { audit } from "../../services/audit";
import { lookupByNumber, reinstateCertificate, revokeCertificate } from "../../services/certAdmin";
import { broadcastToWorkers } from "../../services/notification";
import {
  createStaff,
  findWorkerForErasure,
  getWorkerDetail,
  iterateWorkers,
  listStaff,
  listWorkers,
  resetStaffPassword,
  resetWorkerPassword,
  updateStaff,
  updateWorker,
} from "../../services/people";
import { csvLine } from "../../services/reports";
import { idParam } from "../../utils/params";
import { parse } from "../../utils/validate";
import {
  broadcastBody,
  certificateLookupQuery,
  confirmUsernameBody,
  revokeBody,
  staffCreateBody,
  staffUpdateBody,
  workerExportQuery,
  workerListQuery,
  workerUpdateBody,
} from "../../validators";

const adminOnly = requireRole("admin");

/** Learners, staff, certificates and outreach. */
export function peopleRoutes(l: Limiters): Router {
  const r = Router();

  // ─── Workers ───────────────────────────────────────────────────────────────
  r.get("/workers", async (req, res) => {
    res.json(await listWorkers(parse(workerListQuery, req.query)));
  });

  // Registered before "/workers/:id" so "export.csv" is not read as an id.
  r.get("/workers/export.csv", adminOnly, l.sensitiveAccount, async (req, res) => {
    const filter = parse(workerExportQuery, req.query);
    await audit(req, "workers.export", { type: "workers" }, { status: filter.status, search: filter.q ?? null });

    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="fastsewa-workers-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    });
    const write = async (chunk: string) => {
      if (!res.write(chunk)) await once(res, "drain");
    };
    try {
      await write("﻿"); // so Excel reads Hindi names as UTF-8
      await write(
        csvLine(["Username", "Name", "Phone", "Email", "Language", "Status", "Joined", "Last login", "Courses enrolled", "Courses completed", "Certificates"])
      );
      for await (const page of iterateWorkers(filter)) {
        if (res.destroyed) return;
        await write(
          page
            .map((w) =>
              csvLine([
                w.username,
                w.displayName,
                w.phoneNumber,
                w.email,
                w.preferredLang,
                w.isActive ? "active" : "inactive",
                w.createdAt,
                w.lastLoginAt,
                w.coursesEnrolled,
                w.coursesCompleted,
                w.certificates,
              ])
            )
            .join("")
        );
      }
      res.end();
    } catch (error) {
      logger.error({ err: error }, "worker export failed part-way");
      res.destroy(); // headers are already out; cutting the connection is the only honest signal
    }
  });

  r.get("/workers/:id", async (req, res) => {
    res.json(await getWorkerDetail(idParam(req, "id", "Worker")));
  });
  // Older consoles asked for "/workers/:id/progress"; same data.
  r.get("/workers/:id/progress", async (req, res) => {
    res.json(await getWorkerDetail(idParam(req, "id", "Worker")));
  });

  r.patch("/workers/:id", adminOnly, async (req, res) => {
    const id = idParam(req, "id", "Worker");
    const patch = parse(workerUpdateBody, req.body);
    const updated = await updateWorker(id, patch);
    await audit(req, "worker.updated", { type: "user", id }, { fields: Object.keys(patch) });
    res.json(updated);
  });

  r.patch("/workers/:id/deactivate", adminOnly, async (req, res) => {
    const id = idParam(req, "id", "Worker");
    await updateWorker(id, { isActive: false });
    await audit(req, "worker.deactivated", { type: "user", id });
    res.json({ message: "Worker deactivated" });
  });

  r.patch("/workers/:id/activate", adminOnly, async (req, res) => {
    const id = idParam(req, "id", "Worker");
    await updateWorker(id, { isActive: true });
    await audit(req, "worker.activated", { type: "user", id });
    res.json({ message: "Worker activated" });
  });

  /** Returns a one-time password (shown once). The worker must choose their own at the next sign-in. */
  r.post("/workers/:id/reset-password", adminOnly, l.sensitiveAccount, async (req, res) => {
    const id = idParam(req, "id", "Worker");
    const result = await resetWorkerPassword(id);
    await audit(req, "worker.password_reset", { type: "user", id });
    res.json({ ...result, mustChangePassword: true });
  });

  /** DPDP erasure on behalf of a worker. The admin must type the worker's username to confirm. */
  r.delete("/workers/:id", adminOnly, l.sensitiveAccount, async (req, res) => {
    const id = idParam(req, "id", "Worker");
    const body = parse(confirmUsernameBody, req.body);
    const worker = await findWorkerForErasure(id);
    if (normalizeUsername(body.confirmUsername) !== worker.username) throw err("CONFIRMATION_MISMATCH");
    await eraseAccount(id);
    await audit(req, "worker.erased", { type: "user", id });
    res.json({ message: "Worker erased" });
  });

  // ─── Staff ─────────────────────────────────────────────────────────────────
  r.get("/staff", adminOnly, async (_req, res) => {
    res.json(await listStaff());
  });

  r.post("/staff", adminOnly, l.sensitiveAccount, async (req, res) => {
    const body = parse(staffCreateBody, req.body);
    const created = await createStaff(body);
    await audit(req, "staff.created", { type: "user", id: created.user.id }, { role: body.role });
    res.status(201).json({ ...created, mustChangePassword: true });
  });

  r.patch("/staff/:id", adminOnly, async (req, res) => {
    const id = idParam(req, "id", "Staff member");
    const patch = parse(staffUpdateBody, req.body);
    const updated = await updateStaff(req.user!.id, id, patch);
    await audit(req, "staff.updated", { type: "user", id }, { fields: Object.keys(patch), role: patch.role ?? null });
    res.json(updated);
  });

  r.post("/staff/:id/reset-password", adminOnly, l.sensitiveAccount, async (req, res) => {
    const id = idParam(req, "id", "Staff member");
    const result = await resetStaffPassword(req.user!.id, id);
    await audit(req, "staff.password_reset", { type: "user", id });
    res.json({ ...result, mustChangePassword: true });
  });

  // ─── Certificates ──────────────────────────────────────────────────────────
  r.get("/certificates/lookup", async (req, res) => {
    const q = parse(certificateLookupQuery, req.query);
    res.json(await lookupByNumber(q.number));
  });

  r.post("/certificates/:id/revoke", adminOnly, async (req, res) => {
    const id = idParam(req, "id", "Certificate");
    const body = parse(revokeBody, req.body);
    const cert = await revokeCertificate(id, body.reason);
    await audit(req, "certificate.revoked", { type: "certificate", id }, { reason: body.reason });
    res.json(cert);
  });

  r.post("/certificates/:id/reinstate", adminOnly, async (req, res) => {
    const id = idParam(req, "id", "Certificate");
    const cert = await reinstateCertificate(id);
    await audit(req, "certificate.reinstated", { type: "certificate", id });
    res.json(cert);
  });

  // ─── Outreach ──────────────────────────────────────────────────────────────
  r.post("/notify/broadcast", adminOnly, l.broadcast, async (req, res) => {
    const body = parse(broadcastBody, req.body);
    const stats = await broadcastToWorkers({ title: body.title, body: body.body });
    await audit(req, "notify.broadcast", { type: "broadcast" }, { title: body.title, devices: stats.devices, sent: stats.sent, failed: stats.failed });
    res.json(stats);
  });

  return r;
}
