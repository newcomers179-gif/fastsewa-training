/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { firstName, formatClock, formatDate, formatMonthYear, formatTime, initialOf, minutesOf, pick } from "../src/lib/format";

describe("dates are shown in India time", () => {
  // 20:00 UTC on 12 Oct is already the 13th at 01:30 in India.
  const iso = "2026-10-12T20:00:00.000Z";

  it("formats the day in English", () => {
    assert.match(formatDate(iso, "en"), /^13 Oct(ober)? 2026$/);
    assert.match(formatMonthYear(iso, "en"), /^Oct(ober)? 2026$/);
    assert.match(formatTime(iso, "en"), /^1:30\s?(am|AM)$/);
  });

  it("formats the day in Hindi with Devanagari month names", () => {
    assert.match(formatDate(iso, "hi"), /[ऀ-ॿ]/);
    assert.match(formatDate(iso, "hi"), /2026|२०२६/);
  });

  it("shows nothing for a missing or broken date", () => {
    for (const bad of [null, undefined, "", "not a date"]) {
      assert.equal(formatDate(bad, "en"), "");
      assert.equal(formatMonthYear(bad, "en"), "");
      assert.equal(formatTime(bad, "en"), "");
    }
  });
});

describe("small helpers", () => {
  it("clock", () => {
    assert.equal(formatClock(0), "0:00");
    assert.equal(formatClock(59), "0:59");
    assert.equal(formatClock(754), "12:34");
    assert.equal(formatClock(3725), "1:02:05");
    assert.equal(formatClock(-4), "0:00");
    assert.equal(formatClock(61.9), "1:01");
  });

  it("minutes round to the nearest, with a floor of one for anything longer than nothing", () => {
    assert.equal(minutesOf(0), 0);
    assert.equal(minutesOf(10), 1);
    assert.equal(minutesOf(89), 1);
    assert.equal(minutesOf(90), 2);
    assert.equal(minutesOf(-5), 0);
  });

  it("names", () => {
    assert.equal(firstName("Priya Sharma"), "Priya");
    assert.equal(firstName("  Ram  "), "Ram");
    assert.equal(firstName(""), "");
    assert.equal(firstName(null), "");
    assert.equal(initialOf("priya"), "P");
    assert.equal(initialOf("प्रिया"), "प");
    assert.equal(initialOf("  "), "?");
    assert.equal(initialOf(undefined), "?");
  });

  it("picks the Hindi text only for Hindi readers, and only when it exists", () => {
    assert.equal(pick("hi", "Safety", "सुरक्षा"), "सुरक्षा");
    assert.equal(pick("hi", "Safety", null), "Safety");
    assert.equal(pick("hi", "Safety", "   "), "Safety");
    assert.equal(pick("en", "Safety", "सुरक्षा"), "Safety");
    assert.equal(pick("en", null, "सुरक्षा"), "");
  });
});
