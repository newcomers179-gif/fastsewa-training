import { join } from "node:path";

/**
 * Filesystem locations the API needs at runtime, resolved relative to this
 * file so they are identical when running from source (`tsx server/index.ts`,
 * where __dirname is `server/`) and from the production bundle (`node
 * dist/index.js`, where __dirname is `dist/`).
 *
 *   source layout            production image layout
 *   server/assets            dist/assets         (fonts; copied by scripts/build-server.mjs)
 *   migrations               migrations          (SQL; copied next to dist/)
 *   admin/dist               admin/dist          (built admin console)
 */
export const SERVER_DIR = __dirname;
export const ROOT_DIR = join(__dirname, "..");
export const ASSETS_DIR = join(__dirname, "assets");
export const MIGRATIONS_DIR = join(ROOT_DIR, "migrations");
export const ADMIN_DIST_DIR = join(ROOT_DIR, "admin", "dist");
