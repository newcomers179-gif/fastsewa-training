/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatBytes, formatDate, formatDateTime, formatDay, formatDuration, formatNumber, humanizeAction, initials, parseDuration, plural, slugify, timeAgo } from "../src/format";

describe("durations", () => {
  it("formats seconds as m:ss or h:mm:ss", () => {
    assert.equal(formatDuration(59), "0:59");
    assert.equal(formatDuration(754), "12:34");
    assert.equal(formatDuration(3725), "1:02:05");
  });
  it("shows nothing for a missing or negative length", () => {
    assert.equal(formatDuration(null), "");
    assert.equal(formatDuration(undefined), "");
    assert.equal(formatDuration(0), "");
    assert.equal(formatDuration(-5), "");
  });
  it("reads what a person types", () => {
    assert.equal(parseDuration("754"), 754);
    assert.equal(parseDuration("12:34"), 754);
    assert.equal(parseDuration("1:02:05"), 3725);
    assert.equal(parseDuration(" 1:2 "), 62);
  });
  it("refuses anything that is not a duration", () => {
    for (const bad of ["", "   ", "abc", "12:60", "1:2:3:4", "-5", "1.5", "12:", ":30", "1:99:00"]) {
      assert.equal(parseDuration(bad), null, JSON.stringify(bad));
    }
  });
  it("round-trips", () => {
    for (const seconds of [1, 59, 60, 754, 3599, 3600, 3725, 36000]) {
      assert.equal(parseDuration(formatDuration(seconds)), seconds);
    }
  });
});

describe("course addresses (slugs)", () => {
  it("lower-cases and joins words with single hyphens", () => {
    assert.equal(slugify("Scaffolding Basics!"), "scaffolding-basics");
    assert.equal(slugify("  Working   at   Height -- Level 2  "), "working-at-height-level-2");
  });
  it("drops accents", () => {
    assert.equal(slugify("Électricité & Sécurité"), "electricite-securite");
  });
  it("gives an empty address for a title with no latin letters (the person must type one)", () => {
    assert.equal(slugify("सुरक्षा प्रशिक्षण"), "");
  });
  it("never ends or starts with a hyphen and stays within the server limit", () => {
    const long = slugify("a ".repeat(200));
    assert.ok(long.length <= 80);
    assert.ok(!long.startsWith("-") && !long.endsWith("-"));
    assert.match(slugify("--x--"), /^x$/);
  });
  it("only produces what the server accepts", () => {
    for (const title of ["Hello, World", "A_B C", "100% Safe", "x".repeat(300)]) {
      const slug = slugify(title);
      assert.ok(slug === "" || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug), slug);
    }
  });
});

describe("dates are shown in India time", () => {
  it("moves a late-evening UTC instant to the next Indian day", () => {
    assert.equal(formatDate("2026-10-12T20:00:00Z"), "13 Oct 2026");
  });
  it("shows the clock time with am/pm", () => {
    assert.match(formatDateTime("2026-10-12T20:00:00Z"), /13 Oct 2026.*1:30\s?am/i);
  });
  it("shows a calendar day from the API without shifting it", () => {
    assert.equal(formatDay("2026-10-18"), "18 Oct");
  });
  it("shows a dash for nothing or nonsense", () => {
    assert.equal(formatDate(null), "—");
    assert.equal(formatDate(undefined), "—");
    assert.equal(formatDate("not a date"), "—");
    assert.equal(formatDateTime(""), "—");
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-10-20T10:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it("describes recent activity in plain words", () => {
    assert.equal(timeAgo(null, now), "never");
    assert.equal(timeAgo(ago(10_000), now), "just now");
    assert.equal(timeAgo(ago(5 * 60_000), now), "5 min ago");
    assert.equal(timeAgo(ago(3 * 3_600_000), now), "3 h ago");
    assert.equal(timeAgo(ago(24 * 3_600_000), now), "1 day ago");
    assert.equal(timeAgo(ago(5 * 24 * 3_600_000), now), "5 days ago");
  });
  it("falls back to the date after a month", () => {
    assert.equal(timeAgo(ago(60 * 24 * 3_600_000), now), formatDate(ago(60 * 24 * 3_600_000)));
  });
  it("does not print NaN for a bad value", () => {
    assert.equal(timeAgo("garbage", now), "—");
  });
});

describe("small helpers", () => {
  it("formats file sizes", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(2048), "2 KB");
    assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
    assert.equal(formatBytes(3 * 1024 ** 3), "3.0 GB");
  });
  it("groups digits the Indian way", () => {
    assert.equal(formatNumber(1234567), "12,34,567");
  });
  it("pluralises", () => {
    assert.equal(plural(1, "lesson"), "1 lesson");
    assert.equal(plural(2, "lesson"), "2 lessons");
    assert.equal(plural(0, "lesson"), "0 lessons");
    assert.equal(plural(1500, "person", "people"), "1,500 people");
  });
  it("makes initials from the first two words, Hindi included", () => {
    assert.equal(initials("Ravi Kumar Singh"), "RK");
    assert.equal(initials("  ravi "), "R");
    assert.equal(initials("राम कुमार"), "रक");
    assert.equal(initials(""), "");
  });
  it("turns an audit action into a sentence", () => {
    assert.equal(humanizeAction("worker.password_reset"), "Worker password reset");
    assert.equal(humanizeAction("workers.export"), "Workers export");
  });
});
