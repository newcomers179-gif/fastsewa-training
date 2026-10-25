import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigError, loadConfig } from "../configLoader";

const SECRET = "k3Yp9vQ2mWx7LrTz4NbHs8DfGa1CjEu6";
const prod = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://app:pw@db.internal:5432/fastsewa",
  JWT_SECRET: SECRET,
  PUBLIC_BASE_URL: "https://api.fastsewa.test",
  ALLOWED_ORIGINS: "https://admin.example.com",
  MEDIA_PROVIDER: "none",
  ...extra,
});

function problemsOf(env: NodeJS.ProcessEnv): string[] {
  try {
    loadConfig(env);
  } catch (error) {
    assert.ok(error instanceof ConfigError, `expected ConfigError, got ${String(error)}`);
    return error.problems;
  }
  return [];
}

describe("configuration — production fail-fast", () => {
  it("accepts a complete production environment", () => {
    const c = loadConfig(prod());
    assert.equal(c.isProd, true);
    assert.equal(c.trustProxy, 1, "one proxy (nginx / platform load balancer) is the safe default");
    assert.equal(c.auth.jwtSecretIsDevDefault, false);
    assert.equal(c.publicBaseUrl, "https://api.fastsewa.test");
    assert.equal(c.rateLimitEnabled, true);
  });

  it("refuses to start without a JWT secret instead of falling back to a built-in one", () => {
    const { JWT_SECRET: _omit, ...env } = prod();
    assert.match(problemsOf(env).join("\n"), /JWT_SECRET is required in production/);
  });

  for (const [label, secret] of [
    ["too short", "short-secret"],
    ["a placeholder", "please-change_me-to-something-random-1234567890"],
    ["the old hard-coded default", "dev-secret-change-in-production"],
  ] as const) {
    it(`refuses a JWT secret that is ${label}`, () => {
      assert.ok(problemsOf(prod({ JWT_SECRET: secret })).some((p) => p.includes("JWT_SECRET")));
    });
  }

  it("refuses a placeholder or local PUBLIC_BASE_URL in production (a copied .env.example must not boot)", () => {
    for (const url of ["https://api.example.com", "https://example.org", "https://deep.sub.example.net/", "https://localhost:5000", "https://127.0.0.1", "https://0.0.0.0", "https://[::1]:5000"]) {
      assert.ok(
        problemsOf(prod({ PUBLIC_BASE_URL: url })).some((p) => p.includes("is still a placeholder or a local address")),
        `${url} should be refused`
      );
    }
    // real names that merely look similar, and the reserved .test domain, are fine
    for (const url of ["https://api.notexample.com", "https://example.com.fastsewa.in", "https://api.fastsewa.test"]) {
      assert.deepEqual(problemsOf(prod({ PUBLIC_BASE_URL: url })), [], `${url} should be accepted`);
    }
    // development may use a local address
    assert.equal(loadConfig({ NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@localhost/x", PUBLIC_BASE_URL: "http://localhost:5000" }).publicBaseUrl, "http://localhost:5000");
  });

  it("needs an https PUBLIC_BASE_URL (it ends up in certificate QR codes)", () => {
    const { PUBLIC_BASE_URL: _omit, ...missing } = prod();
    assert.ok(problemsOf(missing).some((p) => p.includes("PUBLIC_BASE_URL is required")));
    assert.ok(problemsOf(prod({ PUBLIC_BASE_URL: "http://api.fastsewa.test" })).some((p) => p.includes("PUBLIC_BASE_URL must be an https URL")));
  });

  it("refuses wildcard CORS and TRUST_PROXY=true (spoofable client IPs)", () => {
    assert.ok(problemsOf(prod({ ALLOWED_ORIGINS: "*" })).some((p) => p.includes("ALLOWED_ORIGINS")));
    assert.ok(problemsOf(prod({ TRUST_PROXY: "true" })).some((p) => p.includes("TRUST_PROXY=true")));
    assert.equal(loadConfig(prod({ TRUST_PROXY: "2" })).trustProxy, 2);
  });

  it("forbids switching rate limits off in production", () => {
    assert.ok(problemsOf(prod({ RATE_LIMIT_DISABLED: "true" })).some((p) => p.includes("RATE_LIMIT_DISABLED")));
  });

  it("treats SMTP as all-or-nothing", () => {
    assert.ok(problemsOf(prod({ SMTP_HOST: "smtp.example.com" })).some((p) => p.includes("half-configured")));
    const ok = loadConfig(prod({ SMTP_HOST: "smtp.example.com", SMTP_PORT: "587", SMTP_USER: "u", SMTP_PASSWORD: "p" }));
    assert.equal(ok.smtp?.port, 587);
  });

  it("checks media provider completeness", () => {
    assert.ok(problemsOf(prod({ MEDIA_PROVIDER: "s3" })).some((p) => p.includes("AWS_S3_BUCKET")));
    assert.ok(problemsOf(prod({ MEDIA_PROVIDER: "cloudinary" })).some((p) => p.includes("CLOUDINARY_")));
    assert.ok(problemsOf(prod({ MEDIA_PROVIDER: "local" })).some((p) => p.includes("UPLOADS_DIR")));
    assert.ok(problemsOf(prod({ MEDIA_PROVIDER: "s3", AWS_S3_BUCKET: "b", S3_ENDPOINT: "https://x.r2.cloudflarestorage.com" })).some((p) => p.includes("MEDIA_PUBLIC_BASE_URL")));
    assert.equal(loadConfig(prod({ MEDIA_PROVIDER: "s3", AWS_S3_BUCKET: "b" })).media.s3?.region, "ap-south-1");
  });

  it("needs a registration code when registration is by code", () => {
    assert.ok(problemsOf(prod({ REGISTRATION_MODE: "code" })).some((p) => p.includes("REGISTRATION_CODE")));
    assert.equal(loadConfig(prod({ REGISTRATION_MODE: "code", REGISTRATION_CODE: "SITE-2026" })).registration.mode, "code");
  });

  it("reports every problem at once and never echoes secret values", () => {
    const problems = problemsOf({ NODE_ENV: "production", JWT_SECRET: "hunter2-secret", TRUST_PROXY: "true", ALLOWED_ORIGINS: "*" });
    assert.ok(problems.length >= 4, problems.join("\n"));
    assert.ok(!problems.join("\n").includes("hunter2-secret"));
  });
});

describe("configuration — development and test", () => {
  it("works with only a database URL and flags the development secret", () => {
    const c = loadConfig({ NODE_ENV: "development", DATABASE_URL: "postgresql://localhost/fastsewa" });
    assert.equal(c.auth.jwtSecretIsDevDefault, true);
    assert.equal(c.trustProxy, false);
    assert.equal(c.media.provider, "local");
    assert.ok(c.corsOrigins.length > 0);
  });

  it("test mode uses TEST_DATABASE_URL and never falls back to DATABASE_URL", () => {
    const c = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://prod-host/fastsewa", TEST_DATABASE_URL: "postgresql://localhost/fastsewa_test" });
    assert.match(c.db.url, /fastsewa_test/);
    const unset = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://prod-host/fastsewa" });
    assert.ok(!unset.db.url.includes("prod-host"), "a test run without TEST_DATABASE_URL must not point at DATABASE_URL");
    assert.equal(unset.logLevel, "silent");
    assert.equal(unset.auth.userCacheTtlMs, 0);
  });
});

describe("configuration — database TLS", () => {
  it("disables TLS for local hosts, requires verification for remote hosts in production", () => {
    assert.equal(loadConfig({ NODE_ENV: "development", DATABASE_URL: "postgresql://localhost/x" }).db.ssl, "disable");
    assert.equal(loadConfig(prod()).db.ssl, "verify");
  });

  it("takes control of sslmode from the URL so the driver does not guess", () => {
    const c = loadConfig(prod({ DATABASE_URL: "postgresql://u:p@db.example.com/x?sslmode=require" }));
    assert.equal(c.db.ssl, "require");
    assert.ok(!c.db.url.includes("sslmode"));
    assert.equal(loadConfig(prod({ DATABASE_URL: "postgresql://u:p@db.example.com/x", DATABASE_SSL: "disable" })).db.ssl, "disable");
  });

  it("rejects a malformed database URL", () => {
    assert.ok(problemsOf(prod({ DATABASE_URL: "mysql://x/y" })).some((p) => p.includes("DATABASE_URL")));
  });
});
