/**
 * Process-wide configuration singleton.
 *
 * Importing this module has two deliberate side effects, both of which must
 * happen before anything else reads the environment:
 *   1. the process time zone is pinned to UTC;
 *   2. outside production/test, a local `.env` file is loaded (real
 *      deployments inject real environment variables instead).
 * The validation itself lives in configLoader.ts so it can be unit-tested
 * with arbitrary environments.
 */
import { existsSync } from "node:fs";
import { loadConfig } from "./configLoader";

process.env.TZ = "UTC";

if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
  try {
    if (existsSync(".env")) process.loadEnvFile(".env");
  } catch {
    /* a malformed .env surfaces through the validation below if it matters */
  }
}

export type { Config } from "./configLoader";
export { ConfigError } from "./configLoader";
export const config = loadConfig();
