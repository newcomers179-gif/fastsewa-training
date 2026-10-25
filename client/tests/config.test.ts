/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveApiBaseUrl } from "../src/lib/apiUrl";

const release = (env: string | undefined) => resolveApiBaseUrl({ env, isDev: false });
const dev = (env: string | undefined, hostUri?: string | null) => resolveApiBaseUrl({ env, isDev: true, hostUri });

describe("release builds", () => {
  it("accept an https address and drop trailing slashes", () => {
    assert.deepEqual(release("https://api.fastsewa.org"), { url: "https://api.fastsewa.org", problem: null });
    assert.deepEqual(release("  https://api.fastsewa.org///  "), { url: "https://api.fastsewa.org", problem: null });
    assert.deepEqual(release("https://api.fastsewa.org:8443/base"), { url: "https://api.fastsewa.org:8443/base", problem: null });
  });

  it("refuse to guess: no address means the app says it is not set up", () => {
    assert.deepEqual(release(undefined), { url: null, problem: "missing" });
    assert.deepEqual(release(""), { url: null, problem: "missing" });
    assert.deepEqual(release("   "), { url: null, problem: "missing" });
  });

  it("refuse plain http, so passwords are never sent in the clear", () => {
    assert.deepEqual(release("http://api.fastsewa.org"), { url: null, problem: "insecure" });
    assert.deepEqual(release("http://192.168.1.20:5000"), { url: null, problem: "insecure" });
  });

  it("refuse an address that was never filled in", () => {
    for (const placeholder of ["https://YOUR-API-HOST", "https://api.yourdomain.com", "https://api.example.com", "https://<api-host>", "https://..."]) {
      assert.equal(release(placeholder).problem, "placeholder", placeholder);
    }
  });

  it("refuse things that are not an address", () => {
    for (const bad of ["api.fastsewa.org", "ftp://files.fastsewa.org", "https://", "https://exa mple.org", "javascript:alert(1)"]) {
      assert.equal(release(bad).problem, "invalid", bad);
    }
  });
});

describe("development builds", () => {
  it("use the address given, even http", () => {
    assert.deepEqual(dev("http://192.168.1.20:5000/"), { url: "http://192.168.1.20:5000", problem: null });
  });

  it("find the developer's computer from the Expo host, and fall back to localhost", () => {
    assert.deepEqual(dev(undefined, "192.168.1.20:8081"), { url: "http://192.168.1.20:5000", problem: null });
    assert.deepEqual(dev(undefined, null), { url: "http://localhost:5000", problem: null });
    assert.deepEqual(dev(undefined, ""), { url: "http://localhost:5000", problem: null });
  });

  it("still rejects garbage", () => {
    assert.equal(dev("not a url").problem, "invalid");
  });
});
