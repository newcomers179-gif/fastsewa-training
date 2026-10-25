import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` only diffs shared/schema.ts against the snapshots in
// migrations/meta and needs no database. The URL is used by `db:studio`.
export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://fastsewa:fastsewa@localhost:5432/fastsewa_db",
  },
  verbose: true,
  strict: true,
});
