import { existsSync } from "node:fs";
import { join } from "node:path";
import compression from "compression";
import express, { type Express, type RequestHandler } from "express";
import helmet from "helmet";
import { config } from "./config";
import { healthRoutes } from "./health";
import { logger } from "./logger";
import { cors } from "./middleware/cors";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { buildLimiters, type Limiters } from "./middleware/rateLimit";
import { requestContext } from "./middleware/requestContext";
import { ADMIN_DIST_DIR } from "./paths";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { certificatesRoutes } from "./routes/certificates";
import { configRoutes } from "./routes/config";
import { coursesRoutes } from "./routes/courses";
import { progressRoutes } from "./routes/progress";
import { quizRoutes } from "./routes/quiz";
import { verifyApiRoutes, verifyPageRoutes } from "./routes/verify";
import { uploadOrigins } from "./services/media";

/** The admin console is a static single page; it may only run its own scripts and talk to this API and the upload targets. */
function adminCsp(): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob: https:", // blob: previews a picked file
    "media-src 'self' blob: https:", // blob: lets the console read a chosen video's length before upload
    "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
    `connect-src ${["'self'", ...uploadOrigins()].join(" ")}`,
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join("; ");
}

const apiHeaders: RequestHandler = (_req, res, next) => {
  // API answers are personal and change constantly: never cache them, and never let a browser render them.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  next();
};

export function createApp(limiters: Limiters = buildLimiters()): Express {
  const l = limiters;
  const app = express();

  app.set("trust proxy", config.trustProxy);
  app.set("etag", false);
  app.disable("x-powered-by");

  app.use(requestContext);
  app.use(
    helmet({
      // Set per route group below (API, admin console, verify page, uploads each need a different policy).
      contentSecurityPolicy: false,
      // Media and API answers are fetched cross-origin by the Expo web build and by CDNs.
      crossOriginResourcePolicy: { policy: "cross-origin" },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: "no-referrer" },
      strictTransportSecurity: config.isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    })
  );
  app.use(compression());

  // ─── operational endpoints ─────────────────────────────────────────────────
  app.use("/api/health", healthRoutes());

  app.get("/", (_req, res) => {
    res.json({ service: "fastsewa-api", health: "/api/health" });
  });

  // ─── static: uploaded media (local provider only) ──────────────────────────
  if (config.media.provider === "local") {
    app.use(
      "/uploads",
      (req, res, next) => (req.path.startsWith("/_tmp") ? res.status(404).end() : next()),
      express.static(config.media.localDir, {
        index: false,
        dotfiles: "ignore",
        maxAge: "30d", // object names are random and never reused
        immutable: true,
        setHeaders: (res) => {
          res.setHeader("X-Content-Type-Options", "nosniff");
          res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
        },
      })
    );
  }

  // ─── static: admin console ─────────────────────────────────────────────────
  if (config.adminConsoleEnabled) {
    if (!existsSync(join(ADMIN_DIST_DIR, "index.html"))) {
      logger.warn({ dir: ADMIN_DIST_DIR }, "admin console is enabled but not built (run `npm run admin:build`)");
    }
    const csp = adminCsp();
    app.use(
      "/admin",
      (_req, res, next) => {
        res.setHeader("Content-Security-Policy", csp);
        next();
      },
      express.static(ADMIN_DIST_DIR, {
        index: "index.html",
        dotfiles: "ignore",
        setHeaders: (res, path) => {
          // The page itself must be re-fetched (it names the hashed assets); the hashed assets never change.
          res.setHeader("Cache-Control", path.endsWith(".html") ? "no-cache" : "public, max-age=31536000, immutable");
        },
      })
    );
  }

  // ─── public pages ──────────────────────────────────────────────────────────
  app.use("/verify", verifyPageRoutes(l));

  // ─── API ───────────────────────────────────────────────────────────────────
  const small = express.json({ limit: "20kb" });
  app.use("/api", cors(), apiHeaders);
  app.use("/api/v1/config", configRoutes(l));
  app.use("/api/v1/verify", verifyApiRoutes(l));
  app.use("/api/v1/auth", small, authRoutes(l));
  app.use("/api/v1/courses", small, coursesRoutes(l));
  app.use("/api/v1/progress", small, progressRoutes(l));
  app.use("/api/v1/quiz", express.json({ limit: "50kb" }), quizRoutes(l));
  app.use("/api/v1/certificates", certificatesRoutes(l));
  // Lesson text and quizzes can be long (Devanagari takes 3 bytes per character).
  app.use("/api/v1/admin", express.json({ limit: "1mb" }), adminRoutes(l));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

