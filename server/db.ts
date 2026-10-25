import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "@shared/schema";
import { config } from "./config";
import { logger } from "./logger";

function loadCa(value: string): string {
  // Accept either PEM text (newlines may be escaped as \n in env files) or a file path.
  if (value.includes("BEGIN CERTIFICATE")) return value.replace(/\\n/g, "\n");
  return readFileSync(value, "utf8");
}

function sslOption(): PoolConfig["ssl"] {
  switch (config.db.ssl) {
    case "disable":
      return false;
    case "require":
      // Encrypted, but the server certificate is not verified.
      return { rejectUnauthorized: false };
    case "verify":
      return config.db.sslCa
        ? { rejectUnauthorized: true, ca: loadCa(config.db.sslCa) }
        : { rejectUnauthorized: true };
  }
}

/**
 * Pool factory. Timeouts matter in production:
 *  - connectionTimeoutMillis: a saturated pool fails a request quickly (503)
 *    instead of queueing it forever;
 *  - statement_timeout: a runaway query is cancelled by the database;
 *  - idle_in_transaction_session_timeout: a leaked transaction cannot hold
 *    locks (and a connection) indefinitely;
 *  - maxLifetimeSeconds: connections are recycled so DNS fail-over and
 *    serverless providers' connection limits keep working.
 * Migrations build their own pool with the statement timeout lifted.
 */
export function createPool(overrides: PoolConfig = {}): Pool {
  return new Pool({
    connectionString: config.db.url,
    max: config.db.poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: config.db.connectTimeoutMs,
    statement_timeout: config.db.statementTimeoutMs,
    idle_in_transaction_session_timeout: 30_000,
    application_name: "fastsewa-api",
    keepAlive: true,
    maxLifetimeSeconds: 3600,
    ssl: sslOption(),
    ...overrides,
  });
}

/** One pool per process. */
export const pool = createPool();

pool.on("error", (error) => {
  // An idle client dropped (database restart, network blip). The pool replaces it; never crash for this.
  logger.error({ err: error }, "idle database client error");
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;
/** The `tx` handed to `db.transaction(async (tx) => …)`; services accept `Database | Tx`. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

export async function checkDatabase(timeoutMs = 2000): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("database health check timed out")), timeoutMs);
      }),
    ]);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: (error as Error).message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function poolStats() {
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: config.db.poolMax };
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
