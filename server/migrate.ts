/**
 * Applies pending SQL migrations (`migrations/*.sql`) and exits.
 *
 *   npm run db:migrate          (development, via tsx)
 *   node dist/migrate.js        (production image; run by docker-entrypoint.sh before the API starts)
 *
 * Safe to run from several instances at once: a Postgres advisory lock makes the
 * others wait, then find nothing left to do. It uses its own connection with the
 * statement timeout lifted (a large ALTER TABLE may legitimately take minutes).
 *
 * Release discipline: migrations must be *backwards compatible* with the previous
 * release (add columns/tables first, remove old ones one release later), so a
 * rolling deploy — or a rollback — never meets a schema it cannot read.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createPool } from "./db";
import { logger } from "./logger";
import { MIGRATIONS_DIR } from "./paths";

const LOCK_KEY = "fastsewa:migrate";

async function run(): Promise<void> {
  const pool = createPool({ max: 1, statement_timeout: 0, idle_in_transaction_session_timeout: 0, application_name: "fastsewa-migrate" });
  const client = await pool.connect();
  try {
    logger.info({ dir: MIGRATIONS_DIR }, "waiting for the migration lock");
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [LOCK_KEY]);
    logger.info("applying migrations");
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
    logger.info("migrations are up to date");
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [LOCK_KEY]);
    } catch {
      // the connection is closed right below, which releases the lock anyway
    }
    client.release();
    await pool.end();
  }
}

run().then(
  () => process.exit(0),
  (error) => {
    logger.fatal({ err: error }, "migration failed");
    process.exit(1);
  }
);
