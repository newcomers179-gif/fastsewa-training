/**
 * Rate limiting.
 *
 * Keys matter more than numbers here. Construction crews often share one
 * site Wi-Fi or mobile-carrier NAT address, so limiting everything per IP
 * would lock a whole crew out at once. Instead:
 *   - signed-in traffic is limited per *user*;
 *   - login attempts are limited per *username* (and, more loosely, per IP),
 *     counting only failures, so typos never lock out a legitimate user while
 *     a password-guessing run is stopped;
 *   - only anonymous endpoints fall back to the client IP (IPv6 addresses are
 *     grouped by /56 so one machine cannot rotate through its whole prefix).
 *
 * Counters live in Redis when REDIS_URL is set (shared by all instances) and
 * in memory otherwise; a Redis outage degrades to memory instead of failing.
 */
import { createHash } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { MemoryStore, ipKeyGenerator, rateLimit, type ClientRateLimitInfo, type Options, type Store } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { normalizeEmail, normalizeUsername } from "@shared/validation";
import { config } from "../config";
import { rateLimited } from "../errors";
import { logger } from "../logger";
import { getRedis } from "../redis";

type RedisReply = boolean | number | string | (boolean | number | string)[];

class ResilientStore implements Store {
  localKeys = false;
  private readonly memory = new MemoryStore();
  private redisStore: RedisStore | null = null;
  private redisUsable = false;

  constructor(private readonly limiterName: string) {}

  init(options: Options): void {
    this.memory.init(options);

    const redis = getRedis();
    if (!redis) return;
    this.redisStore = new RedisStore({
      prefix: `rl:${this.limiterName}:`,
      sendCommand: (...args: string[]) => redis.call(args[0], ...args.slice(1)) as Promise<RedisReply>,
    });

    const activate = () => {
      // Loads the Lua scripts; (re)runs whenever the connection (re)becomes ready.
      this.redisStore!
        .init(options)
        .then(() => {
          this.redisUsable = true;
        })
        .catch((error: unknown) => {
          this.redisUsable = false;
          logger.warn({ err: error, limiter: this.limiterName }, "rate-limit redis init failed; using memory");
        });
    };
    if (redis.status === "ready") activate();
    redis.on("ready", activate);
    redis.on("end", () => {
      this.redisUsable = false;
    });
    redis.on("close", () => {
      this.redisUsable = false;
    });
  }

  private async viaRedis<T>(fn: (store: RedisStore) => Promise<T>): Promise<T | undefined> {
    if (!this.redisUsable || !this.redisStore) return undefined;
    try {
      return await fn(this.redisStore);
    } catch (error) {
      this.redisUsable = false; // re-armed on the next 'ready'
      logger.warn({ err: error, limiter: this.limiterName }, "rate-limit redis call failed; using memory");
      return undefined;
    }
  }

  async increment(key: string) {
    return (await this.viaRedis((s) => s.increment(key))) ?? this.memory.increment(key);
  }

  async decrement(key: string): Promise<void> {
    const done = await this.viaRedis(async (s) => {
      await s.decrement(key);
      return true;
    });
    if (!done) this.memory.decrement(key);
  }

  async resetKey(key: string): Promise<void> {
    const done = await this.viaRedis(async (s) => {
      await s.resetKey(key);
      return true;
    });
    if (!done) this.memory.resetKey(key);
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    return (await this.viaRedis((s) => s.get(key))) ?? this.memory.get(key);
  }

  shutdown(): void {
    this.memory.shutdown();
  }
}

// ─── key generators ─────────────────────────────────────────────────────────
const sha = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);

export const ipKey = (req: Request) => `ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
export const userOrIpKey = (req: Request) => (req.user ? `u:${req.user.id}` : ipKey(req));

function bodyString(req: Request, field: string): string {
  const v = (req.body as Record<string, unknown> | undefined)?.[field];
  return typeof v === "string" ? v : "";
}

export const usernameKey = (req: Request) => `un:${sha(normalizeUsername(bodyString(req, "username")))}`;
export const emailKey = (req: Request) => `em:${sha(normalizeEmail(bodyString(req, "email")))}`;

// ─── factory ────────────────────────────────────────────────────────────────
interface LimiterOptions {
  name: string;
  windowMs: number;
  limit: number;
  key: (req: Request) => string;
  /** Count only responses with status >= 400 (used for login). */
  failuresOnly?: boolean;
  message?: string;
}

const passthrough: RequestHandler = (_req, _res, next) => next();

export function createLimiter(opts: LimiterOptions): RequestHandler {
  if (!config.rateLimitEnabled) return passthrough;
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: opts.failuresOnly ?? false,
    keyGenerator: opts.key,
    store: new ResilientStore(opts.name),
    // express-rate-limit's own proxy/IPv6 diagnostics are valuable in production; noisy in tests.
    validate: config.isTest ? false : undefined,
    handler: (req, _res, next) => {
      const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
      const seconds = resetTime ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000)) : Math.ceil(opts.windowMs / 1000);
      next(rateLimited(seconds, opts.message));
    },
  });
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * The limits. Tuned for a shared-Wi-Fi workforce (see header comment); every
 * one of them is generous for a human and tiny for a script.
 */
export function buildLimiters() {
  return {
    /** Anonymous traffic overall, per IP. */
    anonymous: createLimiter({ name: "anon", windowMs: MIN, limit: 240, key: ipKey }),
    /** Signed-in traffic overall, per user (video progress saves every ~10 s ≈ 6/min). */
    authenticated: createLimiter({ name: "user", windowMs: MIN, limit: 300, key: userOrIpKey }),

    loginByUser: createLimiter({ name: "login-user", windowMs: 15 * MIN, limit: 8, key: usernameKey, failuresOnly: true }),
    loginByIp: createLimiter({ name: "login-ip", windowMs: 15 * MIN, limit: 60, key: ipKey, failuresOnly: true }),
    register: createLimiter({ name: "register", windowMs: HOUR, limit: 40, key: ipKey }),
    refresh: createLimiter({ name: "refresh", windowMs: 15 * MIN, limit: 300, key: ipKey }),
    forgotByEmail: createLimiter({ name: "forgot-email", windowMs: HOUR, limit: 3, key: emailKey }),
    forgotByIp: createLimiter({ name: "forgot-ip", windowMs: HOUR, limit: 15, key: ipKey }),
    resetByIp: createLimiter({ name: "reset-ip", windowMs: 15 * MIN, limit: 20, key: ipKey }),
    sensitiveAccount: createLimiter({ name: "account", windowMs: 15 * MIN, limit: 10, key: userOrIpKey }),

    quizSubmit: createLimiter({ name: "quiz", windowMs: 10 * MIN, limit: 30, key: userOrIpKey }),
    certificate: createLimiter({ name: "cert", windowMs: 10 * MIN, limit: 30, key: userOrIpKey }),
    publicVerify: createLimiter({ name: "verify", windowMs: MIN, limit: 60, key: ipKey }),
    adminWrite: createLimiter({ name: "admin-write", windowMs: MIN, limit: 120, key: userOrIpKey }),
    mediaSign: createLimiter({ name: "media", windowMs: 10 * MIN, limit: 60, key: userOrIpKey }),
    broadcast: createLimiter({ name: "broadcast", windowMs: HOUR, limit: 10, key: userOrIpKey }),
  };
}

export type Limiters = ReturnType<typeof buildLimiters>;
