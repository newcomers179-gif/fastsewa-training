/**
 * Builds the admin console (admin/src → admin/dist) with esbuild:
 *
 *   npm run admin:build              one-off production build
 *   node scripts/build-admin.mjs --watch    rebuild on change (development)
 *
 * The output is plain static files — one hashed script, one hashed stylesheet, index.html — that
 * the API serves at /admin under a strict Content-Security-Policy (no inline script or style, no
 * CDN). Nothing is compiled in the browser.
 */
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "admin", "src");
const out = join(root, "admin", "dist");
const watch = process.argv.includes("--watch");

const options = {
  absWorkingDir: root,
  entryPoints: { app: join(src, "main.tsx") },
  outdir: join(out, "assets"),
  entryNames: "[name]-[hash]",
  assetNames: "[name]-[hash]",
  bundle: true,
  format: "esm",
  target: ["es2020", "chrome90", "safari14", "firefox90"],
  jsx: "automatic",
  minify: !watch,
  // Source maps only while developing: a production console does not hand out an annotated copy of itself.
  sourcemap: watch ? "external" : false,
  legalComments: "none",
  metafile: true,
  logLevel: "info",
  define: { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
  tsconfig: join(root, "admin", "tsconfig.json"),
  loader: { ".svg": "file" },
};

async function writeIndex(metafile) {
  const outputs = Object.keys(metafile.outputs).map((p) => relative(out, join(root, p)).split("\\").join("/"));
  const js = outputs.find((p) => p.endsWith(".js"));
  const css = outputs.find((p) => p.endsWith(".css"));
  if (!js || !css) throw new Error(`Expected one script and one stylesheet, got: ${outputs.join(", ")}`);
  const template = await readFile(join(src, "index.html"), "utf8");
  const html = template
    .replace("%ASSETS_CSS%", `<link rel="stylesheet" href="/admin/${css}" />`)
    .replace("%ASSETS_JS%", `<script type="module" src="/admin/${js}"></script>`);
  await writeFile(join(out, "index.html"), html);
  await copyFile(join(src, "favicon.svg"), join(out, "favicon.svg"));
  console.log(`admin console → ${relative(root, out)} (${js}, ${css})`);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

if (watch) {
  const ctx = await context({
    ...options,
    plugins: [
      {
        name: "write-index",
        setup(b) {
          b.onEnd(async (result) => {
            if (result.metafile) await writeIndex(result.metafile);
          });
        },
      },
    ],
  });
  await ctx.watch();
  console.log("watching admin/src …");
} else {
  const result = await build(options);
  await writeIndex(result.metafile);
}
