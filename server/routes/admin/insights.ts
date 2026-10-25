import { Router } from "express";
import { requireRole } from "../../middleware/auth";
import { activityByDay, courseAnalytics, dashboardStats, listAudit } from "../../services/reports";
import { parse } from "../../utils/validate";
import { analyticsQuery, auditQuery } from "../../validators";

/** Dashboard numbers, analytics and the audit log. */
export function insightRoutes(): Router {
  const r = Router();

  r.get("/dashboard", async (_req, res) => {
    res.json(await dashboardStats());
  });

  r.get("/analytics/courses", async (_req, res) => {
    res.json(await courseAnalytics());
  });

  r.get("/analytics/activity", async (req, res) => {
    const q = parse(analyticsQuery, req.query);
    res.json({ days: q.days, series: await activityByDay(q.days) });
  });

  // Who did what: admins only (it contains staff usernames and IP addresses).
  r.get("/audit", requireRole("admin"), async (req, res) => {
    res.json(await listAudit(parse(auditQuery, req.query)));
  });

  return r;
}
