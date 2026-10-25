/**
 * The migrations are what a deployment actually runs, so they are tested on throw-away databases
 * of their own (created next to TEST_DATABASE_URL and dropped afterwards):
 *   - a fresh database must end up exactly as `shared/schema.ts` describes it;
 *   - a database created by the ORIGINAL release, holding rows that break every rule added since,
 *     must upgrade without losing anyone and with the rules enforced afterwards.
 */
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it, type TestContext } from "node:test";
import { getTableName, is } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { Client, Pool, type QueryResult } from "pg";
import * as schema from "@shared/schema";
import { MIGRATIONS_DIR } from "../paths";

const FIXTURE = join(__dirname, "fixtures", "legacy-data.sql");

function databaseUrl(database: string): string {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error('TEST_DATABASE_URL is not set (see README, "Running the tests")');
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

const created: string[] = [];
const pools: Pool[] = [];
let cannotCreate: string | null = null;

/** Creates an empty database whose name says "test" and returns a pool on it. */
async function scratchDatabase(label: string): Promise<Pool | null> {
  if (cannotCreate) return null;
  const name = `fastsewa_test_mig_${label}_${process.pid}_${Date.now().toString(36)}`;
  const admin = new Client({ connectionString: databaseUrl("postgres") });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created.push(name);
  } catch (error) {
    if ((error as { code?: string }).code === "42501") {
      cannotCreate = "the test database user may not CREATE DATABASE";
      return null;
    }
    throw error;
  } finally {
    await admin.end();
  }
  const pool = new Pool({ connectionString: databaseUrl(name), max: 2 });
  pools.push(pool);
  return pool;
}

