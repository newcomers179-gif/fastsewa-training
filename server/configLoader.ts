/**
 * Central, validated configuration (pure loader — no side effects, easy to unit-test).
 *
 * Every environment variable the API reads is parsed here, once, at start-up.
 * In production a missing or unsafe value (no JWT secret, a placeholder
 * secret, a half-configured media provider, ...) aborts the boot with a clear
 * list of what to fix — the previous code silently fell back to a hard-coded
 * "dev-secret-change-in-production" JWT secret, which would have let anybody
 * forge admin tokens on a mis-configured deployment.
 */
import { join } from "node:path";
import { z } from "zod";

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      `Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}\n` +
        "See .env.example for every setting."
    );
    this.name = "ConfigError";
  }
}

export const UNCONFIGURED_TEST_DATABASE_URL = "postgresql://postgres@127.0.0.1:1/fastsewa_test_unconfigured";
const DEV_JWT_SECRET = "dev-only-secret-never-use-in-production-0123456789abcdef";
// Addresses nobody can reach from a phone. A copied .env.example (api.example.com) or a leftover local address
// would otherwise boot happily and print unusable QR codes on every certificate.
const PLACEHOLDER_HOST = /(^|\.)example\.(com|org|net)$|^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;
const PLACEHOLDER_SECRETS = [
  "dev-secret-change-in-production",
  "change_me",
  "changeme",
  "change-me",
  "your_secret",
  "your-secret",
  "secret",
  "password",
];

type NodeEnv = "development" | "test" | "production";
type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
export type MediaProvider = "s3" | "cloudinary" | "local" | "none";

export interface Config {
  env: NodeEnv;
  isProd: boolean;
  isTest: boolean;
  isDev: boolean;
  port: number;
  host: string;
  logLevel: LogLevel;
  /** Public https origin of the API, e.g. https://api.example.com (no trailing slash). */
  publicBaseUrl: string | null;
  trustProxy: boolean | number | string;
  corsOrigins: string[];
  adminConsoleEnabled: boolean;
  db: {
    url: string;
    ssl: "disable" | "require" | "verify";
    sslCa: string | null;
    poolMax: number;
    statementTimeoutMs: number;
    connectTimeoutMs: number;
  };
  redisUrl: string | null;
  auth: {
    jwtSecret: string;
    jwtSecretIsDevDefault: boolean;
    jwtSecretsPrevious: string[];
    accessTtlSeconds: number;
    refreshTtlDays: number;
    sessionMaxDays: number;
    userCacheTtlMs: number;
  };
  registration: { mode: "open" | "code" | "closed"; code: string | null };
  legal: {
    consentVersion: string;
    privacyPolicyUrl: string | null;
    termsUrl: string | null;
    supportEmail: string | null;
    supportPhone: string | null;
  };
  smtp: { host: string; port: number; user: string; password: string; from: string } | null;
  media: {
    provider: MediaProvider;
    s3: {
      bucket: string;
      region: string;
      endpoint: string | null;
      forcePathStyle: boolean;
    } | null;
    cloudinary: { cloudName: string; apiKey: string; apiSecret: string } | null;
    localDir: string;
    /** CDN / public bucket origin that objects are served from. */
    publicBaseUrl: string | null;
    extraAllowedHosts: string[];
    maxImageBytes: number;
    maxVideoBytes: number;
  };
  push: { expoAccessToken: string | null };
  rateLimitEnabled: boolean;
}

// ─── helpers ────────────────────────────────────────────────────────────────
const blank = (v: unknown) => v === undefined || v === null || String(v).trim() === "";
const str = z.preprocess((v) => (blank(v) ? undefined : String(v).trim()), z.string().optional());
const bool = (def: boolean) =>
  z.preprocess(
    (v) => (blank(v) ? def : ["1", "true", "yes", "on"].includes(String(v).trim().toLowerCase())),
    z.boolean()
  );
const int = (def: number, min: number, max: number) =>
  z.preprocess((v) => (blank(v) ? def : Number(v)), z.number().int().min(min).max(max));
