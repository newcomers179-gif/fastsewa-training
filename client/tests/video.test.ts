/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { YOUTUBE_BASE_URL, isAllowedPlayerUrl, parsePlayerMessage, youTubeHtml } from "../src/lib/video";

describe("the YouTube player page", () => {
  it("embeds the video id and start time, and reports to the app", () => {
    const html = youTubeHtml("dQw4w9WgXcQ", 83.9);
    assert.match(html, /videoId: "dQw4w9WgXcQ"/);
    assert.match(html, /start: 83,/);
    assert.match(html, /ReactNativeWebView\.postMessage/);
    assert.match(html, new RegExp(`origin: "${YOUTUBE_BASE_URL}"`));
    assert.match(html, /https:\/\/www\.youtube\.com\/iframe_api/);
  });

  it("cleans the start time", () => {
    for (const [input, expected] of [[0, 0], [-5, 0], [Number.NaN, 0], [Number.POSITIVE_INFINITY, 0], [59.99, 59]] as const) {
      assert.match(youTubeHtml("abcdefghijk", input), new RegExp(`start: ${expected},`), String(input));
    }
  });

  it("refuses anything that is not shaped like a video id (it goes into a script)", () => {
    for (const bad of ['abc"; alert(1); "', "<script>", "short", "has space1", "x".repeat(21), "", "a/b/c/d/e/f", "ünïcödé123"]) {
      assert.throws(() => youTubeHtml(bad), /Not a YouTube video id/, bad);
    }
    for (const good of ["dQw4w9WgXcQ", "a-b_c-d_e-f", "abcdef"]) assert.doesNotThrow(() => youTubeHtml(good), good);
  });
});

describe("messages from the player page", () => {
  it("understands the four things the page says", () => {
    assert.deepEqual(parsePlayerMessage('{"type":"ready"}'), { type: "ready" });
    assert.deepEqual(parsePlayerMessage('{"type":"state","playing":true}'), { type: "state", playing: true });
    assert.deepEqual(parsePlayerMessage('{"type":"time","position":12,"duration":300}'), { type: "time", position: 12, duration: 300 });
    assert.deepEqual(parsePlayerMessage('{"type":"time","position":12}'), { type: "time", position: 12 });
    assert.deepEqual(parsePlayerMessage('{"type":"error","code":153}'), { type: "error", code: 153 });
    assert.deepEqual(parsePlayerMessage('{"type":"error"}'), { type: "error", code: -1 });
  });

  it("ignores anything unexpected, malformed or oversized", () => {
    const bad: unknown[] = [
      undefined,
      null,
      42,
      {},
      "",
      "not json",
      "[]",
      "null",
      '{"type":"state"}',
      '{"type":"state","playing":"yes"}',
      '{"type":"time"}',
      '{"type":"time","position":-1}',
      '{"type":"time","position":"7"}',
      '{"type":"launch-missiles"}',
      `{"type":"ready","pad":"${"x".repeat(2100)}"}`,
    ];
    for (const raw of bad) assert.equal(parsePlayerMessage(raw), null, String(raw).slice(0, 40));
  });

  it("drops an invalid duration but keeps the position", () => {
    assert.deepEqual(parsePlayerMessage('{"type":"time","position":5,"duration":-3}'), { type: "time", position: 5 });
  });
});

describe("where the player may navigate", () => {
  it("allows only the player itself", () => {
    for (const ok of ["about:blank", "https://www.youtube.com/", "https://www.youtube.com/embed/dQw4w9WgXcQ?start=3", "https://www.youtube-nocookie.com/embed/abc", "https://www.youtube.com/iframe_api", "https://www.youtube.com/s/player/abc/www-widgetapi.js"]) {
      assert.equal(isAllowedPlayerUrl(ok), true, ok);
    }
  });

  it("keeps the learner on the lesson: no watch page, no other site, no other scheme", () => {
    for (const no of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/@channel",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://youtube.com.evil.example/embed/x",
      "https://evil.example/embed/x?u=https://www.youtube.com/embed/x",
      "http://www.youtube.com/embed/x",
      "javascript:alert(1)",
      "intent://scan/#Intent;scheme=zxing;end",
      "",
    ]) {
      assert.equal(isAllowedPlayerUrl(no), false, no);
    }
  });
});
