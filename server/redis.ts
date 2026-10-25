import Redis from "ioredis";
import { config } from "./config";
import { logger } from "./logger";

/**
 * Optional Redis connection, used only for rate-limit counters shared between
 * several API instances. Redis being unreachable must never take the API
 * down: commands fail fast (no offline queue) and the limiter falls back to
 * per-process counters until the connection is back.
 */
let client: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  if (!config.redisUrl) {
    client = null;
    return client;
  }

  const redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 5000,
    retryStrategy: (attempt) => Math.min(attempt * 500, 10_000),
  });

  let lastLogged = 0;
  redis.on("error", (error) => {
    const now = Date.now();
    if (now - lastLogged > 30_000) {
      lastLogged = now;
      logger.warn({ err: error }, "redis unavailable: rate limiting falls back to in-memory counters");
    }
  });
  redis.on("ready", () => logger.info("redis connected"));

  client = redis;
  return client;
}

export function redisStatus(): "disabled" | "ready" | "unavailable" {
  if (!config.redisUrl) return "disabled";
  return client?.status === "ready" ? "ready" : "unavailable";
}

export async function closeRedis(): Promise<void> {
  if (client) {
    const c = client;
    client = undefined;
    try {
      await c.quit();
    } catch {
      c.disconnect();
    }
  }
}
