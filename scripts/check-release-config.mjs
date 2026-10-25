/**
 * Refuses to build a store release from a mis-configured project.
 *
 *   npm run check:release                    checks the preview and production profiles
 *   npm run check:release -- --profile production
 *
 * It also runs by itself at the start of every EAS build (the "eas-build-pre-install" script in
 * package.json), for the profile being built. A release that was built against a placeholder or
 * http:// server address cannot work, and finding that out after store review costs days.
 *
 * Only Node's own modules are used: on EAS this runs before `npm install`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Keep in step with client/src/lib/apiUrl.ts (server/tests/release-config.test.ts compares them).
const ADDRESS = /^https?:\/\/[^\s/?#]+(?:\/[^\s?#]*)?$/i;
const PLACEHOLDER = /YOUR[_-]|yourdomain|example\.(?:com|org|net)|<[^>]+>|\.\.\./i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEMVER = /^\d+\.\d+\.\d+$/;
const RELEASE_PROFILES = ["preview", "production"];

/** Why a server address cannot go into a release build, or null when it can. */
export function apiUrlProblem(value) {
  const url = String(value ?? "").trim().replace(/\/+$/, "");
  if (url === "") return "is empty";
  if (!ADDRESS.test(url)) return `"${url}" is not a valid address`;
  if (PLACEHOLDER.test(url)) return `"${url}" is still a placeholder`;
  if (!/^https:\/\//i.test(url)) return `"${url}" is not https (store builds refuse plain http)`;
  return null;
}

function readJson(path, errors) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${path}: cannot be read (${error.message})`);
    return null;
  }
}

/** Every string in the app config that points at a file in the project ("./client/assets/..."). */
function localAssetPaths(node, found = []) {
  if (typeof node === "string") {
    if (/^\.\/.+\.(png|jpe?g|ttf|otf|mp3|wav|json)$/i.test(node)) found.push(node);
  } else if (Array.isArray(node)) {
    for (const item of node) localAssetPaths(item, found);
  } else if (node && typeof node === "object") {
    for (const value of Object.values(node)) localAssetPaths(value, found);
  }
  return found;
}

/**
 * @param {{ root?: string, profile?: string | null, env?: Record<string, string | undefined> }} options
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkRelease({ root = process.cwd(), profile = null, env = process.env } = {}) {
  const errors = [];
  const warnings = [];
  const app = readJson(join(root, "app.json"), errors)?.expo;
  const eas = readJson(join(root, "eas.json"), errors);
  const rootPackage = readJson(join(root, "package.json"), errors);
  const serverPackage = readJson(join(root, "server", "package.json"), errors);
  if (!app || !eas) return { errors, warnings };

  // ── version: one number everywhere ─────────────────────────────────────────
  if (!SEMVER.test(String(app.version ?? ""))) errors.push(`app.json: "version" must look like 1.2.3 (found "${app.version}")`);
  for (const [name, pkg] of [["package.json", rootPackage], ["server/package.json", serverPackage]]) {
    if (pkg && pkg.version !== app.version) errors.push(`${name} says version ${pkg.version} but app.json says ${app.version}: release one number everywhere`);
  }

  // ── store identity ─────────────────────────────────────────────────────────
  const ids = [["ios.bundleIdentifier", app.ios?.bundleIdentifier], ["android.package", app.android?.package]];
  for (const [name, value] of ids) {
    if (!value) errors.push(`app.json: ${name} is missing`);
    else if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(value)) errors.push(`app.json: ${name} "${value}" is not a valid reverse-domain identifier`);
    else if (/example|yourcompany|yourdomain/i.test(value)) errors.push(`app.json: ${name} "${value}" is still a placeholder`);
  }
  if (!UUID.test(String(app.extra?.eas?.projectId ?? ""))) {
    errors.push('app.json: extra.eas.projectId is not set — run "eas init" once and commit the id it writes');
  }

  // ── files the config points at ─────────────────────────────────────────────
  for (const path of new Set(localAssetPaths(app))) {
    if (!existsSync(join(root, path))) errors.push(`app.json: ${path} does not exist`);
  }

  // ── server address, per profile ────────────────────────────────────────────
  const profiles = profile && profile !== "all" ? [profile] : RELEASE_PROFILES;
  for (const name of profiles) {
    const definition = eas.build?.[name];
    if (!definition) {
      if (RELEASE_PROFILES.includes(name)) errors.push(`eas.json: there is no "${name}" build profile`);
      continue;
    }
    if (!RELEASE_PROFILES.includes(name)) continue; // the development client may talk to http://<your computer>:5000
    // A value set in EAS itself (environment variable / secret) wins over eas.json, exactly as in the build.
    const value = env.EXPO_PUBLIC_API_URL ?? definition.env?.EXPO_PUBLIC_API_URL;
    const problem = apiUrlProblem(value);
    if (problem) errors.push(`${name} build: EXPO_PUBLIC_API_URL ${problem}. Set it in eas.json (build.${name}.env) to the https address of the API.`);
  }
  if (profiles.includes("production") && eas.build?.production && eas.cli?.appVersionSource !== "remote") {
    warnings.push('eas.json: cli.appVersionSource is not "remote", so "autoIncrement" rewrites local files; "remote" lets EAS keep the build numbers');
  }
  return { errors, warnings };
}

// ─── command line ────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : null;
  };
  const root = option("--root") ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const profile = option("--profile") ?? process.env.EAS_BUILD_PROFILE ?? null;
  const { errors, warnings } = checkRelease({ root, profile });
  for (const warning of warnings) console.warn(`  ! ${warning}`);
  if (errors.length > 0) {
    console.error(`\nNot ready to release${profile ? ` (${profile})` : ""}:`);
    for (const error of errors) console.error(`  x ${error}`);
    console.error("");
    process.exit(1);
  }
  console.log(`Release configuration looks good${profile ? ` for the ${profile} profile` : ""}.`);
}
