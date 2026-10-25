/**
 * The admin console is plain static files served by the API under a strict Content-Security-Policy.
 * These tests build it (if it is not built yet) and check what a browser would be given: the page,
 * the hashed script and stylesheet it names, and the headers that keep it locked down.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { ADMIN_DIST_DIR, ROOT_DIR } from "../paths";
import { startServer, type TestServer } from "./helpers";

let server: TestServer;
let page = "";
let script = "";
let style = "";

before(async () => {
  if (!existsSync(join(ADMIN_DIST_DIR, "index.html"))) {
    execFileSync(process.execPath, [join(ROOT_DIR, "scripts", "build-admin.mjs")], { cwd: ROOT_DIR, stdio: "pipe" });
  }
  server = await startServer();
  const res = await server.api.get("/admin/");
  page = res.text;
  script = /<script[^>]+src="(\/admin\/assets\/[^"]+\.js)"/.exec(page)?.[1] ?? "";
  style = /<link[^>]+href="(\/admin\/assets\/[^"]+\.css)"/.exec(page)?.[1] ?? "";
});
after(async () => {
  await server.close();
});

describe("admin console (static)", () => {
  it("serves the page at /admin/ with no caching, so a new release is picked up at once", async () => {
    const res = await server.api.get("/admin/");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(res.headers.get("cache-control"), "no-cache");
    assert.match(page, /<div id="root">/);
  });

  it("names one hashed script and one hashed stylesheet and nothing from anywhere else", () => {
    assert.match(script, /^\/admin\/assets\/app-[A-Z0-9]+\.js$/);
    assert.match(style, /^\/admin\/assets\/app-[A-Z0-9]+\.css$/);
    assert.ok(!/https?:\/\//.test(page.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/xmlns="[^"]+"/g, "")), "the page must not load anything from another site");
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>[^<]/i.test(page), "no inline script");
    assert.ok(!/<style/i.test(page), "no inline stylesheet");
    assert.ok(!/\son[a-z]+=/i.test(page), "no inline event handlers");
  });

  it("serves the assets as immutable, correctly typed files", async () => {
    const js = await server.api.get(script);
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type") ?? "", /javascript/);
    assert.match(js.headers.get("cache-control") ?? "", /immutable/);
    const css = await server.api.get(style);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type") ?? "", /text\/css/);
    assert.match(css.headers.get("cache-control") ?? "", /max-age=31536000/);
  });

  it("locks the page down with a Content-Security-Policy that allows only its own scripts and styles", async () => {
    const res = await server.api.get("/admin/");
    const csp = res.headers.get("content-security-policy") ?? "";
    for (const directive of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'self'"]) {
      assert.ok(csp.includes(directive), `missing ${directive} in: ${csp}`);
    }
    assert.ok(!csp.includes("unsafe-inline") && !csp.includes("unsafe-eval"), "no unsafe-inline / unsafe-eval");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  });

  it("does not serve hidden files or anything outside the console folder", async () => {
    assert.equal((await server.api.get("/admin/.env")).status, 404);
    assert.equal((await server.api.get("/admin/../server/config.ts")).status, 404);
    assert.equal((await server.api.get("/admin/assets/")).status, 404);
  });

  it("still answers the API as JSON, not as the console", async () => {
    const res = await server.api.get("/api/v1/nothing-here");
    assert.equal(res.status, 404);
    assert.equal(res.body.code, "NOT_FOUND");
  });
});
