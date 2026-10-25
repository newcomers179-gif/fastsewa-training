/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveMediaUrl } from "../src/lib/media";
import { viewState } from "../src/lib/viewState";

describe("lesson media addresses", () => {
  const base = "https://api.fastsewa.org/";
  it("keeps http(s) links and puts stored uploads under the API address", () => {
    assert.equal(resolveMediaUrl("https://cdn.example.org/a.mp4", base), "https://cdn.example.org/a.mp4");
    assert.equal(resolveMediaUrl("  http://cdn.example.org/a.jpg ", base), "http://cdn.example.org/a.jpg");
    assert.equal(resolveMediaUrl("/uploads/2026/a.mp4", base), "https://api.fastsewa.org/uploads/2026/a.mp4");
  });

  it("never hands anything else to an image or video component", () => {
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html;base64,AAAA", "//evil.example/x.png", "ftp://x/y", "uploads/a.mp4", "https://a b", ""]) {
      assert.equal(resolveMediaUrl(bad, base), null, bad);
    }
    assert.equal(resolveMediaUrl(null, base), null);
    assert.equal(resolveMediaUrl(undefined, base), null);
  });
});

describe("what a data screen shows", () => {
  it("shows data as soon as there is any, even while refreshing or offline", () => {
    assert.equal(viewState({ data: [], isPending: false, fetchStatus: "fetching" }), "ready");
    assert.equal(viewState({ data: { a: 1 }, isPending: false, fetchStatus: "paused" }), "ready");
  });
  it("tells loading, offline and failed apart when there is nothing to show", () => {
    assert.equal(viewState({ data: undefined, isPending: true, fetchStatus: "fetching" }), "loading");
    assert.equal(viewState({ data: undefined, isPending: true, fetchStatus: "paused" }), "offline");
    assert.equal(viewState({ data: undefined, isPending: false, fetchStatus: "idle" }), "error");
  });
});
