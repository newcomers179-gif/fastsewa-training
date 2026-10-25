/**
 * Preloaded into every test process (`node --import ./server/tests/setup.ts --test …`, see the
 * "test" script) BEFORE any test file imports the configuration, so every test runs in test mode:
 * silent logs, no auth cache, and the database named by TEST_DATABASE_URL only.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "test";
// Most tests would trip the limiters on purpose-built bursts; rate-limit tests opt back in (see limitsOn.ts).
process.env.RATE_LIMIT_DISABLED ??= "true";
process.env.UPLOADS_DIR ??= mkdtempSync(join(tmpdir(), "fastsewa-uploads-"));
// A deployment's own values must never leak into a test run.
for (const key of [
  "DATABASE_URL",
  "REDIS_URL",
  "PUBLIC_BASE_URL",
  "ALLOWED_ORIGINS",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "AWS_S3_BUCKET",
  "CLOUDINARY_CLOUD_NAME",
  "REGISTRATION_MODE",
  "REGISTRATION_CODE",
  "MEDIA_PROVIDER",
  "JWT_SECRET",
]) {
  delete process.env[key];
}
