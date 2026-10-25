import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import type { Limiters } from "../../middleware/rateLimit";
import { contentRoutes } from "./content";
import { insightRoutes } from "./insights";
import { mediaRoutes } from "./media";
import { peopleRoutes } from "./people";

/**
 * Everything under /api/v1/admin. Admins and trainers may read; only admins may change anything
 * (each mutating route says so with requireRole("admin")). Writes share one per-user limiter.
 */
export function adminRoutes(l: Limiters): Router {
  const r = Router();
  r.use(requireAuth, l.authenticated, requireRole("admin", "trainer"));
  r.use((req, res, next) => (req.method === "GET" || req.method === "HEAD" ? next() : l.adminWrite(req, res, next)));

  r.use(insightRoutes());
  r.use(peopleRoutes(l));
  r.use(contentRoutes());
  r.use(mediaRoutes(l));
  return r;
}
