import type { RequestHandler } from "express";
import { config } from "../config";

/**
 * Strict allow-list CORS. The mobile app is not subject to CORS at all and
 * the admin console is served from the API's own origin; this exists for
 * browser clients on other origins (the Expo web build, local development).
 * Authentication uses bearer tokens, never cookies, so credentials are not
 * enabled.
 */
export function cors(): RequestHandler {
  const allowed = new Set(config.corsOrigins);
  return (req, res, next) => {
    const origin = req.header("origin");
    if (origin && allowed.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.vary("Origin");
      res.setHeader("Access-Control-Expose-Headers", "X-Request-Id, X-Total-Count, Retry-After");
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id");
        res.setHeader("Access-Control-Max-Age", "600");
      }
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  };
}