const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: int(5000, 1, 65535),
  HOST: str,
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
  PUBLIC_BASE_URL: str,
  TRUST_PROXY: str,
  ALLOWED_ORIGINS: str,
  ADMIN_CONSOLE_ENABLED: bool(true),

  DATABASE_URL: str,
  TEST_DATABASE_URL: str,
  DATABASE_SSL: z.enum(["disable", "require", "verify"]).optional(),
  DATABASE_SSL_CA: str,
  DB_POOL_MAX: int(10, 1, 100),
  DB_STATEMENT_TIMEOUT_MS: int(15_000, 1000, 300_000),
  DB_CONNECT_TIMEOUT_MS: int(5_000, 500, 60_000),
  REDIS_URL: str,

  JWT_SECRET: str,
  JWT_SECRET_PREVIOUS: str,
  ACCESS_TOKEN_TTL_MINUTES: int(15, 1, 120),
  REFRESH_TOKEN_TTL_DAYS: int(30, 1, 365),
  SESSION_MAX_DAYS: int(90, 1, 730),
  AUTH_CACHE_TTL_MS: z.preprocess((v) => (blank(v) ? undefined : Number(v)), z.number().int().min(0).max(60_000).optional()),

  REGISTRATION_MODE: z.enum(["open", "code", "closed"]).default("open"),
  REGISTRATION_CODE: str,
  CONSENT_VERSION: z.preprocess((v) => (blank(v) ? "1" : String(v).trim()), z.string().max(40)),
  PRIVACY_POLICY_URL: str,
  TERMS_URL: str,
  SUPPORT_EMAIL: str,
  SUPPORT_PHONE: str,

  SMTP_HOST: str,
  SMTP_PORT: str,
  SMTP_USER: str,
  SMTP_PASSWORD: str,
  SMTP_FROM: str,

  MEDIA_PROVIDER: z.enum(["s3", "cloudinary", "local", "none"]).optional(),
  MEDIA_PUBLIC_BASE_URL: str,
  MEDIA_ALLOWED_HOSTS: str,
  MAX_IMAGE_MB: int(10, 1, 100),
  MAX_VIDEO_MB: int(500, 1, 5000),
  UPLOADS_DIR: str,
  AWS_S3_BUCKET: str,
  AWS_REGION: str,
  S3_ENDPOINT: str,
  S3_FORCE_PATH_STYLE: bool(false),
  CLOUDINARY_CLOUD_NAME: str,
  CLOUDINARY_API_KEY: str,
  CLOUDINARY_API_SECRET: str,

  EXPO_ACCESS_TOKEN: str,
  RATE_LIMIT_DISABLED: bool(false),
});

function isHttpUrl(v: string, requireHttps: boolean): boolean {
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && !requireHttps)) return false;
    return !!u.hostname;
  } catch {
    return false;
  }
}

