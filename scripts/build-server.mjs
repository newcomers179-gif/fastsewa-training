/**
 * Bundles the API into dist/ for the production image.
 *
 *   npm run server:build
 *
 * Output (all CommonJS, Node 20+):
 *   dist/index.js          the API                  node dist/index.js
 *   dist/migrate.js        applies SQL migrations   node dist/migrate.js
 *   dist/seed.js           demo data (dev/staging)  node dist/seed.js
 *   dist/create-admin.js   first admin / recovery   node dist/create-admin.js <username>
 *   dist/assets/           fonts for certificate PDFs
 *   migrations/ is NOT copied: the image ships it next to dist/ (see server/paths.ts).
 *
 * Only the project's own TypeScript (server/, shared/, scripts/) is bundled. Every npm
 * package stays external and is installed by `npm ci --omit=dev --workspace=server`, so
 * the runtime image contains exactly what server/package.json declares.
 *
 * The build FAILS if the code imports a package that server/package.json does not list.
 * Without this guard such an import works on a laptop (the package happens to be
 * installed for the mobile app) and crashes the container at start-up.
 */
import { build } from "esbuild";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");
const serverPackage = JSON.parse(await readFile(join(root, "server", "package.json"), "utf8"));
const declared = new Set(Object.keys(serverPackage.dependencies ?? {}));
/** Loaded only in an interactive development terminal, inside try/catch (see server/logger.ts). */
const OPTIONAL_DEV_ONLY = new Set(["pino-pretty"]);
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

const packageName = (specifier) => (specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const result = await build({
  absWorkingDir: root,
  entryPoints: {
    index: "server/index.ts",
    migrate: "server/migrate.ts",
    seed: "scripts/seed.ts",
    "create-admin": "scripts/create-admin.ts",
  },
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  packages: "external",
  tsconfig: "server/tsconfig.json",
  sourcemap: true,
  logLevel: "warning",
  metafile: true,
  legalComments: "none",
});

const problems = [];
for (const [file, info] of Object.entries(result.metafile.outputs)) {
  if (file.endsWith(".map")) continue;
  for (const imp of info.imports) {
    if (!imp.external) continue;
    if (builtins.has(imp.path) || imp.path.startsWith("node:")) continue;
    const name = packageName(imp.path);
    if (declared.has(name) || OPTIONAL_DEV_ONLY.has(name)) continue;
    problems.push(`${file} imports "${imp.path}", which is not in server/package.json "dependencies"`);
  }
}
// A path alias that esbuild could not resolve would be left as an external bare import too.
for (const info of Object.values(result.metafile.outputs)) {
  for (const imp of info.imports) {
    if (imp.external && /^@shared\//.test(imp.path)) problems.push(`unresolved alias ${imp.path}`);
  }
}
if (problems.length > 0) {
  console.error(`\nServer build failed:\n${[...new Set(problems)].map((p) => `  - ${p}`).join("\n")}\n`);
  process.exit(1);
}

await cp(join(root, "server", "assets"), join(out, "assets"), { recursive: true });
console.log(`server bundle written to ${out} (${Object.keys(result.metafile.outputs).filter((f) => f.endsWith(".js")).length} entries)`);
