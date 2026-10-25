import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkPassword,
  isValidDisplayName,
  isValidEmail,
  isValidUsername,
  normalizeDisplayName,
  normalizeEmail,
  normalizePhone,
  normalizeUsername,
  parseYouTubeId,
} from "./validation";

describe("usernames", () => {
  it("are case-insensitive and limited to letters, digits and underscore", () => {
    assert.equal(normalizeUsername("  Ramesh_K  "), "ramesh_k");
    for (const ok of ["abc", "ramesh_k", "a1b2c3", "x".repeat(30)]) assert.ok(isValidUsername(ok), ok);
    for (const bad of ["ab", "x".repeat(31), "ra mesh", "ramesh-k", "रमेश", "a.b", "ramesh@x"]) assert.ok(!isValidUsername(bad), bad);
  });
});

describe("e-mail", () => {
  it("normalises and validates", () => {
    assert.equal(normalizeEmail(" Asha@Example.COM "), "asha@example.com");
    assert.ok(isValidEmail("asha@example.com"));
    for (const bad of ["asha", "asha@", "@example.com", "asha@example", "a b@example.com", "x@y.c"]) assert.ok(!isValidEmail(bad), bad);
  });
});

describe("phone numbers", () => {
  it("accepts the formats people actually type and returns E.164", () => {
    for (const input of ["9876543210", "09876543210", "+91 98765 43210", "91-9876543210", "0091 9876543210", "(+91) 98765.43210"]) {
      assert.equal(normalizePhone(input), "+919876543210", input);
    }
    assert.equal(normalizePhone("+14155550123"), "+14155550123");
  });

  it("rejects numbers that cannot be Indian mobiles", () => {
    for (const bad of ["", "12345", "5876543210", "+915876543210", "98765432101", "abcdefghij", "+91 98765"]) assert.equal(normalizePhone(bad), null, bad);
  });
});

describe("passwords", () => {
  it("enforces length and refuses the usual suspects", () => {
    assert.equal(checkPassword("short"), "PASSWORD_TOO_SHORT");
    assert.equal(checkPassword("x".repeat(129)), "PASSWORD_TOO_LONG");
    for (const common of ["password123", "Password123", "12345678", "qwertyuiop", "Admin@1234", "fastsewa123", "aaaaaaaa"]) {
      assert.equal(checkPassword(common), "PASSWORD_TOO_COMMON", common);
    }
    assert.equal(checkPassword("ramesh_k99", { username: "Ramesh_K99" }), "PASSWORD_SAME_AS_USERNAME");
    assert.equal(checkPassword("Tr4ining#Pass1"), null);
    assert.equal(checkPassword("पासवर्ड-2026-ठीक"), null);
  });

  it("asks staff for 12 characters", () => {
    assert.equal(checkPassword("Tr4ining#1", { staff: true }), "PASSWORD_TOO_SHORT");
    assert.equal(checkPassword("Tr4ining#1"), null);
    assert.equal(checkPassword("Tr4ining#Pass1", { staff: true }), null);
  });

  it("refuses every default credential this project ever shipped", () => {
    for (const shipped of ["Admin@1234", "Trainer@123", "Worker@123", "admin123", "worker123"]) {
      assert.equal(checkPassword(shipped), "PASSWORD_TOO_COMMON", shipped);
    }
  });
});

describe("display names (printed on certificates)", () => {
  it("accepts English and Hindi names with ordinary punctuation", () => {
    for (const ok of ["Ramesh Kumar", "रमेश कुमार", "श्रीमती ज्योति शर्मा", "Anne-Marie O'Brien", "José Núñez", "Dr. A. P. J. Abdul Kalam", "A"]) {
      assert.ok(isValidDisplayName(normalizeDisplayName(ok)), ok);
    }
  });

  it("rejects what the certificate fonts cannot print or what is not a name", () => {
    for (const bad of ["Ramesh123", "Anil 🦺", "தமிழ்", "বাংলা", ".dot", "-dash", "x".repeat(61), "", "   "]) {
      assert.ok(!isValidDisplayName(normalizeDisplayName(bad)), JSON.stringify(bad));
    }
  });

  it("collapses whitespace", () => {
    assert.equal(normalizeDisplayName("  Priya   \t Sharma "), "Priya Sharma");
  });
});

describe("YouTube links", () => {
  it("extracts the id from every common shape", () => {
    const id = "dQw4w9WgXcQ";
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?feature=share&v=${id}&t=10`,
      `https://youtu.be/${id}?t=5`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube-nocookie.com/embed/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/live/${id}`,
      `https://m.youtube.com/watch?v=${id}`,
    ]) {
      assert.equal(parseYouTubeId(url), id, url);
    }
  });

  it("returns null for anything else", () => {
    for (const url of ["https://example.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/", "not a url", "https://www.youtube.com/watch?v=<script>"]) {
      assert.equal(parseYouTubeId(url), null, url);
    }
  });
});