function parseTrustProxy(raw: string | undefined, isProd: boolean, problems: string[]): boolean | number | string {
  // `trust proxy` decides which X-Forwarded-For entries Express believes. Too
  // permissive and clients can spoof their IP (defeating rate limits); too
  // strict and every user appears to share the proxy's IP. So it is explicit.
  if (raw === undefined) return isProd ? 1 : false;
  const v = raw.trim();
  if (v === "false" || v === "0") return false;
  if (v === "true") {
    problems.push(
      'TRUST_PROXY=true trusts every X-Forwarded-For hop and lets clients spoof their IP. Use the number of proxies in front of the API (e.g. 1 for nginx or a platform load balancer), or a list of proxy subnets.'
    );
    return false;
  }
  if (/^\d+$/.test(v)) return Number(v);
  return v; // "loopback, 10.0.0.0/8" etc. — validated by Express
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.map(String).join(".") || "env"}: ${i.message}`)
    );
  }
  const e = parsed.data;
  const problems: string[] = [];
  const warn: string[] = [];

  const nodeEnv = e.NODE_ENV as NodeEnv;
  const isProd = nodeEnv === "production";
  const isTest = nodeEnv === "test";
  const isDev = nodeEnv === "development";

  // ── database ──────────────────────────────────────────────────────────────
  // Tests TRUNCATE tables, so a test run must never fall back to DATABASE_URL. Without
  // TEST_DATABASE_URL the placeholder (a closed port) lets database-free unit tests load the
  // configuration, while anything that touches the database fails fast and loudly.
  let dbUrl = isTest ? (e.TEST_DATABASE_URL ?? UNCONFIGURED_TEST_DATABASE_URL) : e.DATABASE_URL;
  if (!dbUrl) problems.push("DATABASE_URL is required (postgresql://user:password@host:5432/dbname).");
  let sslMode: Config["db"]["ssl"] | undefined = e.DATABASE_SSL;
  if (dbUrl) {
    try {
      const u = new URL(dbUrl);
      if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error("not a postgres url");
      // node-postgres interprets `sslmode=require` as full certificate
      // verification (and prints a deprecation warning); we take control of
      // TLS ourselves through DATABASE_SSL and strip the URL parameters.
      const urlMode = u.searchParams.get("sslmode");
      if (!sslMode && urlMode) {
        sslMode =
          urlMode === "disable"
            ? "disable"
            : urlMode === "verify-ca" || urlMode === "verify-full"
              ? "verify"
              : "require";
      }
      for (const k of ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) {
        u.searchParams.delete(k);
      }
      dbUrl = u.toString();
      if (!sslMode) {
        const local = /^(localhost|127\.0\.0\.1|\[::1\]|db|postgres)$/.test(u.hostname);
        sslMode = local ? "disable" : isProd ? "verify" : "require";
      }
    } catch {
      problems.push("DATABASE_URL is not a valid postgresql:// URL.");
    }
  }
  if (isProd && sslMode === "require") {
    warn.push(
      "DATABASE_SSL=require encrypts the database connection but does not verify the server certificate. Use DATABASE_SSL=verify (add DATABASE_SSL_CA for a private CA such as AWS RDS) when your provider supports it."
    );
  }

  // ── auth ──────────────────────────────────────────────────────────────────
  let jwtSecret = e.JWT_SECRET;
  let jwtIsDev = false;
  if (!jwtSecret) {
    if (isProd) {
      problems.push(
        "JWT_SECRET is required in production (at least 32 random characters). Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
      );
    }
    jwtSecret = DEV_JWT_SECRET;
    jwtIsDev = true;
  } else if (isProd) {
    if (jwtSecret.length < 32) problems.push("JWT_SECRET must be at least 32 characters in production.");
    if (PLACEHOLDER_SECRETS.some((p) => jwtSecret!.toLowerCase().includes(p))) {
      problems.push("JWT_SECRET still looks like a placeholder value. Generate a random one.");
    }
    if (jwtSecret === DEV_JWT_SECRET) problems.push("JWT_SECRET must not be the development default.");
  }
  const previous = list(e.JWT_SECRET_PREVIOUS);
  if (isProd && previous.some((s) => s.length < 32)) {
    problems.push("Every secret in JWT_SECRET_PREVIOUS must be at least 32 characters.");
  }

  // ── public URL / CORS / proxy ─────────────────────────────────────────────
  let publicBaseUrl: string | null = null;
  if (e.PUBLIC_BASE_URL) {
    if (!isHttpUrl(e.PUBLIC_BASE_URL, isProd)) {
      problems.push(
        `PUBLIC_BASE_URL must be an ${isProd ? "https" : "http(s)"} URL such as https://api.example.com.`
      );
    } else {
      publicBaseUrl = e.PUBLIC_BASE_URL.replace(/\/+$/, "");
      if (isProd && PLACEHOLDER_HOST.test(new URL(publicBaseUrl).hostname)) {
        problems.push(
          `PUBLIC_BASE_URL (${publicBaseUrl}) is still a placeholder or a local address. Use the real public https address of the API: it is printed into every certificate.`
        );
      }
    }
  } else if (isProd) {
    problems.push(
      "PUBLIC_BASE_URL is required in production — it is embedded in certificate QR codes and download links (e.g. https://api.example.com)."
    );
  }

  const corsOrigins = list(e.ALLOWED_ORIGINS);
  if (corsOrigins.includes("*")) problems.push("ALLOWED_ORIGINS must list explicit origins, not '*'.");
  for (const o of corsOrigins) {
    if (o !== "*" && !isHttpUrl(o, false)) problems.push(`ALLOWED_ORIGINS contains an invalid origin: ${o}`);
  }
  const trustProxy = parseTrustProxy(e.TRUST_PROXY, isProd, problems);

  // ── registration ──────────────────────────────────────────────────────────
  if (e.REGISTRATION_MODE === "code" && (!e.REGISTRATION_CODE || e.REGISTRATION_CODE.length < 6)) {
    problems.push("REGISTRATION_MODE=code needs REGISTRATION_CODE (at least 6 characters).");
  }
  for (const [k, v] of [
    ["PRIVACY_POLICY_URL", e.PRIVACY_POLICY_URL],
    ["TERMS_URL", e.TERMS_URL],
  ] as const) {
    if (v && !isHttpUrl(v, isProd)) problems.push(`${k} must be a valid URL.`);
  }

  // ── e-mail ────────────────────────────────────────────────────────────────
  const smtpParts = [e.SMTP_HOST, e.SMTP_PORT, e.SMTP_USER, e.SMTP_PASSWORD];
  const smtpSet = smtpParts.filter(Boolean).length;
  let smtp: Config["smtp"] = null;
  if (smtpSet > 0 && smtpSet < 4) {
    problems.push("SMTP is half-configured: set all of SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD, or none.");
  } else if (smtpSet === 4) {
    const port = Number(e.SMTP_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push("SMTP_PORT must be a port number.");
    smtp = {
      host: e.SMTP_HOST!,
      port,
      user: e.SMTP_USER!,
      password: e.SMTP_PASSWORD!,
      from: e.SMTP_FROM || "FastSewa <no-reply@fastsewa.app>",
    };
  }

  // ── media ─────────────────────────────────────────────────────────────────
  const hasCloudinary = !!(e.CLOUDINARY_CLOUD_NAME || e.CLOUDINARY_API_KEY || e.CLOUDINARY_API_SECRET);
  const hasS3 = !!e.AWS_S3_BUCKET;
  let provider: MediaProvider = e.MEDIA_PROVIDER ?? (hasS3 ? "s3" : hasCloudinary ? "cloudinary" : isProd ? "none" : "local");
  let s3: Config["media"]["s3"] = null;
  let cloudinary: Config["media"]["cloudinary"] = null;
  if (provider === "s3") {
    if (!e.AWS_S3_BUCKET) problems.push("MEDIA_PROVIDER=s3 needs AWS_S3_BUCKET.");
    s3 = {
      bucket: e.AWS_S3_BUCKET ?? "",
      region: e.AWS_REGION ?? "ap-south-1",
      endpoint: e.S3_ENDPOINT ?? null,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
    };
    if (isProd && !e.MEDIA_PUBLIC_BASE_URL && e.S3_ENDPOINT) {
      problems.push("A custom S3_ENDPOINT (e.g. Cloudflare R2) needs MEDIA_PUBLIC_BASE_URL — the public/CDN URL the uploaded files are served from.");
    }
  } else if (provider === "cloudinary") {
    if (!(e.CLOUDINARY_CLOUD_NAME && e.CLOUDINARY_API_KEY && e.CLOUDINARY_API_SECRET)) {
      problems.push("MEDIA_PROVIDER=cloudinary needs CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.");
    }
    cloudinary = {
      cloudName: e.CLOUDINARY_CLOUD_NAME ?? "",
      apiKey: e.CLOUDINARY_API_KEY ?? "",
      apiSecret: e.CLOUDINARY_API_SECRET ?? "",
    };
  } else if (provider === "local") {
    if (isProd) {
      if (!e.UPLOADS_DIR) {
        problems.push("MEDIA_PROVIDER=local in production needs UPLOADS_DIR pointing at a persistent volume.");
      }
      warn.push("MEDIA_PROVIDER=local stores uploads on this server's disk; make sure UPLOADS_DIR is a persistent, backed-up volume.");
    }
  } else if (provider === "none" && isProd) {
    warn.push("No media provider configured: admins can still link YouTube videos, but cannot upload videos/images. See MEDIA_PROVIDER in .env.example.");
  }
  if (e.MEDIA_PUBLIC_BASE_URL && !isHttpUrl(e.MEDIA_PUBLIC_BASE_URL, isProd)) {
    problems.push("MEDIA_PUBLIC_BASE_URL must be an https URL.");
  }
  const mediaPublic = e.MEDIA_PUBLIC_BASE_URL ? e.MEDIA_PUBLIC_BASE_URL.replace(/\/+$/, "") : null;

  // ── rate limiting ─────────────────────────────────────────────────────────
  if (e.RATE_LIMIT_DISABLED && isProd) problems.push("RATE_LIMIT_DISABLED is not allowed in production.");

  if (problems.length > 0) throw new ConfigError(problems);

  for (const w of warn) {
    // The logger isn't built yet (it needs this config); one-off start-up warnings go to stderr.
    process.stderr.write(`[config] warning: ${w}\n`);
  }

  return {
    env: nodeEnv,
    isProd,
    isTest,
    isDev,
    port: e.PORT,
    host: e.HOST ?? "0.0.0.0",
    logLevel: e.LOG_LEVEL ?? (isTest ? "silent" : "info"),
    publicBaseUrl,
    trustProxy,
    corsOrigins:
      corsOrigins.length > 0
        ? corsOrigins
        : isProd
          ? []
          : ["http://localhost:8081", "http://localhost:19006", "http://localhost:5000"],
    adminConsoleEnabled: e.ADMIN_CONSOLE_ENABLED,
    db: {
      url: dbUrl ?? "",
      ssl: sslMode ?? "disable",
      sslCa: e.DATABASE_SSL_CA ?? null,
      poolMax: e.DB_POOL_MAX,
      statementTimeoutMs: e.DB_STATEMENT_TIMEOUT_MS,
      connectTimeoutMs: e.DB_CONNECT_TIMEOUT_MS,
    },
    redisUrl: e.REDIS_URL ?? null,
    auth: {
      jwtSecret,
      jwtSecretIsDevDefault: jwtIsDev,
      jwtSecretsPrevious: previous,
      accessTtlSeconds: e.ACCESS_TOKEN_TTL_MINUTES * 60,
      refreshTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
      sessionMaxDays: Math.max(e.SESSION_MAX_DAYS, e.REFRESH_TOKEN_TTL_DAYS),
      userCacheTtlMs: e.AUTH_CACHE_TTL_MS ?? (isTest ? 0 : 10_000),
    },
    registration: { mode: e.REGISTRATION_MODE, code: e.REGISTRATION_CODE ?? null },
    legal: {
      consentVersion: e.CONSENT_VERSION,
      privacyPolicyUrl: e.PRIVACY_POLICY_URL ?? null,
      termsUrl: e.TERMS_URL ?? null,
      supportEmail: e.SUPPORT_EMAIL ?? null,
      supportPhone: e.SUPPORT_PHONE ?? null,
    },
    smtp,
    media: {
      provider,
      s3,
      cloudinary,
      localDir: e.UPLOADS_DIR ?? join(process.cwd(), "public", "uploads"),
      publicBaseUrl: mediaPublic,
      extraAllowedHosts: list(e.MEDIA_ALLOWED_HOSTS).map((h) => h.toLowerCase()),
      maxImageBytes: e.MAX_IMAGE_MB * 1024 * 1024,
      maxVideoBytes: e.MAX_VIDEO_MB * 1024 * 1024,
    },
    push: { expoAccessToken: e.EXPO_ACCESS_TOKEN ?? null },
    rateLimitEnabled: !e.RATE_LIMIT_DISABLED,
  };
}

