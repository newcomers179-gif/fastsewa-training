import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { resolveApiBaseUrl } from "../../client/src/lib/apiUrl";
import { apiUrlProblem, checkRelease } from "../../scripts/check-release-config.mjs";

const REPO = resolve(__dirname, "..", "..");
const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  version?: string;
  appVersion?: string;
  projectId?: string;
  production?: string;
  preview?: string;
  missingIcon?: boolean;
  bundleId?: string;
}

/** A tiny project with just the files the check reads. */
function project(f: Fixture = {}): string {
  const root = mkdtempSync(join(tmpdir(), "fastsewa-release-"));
  made.push(root);
  const write = (path: string, content: unknown) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof content === "string" ? content : JSON.stringify(content));
  };
  write("package.json", { name: "x", version: f.version ?? "3.0.0" });
  write("server/package.json", { name: "@x/server", version: f.version ?? "3.0.0" });
  write("app.json", {
    expo: {
      version: f.appVersion ?? "3.0.0",
      icon: "./client/assets/images/icon.png",
      ios: { bundleIdentifier: f.bundleId ?? "in.acme.training" },
      android: { package: f.bundleId ?? "in.acme.training", adaptiveIcon: { foregroundImage: "./client/assets/images/adaptive.png" } },
      extra: { eas: { projectId: f.projectId ?? "0b6c1c8e-6f0a-4a43-9d58-0f6c2f0d7c11" } },
    },
  });
  write("eas.json", {
    cli: { appVersionSource: "remote" },
    build: {
      development: { developmentClient: true },
      preview: { env: { EXPO_PUBLIC_API_URL: f.preview ?? "https://staging-api.acme.in" } },
      production: { env: { EXPO_PUBLIC_API_URL: f.production ?? "https://api.acme.in" } },
    },
  });
  write("client/assets/images/adaptive.png", "png");
  if (!f.missingIcon) write("client/assets/images/icon.png", "png");
  return root;
}

describe("release configuration check", () => {
  it("accepts a complete project", () => {
    const { errors, warnings } = checkRelease({ root: project(), env: {} });
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it("refuses placeholder, plain-http and missing server addresses, per profile", () => {
    const placeholder = checkRelease({ root: project({ production: "https://api.yourdomain.com" }), profile: "production", env: {} });
    assert.match(placeholder.errors.join("\n"), /production build: EXPO_PUBLIC_API_URL .*placeholder/);
    const plain = checkRelease({ root: project({ preview: "http://staging.acme.in" }), profile: "preview", env: {} });
    assert.match(plain.errors.join("\n"), /preview build: .*not https/);
    const both = checkRelease({ root: project({ preview: "http://a.in", production: "" }), env: {} });
    assert.equal(both.errors.filter((e) => /EXPO_PUBLIC_API_URL/.test(e)).length, 2);
    // only the profile being built is judged
    assert.deepEqual(checkRelease({ root: project({ preview: "http://a.in" }), profile: "production", env: {} }).errors, []);
  });

  it("lets an address set in EAS itself win over eas.json, like the build does", () => {
    const root = project({ production: "https://api.yourdomain.com" });
    assert.deepEqual(checkRelease({ root, profile: "production", env: { EXPO_PUBLIC_API_URL: "https://api.acme.in" } }).errors, []);
    assert.equal(checkRelease({ root, profile: "production", env: { EXPO_PUBLIC_API_URL: "http://10.0.0.5:5000" } }).errors.length, 1);
  });

  it("requires one version number everywhere", () => {
    const { errors } = checkRelease({ root: project({ version: "2.9.0" }), env: {} });
    assert.equal(errors.length, 2); // package.json and server/package.json
    assert.match(errors[0], /package\.json says version 2\.9\.0 but app\.json says 3\.0\.0/);
    assert.match(checkRelease({ root: project({ version: "3.0", appVersion: "3.0" }), env: {} }).errors.join("\n"), /must look like 1\.2\.3/);
  });

  it("requires the store identity and the EAS project id", () => {
    assert.match(checkRelease({ root: project({ projectId: "YOUR_EAS_PROJECT_ID" }), env: {} }).errors.join("\n"), /projectId is not set/);
    assert.match(checkRelease({ root: project({ bundleId: "com.example.app" }), env: {} }).errors.join("\n"), /placeholder/);
    assert.match(checkRelease({ root: project({ bundleId: "not an id" }), env: {} }).errors.join("\n"), /not a valid reverse-domain identifier/);
  });

  it("finds files that app.json points at but that do not exist", () => {
    assert.match(checkRelease({ root: project({ missingIcon: true }), env: {} }).errors.join("\n"), /\.\/client\/assets\/images\/icon\.png does not exist/);
  });

  it("judges addresses exactly like the app does at start-up", () => {
    const samples = [
      "https://api.acme.in",
      "https://api.acme.in/",
      "https://api.acme.in/v2",
      "https://API.ACME.IN:8443",
      "http://api.acme.in",
      "https://api.yourdomain.com",
      "https://YOUR_RENDER_URL.onrender.com",
      "https://your-service.onrender.com",
      "https://api.example.com",
      "https://<host>",
      "https://...",
      "ftp://api.acme.in",
      "api.acme.in",
      "https://",
      "https://a b.in",
      "",
      "   ",
    ];
    for (const sample of samples) {
      const app = resolveApiBaseUrl({ env: sample, isDev: false });
      const check = apiUrlProblem(sample);
      assert.equal(check === null, app.url !== null, `"${sample}": release check says ${check ?? "fine"}, the app says ${app.problem ?? "fine"}`);
    }
  });

  it("holds for this repository: its own files exist and its versions agree", () => {
    const { errors } = checkRelease({ root: REPO, env: { EXPO_PUBLIC_API_URL: "https://api.acme.in" } });
    // The server address and the EAS project id are the owner's to fill in; everything else must already be right.
    const unexpected = errors.filter((e) => !/projectId/.test(e) && !/EXPO_PUBLIC_API_URL/.test(e));
    assert.deepEqual(unexpected, []);
  });
});