after(async () => {
  await Promise.all(pools.map((p) => p.end()));
  if (created.length === 0) return;
  const admin = new Client({ connectionString: databaseUrl("postgres") });
  await admin.connect();
  try {
    for (const name of created) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
});

const applyAll = (pool: Pool, folder = MIGRATIONS_DIR) => migrate(drizzle(pool), { migrationsFolder: folder });

/** A copy of the migrations folder that stops at 0001, i.e. what the original release shipped. */
async function originalReleaseMigrations(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fastsewa-original-migrations-"));
  await mkdir(join(dir, "meta"));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  journal.entries = journal.entries.filter((e) => e.idx <= 1);
  assert.equal(journal.entries.length, 2);
  await writeFile(join(dir, "meta", "_journal.json"), JSON.stringify(journal));
  for (const entry of journal.entries) await cp(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
  return dir;
}

const journalLength = async () => (JSON.parse(await readFile(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8")) as { entries: unknown[] }).entries.length;

async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

function skipUnlessPossible(t: TestContext, pool: Pool | null): pool is Pool {
  if (pool) return true;
  t.skip(cannotCreate ?? "no scratch database");
  return false;
}

describe("migrations", () => {
  it("build a fresh database that matches shared/schema.ts table by table", async (t) => {
    const pool = await scratchDatabase("fresh");
    if (!skipUnlessPossible(t, pool)) return;
    await applyAll(pool);

    const applied = await pool.query(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
    assert.equal(applied.rows[0].n, await journalLength());

    const declared = Object.values(schema as Record<string, unknown>).filter((v): v is PgTable => is(v, PgTable));
    assert.ok(declared.length >= 14, "the schema exports its tables");
    const tables = await pool.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
    assert.deepEqual(tables.rows.map((r) => r.tablename).sort(), declared.map((d) => getTableName(d)).sort(), "same set of tables");

    for (const table of declared) {
      const cfg = getTableConfig(table);
      const where = `table "${cfg.name}"`;

      const cols: QueryResult<{ column_name: string; is_nullable: string }> = await pool.query(
        `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        [cfg.name]
      );
      assert.deepEqual(cols.rows.map((c) => c.column_name).sort(), cfg.columns.map((c) => c.name).sort(), `${where}: columns`);
      for (const col of cfg.columns) {
        const actual = cols.rows.find((c) => c.column_name === col.name)!;
        assert.equal(actual.is_nullable === "NO", col.notNull, `${where}: ${col.name} NOT NULL`);
      }

      const indexes = await pool.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1`, [cfg.name]);
      const have = new Set(indexes.rows.map((r) => r.indexname));
      for (const idx of cfg.indexes) assert.ok(have.has(idx.config.name!), `${where}: index ${idx.config.name}`);

      const constraints: QueryResult<{ conname: string; contype: string }> = await pool.query(
        `SELECT c.conname, c.contype FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace WHERE n.nspname = 'public' AND r.relname = $1`,
        [cfg.name]
      );
      for (const check of cfg.checks) assert.ok(constraints.rows.some((c) => c.conname === check.name && c.contype === "c"), `${where}: check ${check.name}`);
      assert.equal(constraints.rows.filter((c) => c.contype === "f").length, cfg.foreignKeys.length, `${where}: foreign keys`);
    }

    await applyAll(pool);
    const again = await pool.query(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
    assert.equal(again.rows[0].n, applied.rows[0].n, "running them again changes nothing");
  });

  it("upgrade a database from the original release and repair the rows that break the new rules", async (t) => {
    const pool = await scratchDatabase("legacy");
    if (!skipUnlessPossible(t, pool)) return;
    const originalDir = await originalReleaseMigrations();
    try {
      await applyAll(pool, originalDir);
      await pool.query(await readFile(FIXTURE, "utf8"));
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM users`)).rows[0].n, 5);
    } finally {
      await rm(originalDir, { recursive: true, force: true });
    }

    await applyAll(pool);

    // Usernames: case-variants renamed (oldest keeps the name), everything lower case.
    const people = await pool.query<{ id: string; username: string; email: string | null; password_hash: string }>(`SELECT id, username, email, password_hash FROM users ORDER BY created_at, id`);
    const byId = new Map(people.rows.map((u) => [u.id.slice(-2), u]));
    assert.equal(people.rows.length, 5, "nobody is lost");
    assert.equal(byId.get("01")!.username, "ramesh");
    assert.match(byId.get("02")!.username, /^ramesh_2[0-9a-f]{4}$/);
    assert.match(byId.get("03")!.username, /^ramesh_3[0-9a-f]{4}$/);
    assert.equal(new Set(people.rows.map((u) => u.username)).size, 5);
    assert.ok(people.rows.every((u) => u.username === u.username.toLowerCase()));
    assert.equal(byId.get("01")!.password_hash, "$2b$12$aaaaaaaaaaaaaaaaaaaaaa", "legacy bcrypt hashes are untouched (verified, then upgraded, at next login)");

    // E-mail: trimmed + lower-cased; the oldest owner keeps a shared address; blanks become NULL.
    assert.equal(byId.get("01")!.email, "ramesh@example.com");
    assert.equal(byId.get("02")!.email, null);
    assert.equal(byId.get("03")!.email, null);
    assert.equal(byId.get("a1")!.email, "admin@x.com");

    // One quiz per module, attempts follow the surviving quiz.
    const quizzes = await pool.query(`SELECT id, title FROM quizzes`);
    assert.deepEqual(quizzes.rows.map((q) => q.title), ["Quiz A"]);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM quiz_attempts WHERE quiz_id = 'e0000000-0000-0000-0000-000000000001'`)).rows[0].n, 2);

    // One certificate per person and course (the earliest survives), with the holder's name frozen on it.
    const certs = await pool.query(`SELECT certificate_number, issued_name, issued_course_title, earned_at FROM certificates ORDER BY certificate_number`);
    assert.deepEqual(certs.rows.map((c) => c.certificate_number), ["FSWA-OLD-1", "FSWA-OLD-3"]);
    assert.equal(certs.rows[0].issued_name, "Ramesh");
    assert.equal(certs.rows[0].issued_course_title, "Safety");
    assert.equal(new Date(certs.rows[0].earned_at).toISOString(), "2026-02-01T10:00:00.000Z", "naive timestamps were UTC and stay the same instant");

    // Out-of-range numbers are clamped; duplicate refresh-token hashes collapse.
    assert.equal((await pool.query(`SELECT completion_percent FROM course_enrollments`)).rows[0].completion_percent, 100);
    assert.deepEqual((await pool.query(`SELECT token_hash FROM refresh_tokens ORDER BY token_hash`)).rows.map((r) => r.token_hash), ["dup-hash", "unique-hash"]);

    // The old single push token moved into the devices table.
    assert.deepEqual((await pool.query(`SELECT token FROM push_devices`)).rows.map((r) => r.token), ["ExponentPushToken[abc]"]);

    // And the rules now hold.
    const userId = "11111111-0000-0000-0000-000000000004";
    const courseId = "c0000000-0000-0000-0000-000000000001";
    assert.equal(await sqlState(pool.query(`INSERT INTO users (username, password_hash, display_name) VALUES ('PRIYA', 'x', 'Another Priya')`)), "23514", "upper-case username");
    assert.equal(await sqlState(pool.query(`INSERT INTO users (username, password_hash, display_name) VALUES ('priya', 'x', 'Another Priya')`)), "23505", "duplicate username");
    assert.equal(await sqlState(pool.query(`INSERT INTO certificates (user_id, course_id, certificate_number) VALUES ($1, $2, 'FSWA-NEW-1')`, [userId, courseId])), "23505", "second certificate for one course");
    assert.equal(await sqlState(pool.query(`UPDATE course_enrollments SET completion_percent = 101`)), "23514", "percent above 100");
    assert.equal(await sqlState(pool.query(`INSERT INTO quizzes (module_id, title) VALUES ('d0000000-0000-0000-0000-000000000001', 'Second quiz')`)), "23505", "second quiz in a module");
  });
});
