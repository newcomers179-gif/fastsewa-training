import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { purgeSessions } from "./auth/sessions";
import { createApp } from "./app";
import { config } from "./config";
import { checkDatabase, closeDatabase } from "./db";
import { APP_VERSION, setDraining } from "./health";
import { logger } from "./logger";
import { closeRedis } from "./redis";
import { purgePendingUploads } from "./services/media";

const SHUTDOWN_GRACE_MS = 25_000;
/** After SIGTERM, keep serving while readiness fails so the load balancer notices and drains us. */
const DRAIN_DELAY_MS = config.isProd ? 5_000 : 0;
const JANITOR_INTERVAL_MS = 6 * 60 * 60 * 1000;

function startupWarnings(): void {
  if (config.auth.jwtSecretIsDevDefault) {
    logger.warn("using the built-in development JWT secret — fine on a laptop, never on a server (set JWT_SECRET)");
  }
  if (config.media.provider === "none") {
    logger.warn("no media storage configured: lesson uploads are disabled (YouTube links still work)");
  }
  if (!config.redisUrl && config.isProd) {
    logger.warn("REDIS_URL is not set: rate-limit counters are per process (correct for one instance, weak across several)");
  }
  if (!config.smtp) {
    logger.warn("SMTP is not configured: password reset by e-mail is unavailable (admins can still issue temporary passwords)");
  }
  if (config.registration.mode === "open" && config.isProd) {
    logger.warn("REGISTRATION_MODE=open: anyone who can reach the API can create a worker account");
  }
}

/** Housekeeping that must run somewhere, forever: expired sessions and abandoned upload tickets. Idempotent, so every instance may run it. */
function startJanitors(): void {
  const run = async () => {
    try {
      const sessions = await purgeSessions();
      const uploads = await purgePendingUploads();
      if (sessions + uploads > 0) logger.info({ sessions, uploads }, "housekeeping removed stale rows");
    } catch (error) {
      logger.warn({ err: error }, "housekeeping failed (will retry)");
    }
  };
  setTimeout(run, 60_000).unref();
  setInterval(run, JANITOR_INTERVAL_MS).unref();
}

async function main(): Promise<void> {
  const database = await checkDatabase(5000);
  if (!database.ok) {
    // Do not crash-loop: readiness reports 503 until the database is reachable, and the pool reconnects by itself.
    logger.error({ error: database.error }, "database is not reachable at start-up; the API will answer 503 until it is");
  }

  const app = createApp();
  const server = createServer(app);
  // Longer than common load-balancer idle timeouts (60 s), otherwise the balancer reuses sockets we already closed.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  // Local-provider video uploads can take a while on a site connection.
  server.requestTimeout = 10 * 60_000;

  let shuttingDown = false;
  const shutdown = async (reason: string, exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ reason }, "shutting down");
    setDraining();

    const force = setTimeout(() => {
      logger.error("graceful shutdown timed out; closing remaining connections");
      server.closeAllConnections();
      process.exit(exitCode || 1);
    }, SHUTDOWN_GRACE_MS);
    force.unref();

    if (DRAIN_DELAY_MS > 0) await sleep(DRAIN_DELAY_MS);
    await new Promise<void>((resolve) => {
      server.close(() => resolve()); // stops accepting; resolves when in-flight requests finish
      server.closeIdleConnections();
    });
    await Promise.allSettled([closeDatabase(), closeRedis()]);
    logger.info("bye");
    process.exit(exitCode);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM", 0));
  process.on("SIGINT", () => void shutdown("SIGINT", 0));
  // A rejected promise nobody awaited is a bug to fix, but it must not take the API down for every worker.
  process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "unhandled promise rejection"));
  // State after an uncaught exception is unknown: stop taking traffic and let the orchestrator restart us.
  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "uncaught exception");
    void shutdown("uncaughtException", 1);
  });

  server.on("error", (error) => {
    logger.fatal({ err: error }, "server error");
    void shutdown("server error", 1);
  });

  server.listen(config.port, config.host, () => {
    logger.info({ port: config.port, host: config.host, version: APP_VERSION }, "FastSewa API listening");
    startupWarnings();
    startJanitors();
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, "failed to start");
  process.exit(1);
});
