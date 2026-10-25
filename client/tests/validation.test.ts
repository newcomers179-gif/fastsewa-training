/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  onlyProblems,
  validateConfirmation,
  validateDisplayName,
  validateEmail,
  validateNewPassword,
  validatePhone,
  validateRequired,
  validateUsername,
} from "../src/lib/validation";

describe("form checks give a translation key, or null when the value is fine", () => {
  it("username", () => {
    assert.equal(validateUsername(""), "validation.required");
    assert.equal(validateUsername("   "), "validation.required");
    assert.equal(validateUsername("ab"), "validation.username");
    assert.equal(validateUsername("has space"), "validation.username");
    assert.equal(validateUsername("x".repeat(31)), "validation.username");
    assert.equal(validateUsername("  Priya_01 "), null, "case and surrounding spaces are normalised, as the server does");
    assert.equal(validateUsername("worker_ram_2"), null);
    assert.equal(validateUsername("worker.ram-2"), "validation.username", "only letters, digits and _ are allowed");
  });

  it("name on the certificate", () => {
    assert.equal(validateDisplayName(""), "validation.required");
    assert.equal(validateDisplayName("R2D2"), "validation.displayName");
    assert.equal(validateDisplayName("<b>x</b>"), "validation.displayName");
    assert.equal(validateDisplayName("Priya Sharma"), null);
    assert.equal(validateDisplayName("प्रिया शर्मा"), null);
    assert.equal(validateDisplayName("D'Souza"), null);
  });

  it("email is optional unless required", () => {
    assert.equal(validateEmail(""), null);
    assert.equal(validateEmail("", true), "validation.required");
    assert.equal(validateEmail("not-an-email"), "validation.email");
    assert.equal(validateEmail("a@b"), "validation.email");
    assert.equal(validateEmail("  Priya@Example.org "), null);
  });

  it("phone is optional, but a filled one must be a real number", () => {
    assert.equal(validatePhone(""), null);
    assert.equal(validatePhone("   "), null);
    assert.equal(validatePhone("98765 43210"), null);
    assert.equal(validatePhone("+91 98765 43210"), null);
    assert.equal(validatePhone("12345"), "errors.PHONE_INVALID");
    assert.equal(validatePhone("abcdefghij"), "errors.PHONE_INVALID");
  });

  it("new password uses the server's refusal reasons", () => {
    assert.equal(validateNewPassword(""), "validation.required");
    assert.equal(validateNewPassword("short"), "errors.PASSWORD_TOO_SHORT");
    assert.equal(validateNewPassword("password"), "errors.PASSWORD_TOO_COMMON");
    assert.equal(validateNewPassword("12345678"), "errors.PASSWORD_TOO_COMMON");
    assert.equal(validateNewPassword("x".repeat(200)), "errors.PASSWORD_TOO_LONG");
    assert.equal(validateNewPassword("priya_sharma1", { username: "priya_sharma1" }), "errors.PASSWORD_SAME_AS_USERNAME");
    assert.equal(validateNewPassword("Brick&Mortar47"), null);
  });

  it("staff passwords need twelve characters, learners eight", () => {
    assert.equal(validateNewPassword("Brick&Mor47", { staff: true }), "errors.PASSWORD_TOO_SHORT");
    assert.equal(validateNewPassword("Brick&Mortar47", { staff: true }), null);
    assert.equal(validateNewPassword("Brick&Mor47"), null);
  });

  it("confirmation and required", () => {
    assert.equal(validateConfirmation("abc", ""), "validation.required");
    assert.equal(validateConfirmation("abc", "abd"), "validation.passwordMismatch");
    assert.equal(validateConfirmation("abc", "abc"), null);
    assert.equal(validateRequired("  "), "validation.required");
    assert.equal(validateRequired("x"), null);
  });

  it("onlyProblems keeps just the fields that have one", () => {
    assert.deepEqual(onlyProblems({ a: null, b: "validation.required", c: null, d: "validation.email" }), { b: "validation.required", d: "validation.email" });
    assert.deepEqual(onlyProblems({ a: null }), {});
  });
});
