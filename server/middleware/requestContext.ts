import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { logger } from "../logger";

const ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Gives every request a correlation id (honouring a sane incoming
 * X-Request-Id, e.g. from the load balancer) and writes one structured access
 * log line when it finishes. Query strings are never logged (they can carry
 * signed-link signatures), and routes are logged as patterns, not raw paths.
 */
export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.header("x-request-id");
  req.id = incoming && ID_RE.test(incoming) ? incoming : randomUUID();
  res.setHeader("X-Request-Id", req.id);
  req.log = logger.child({ reqId: req.id });

  const started = process.hrtime.bigint();
  res.on("finish", () => {
    const status = res.statusCode;
    const url = req.originalUrl;
    const isHealth = url.startsWith("/api/health");
    const isApi = url.startsWith("/api") || url.startsWith("/verify");
    if ((isHealth && status < 400) || (!isApi && status < 400)) return;

    const entry = {
      method: req.method,
      route: req.route?.path ? `${req.baseUrl}${req.route.path}` : "(unmatched)",
      status,
      ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
      ip: req.ip,
      userId: req.user?.id,
      bytes: Number(res.getHeader("content-length")) || undefined,
    };
    if (status >= 500) req.log.error(entry, "request");
    else if (status >= 400) req.log.warn(entry, "request");
    else req.log.info(entry, "request");
  });
  next();
};
