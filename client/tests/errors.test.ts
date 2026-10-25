/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "../src/lib/apiClient";
import { ALL_ERROR_CODES, FIELD_FOR_CODE, errorCode, errorMessage, fieldErrors, isAbort, isFieldError, waitText } from "../src/lib/errors";
import { countText } from "../src/lib/translate";

/** A translator that shows exactly what it was asked for, so the tests see keys and options. */
const t = (key: string, options?: Record<string, unknown>) => (options && Object.keys(options).length > 0 ? `${key}${JSON.stringify(options)}` : key);

describe("waitText", () => {
  it("speaks in seconds up to a minute and a half, then minutes, then hours (rounding up)", () => {
    assert.equal(waitText(0, t), 'wait.seconds_one{"n":1}');
    assert.equal(waitText(0.2, t), 'wait.seconds_one{"n":1}');
    assert.equal(waitText(45, t), 'wait.seconds_other{"n":45}');
    assert.equal(waitText(89, t), 'wait.seconds_other{"n":89}');
    assert.equal(waitText(90, t), 'wait.minutes_other{"n":2}');
    assert.equal(waitText(300, t), 'wait.minutes_other{"n":5}');
    assert.equal(waitText(60 * 89, t), 'wait.minutes_other{"n":89}');
    assert.equal(waitText(3600 * 2, t), 'wait.hours_other{"n":2}');
    assert.equal(waitText(3600 * 24, t), 'wait.hours_other{"n":24}');
  });
});

describe("countText", () => {
  it("chooses the singular only for exactly one", () => {
    assert.equal(countText(t, "common.lessons", 1), 'common.lessons_one{"n":1}');
    assert.equal(countText(t, "common.lessons", 0), 'common.lessons_other{"n":0}');
    assert.equal(countText(t, "common.lessons", 2), 'common.lessons_other{"n":2}');
  });
});

describe("errorMessage", () => {
  it("shows the translation of the server's code and never the server's English sentence", () => {
    const error = new ApiError(403, "QUIZ_LOCKED", "Complete all required lessons of this module before the quiz");
    assert.equal(errorMessage(error, t), 'errors.QUIZ_LOCKED{"wait":"wait.moment"}');
  });

  it("fills {{wait}} from Retry-After", () => {
    const error = new ApiError(429, "QUIZ_ATTEMPTS_EXCEEDED", "x", { retryAfterSeconds: 3 * 3600 });
    assert.equal(errorMessage(error, t), 'errors.QUIZ_ATTEMPTS_EXCEEDED{"wait":"wait.hours_other{\\"n\\":3}"}');
  });

  it("fills {{wait}} from the seconds the server still wants to see on a lesson", () => {
    const error = new ApiError(409, "VIDEO_NOT_WATCHED", "x", { details: { remainingSeconds: 42 } });
    assert.equal(errorMessage(error, t), 'errors.VIDEO_NOT_WATCHED{"wait":"wait.seconds_other{\\"n\\":42}"}');
  });

  it("handles every code the server and the client can produce", () => {
    for (const code of ALL_ERROR_CODES) {
      assert.match(errorMessage(new ApiError(400, code, "x"), t), new RegExp(`^errors\\.${code}`));
    }
  });

  it("falls back to UNKNOWN (or INTERNAL for a 5xx) for a code it has never heard of, and for non-API errors", () => {
    assert.match(errorMessage(new ApiError(400, "SOMETHING_NEW", "x"), t), /^errors\.UNKNOWN/);
    assert.match(errorMessage(new ApiError(500, "SOMETHING_NEW", "x"), t), /^errors\.INTERNAL/);
    for (const value of [new Error("boom"), "text", null, undefined, { code: "NETWORK" }, 42]) {
      assert.match(errorMessage(value, t), /^errors\.UNKNOWN/);
    }
  });

  it("recognises cancellations and extracts codes", () => {
    assert.equal(isAbort(Object.assign(new Error("x"), { name: "AbortError" })), true);
    assert.equal(isAbort(new Error("x")), false);
    assert.equal(isAbort(null), false);
    assert.equal(errorCode(new ApiError(0, "NETWORK", "x")), "NETWORK");
    assert.equal(errorCode(new Error("x")), "UNKNOWN");
  });
});

describe("form field errors", () => {
  it("puts a coded error under its own field, in the learner's language", () => {
    const error = new ApiError(409, "USERNAME_TAKEN", "Username already taken");
    assert.deepEqual(fieldErrors(error, t), { username: 'errors.USERNAME_TAKEN{"wait":"wait.moment"}' });
    assert.equal(isFieldError(error), true);
  });

  it("maps every field-bound code to the field the register / password forms use", () => {
    assert.deepEqual(
      new Set(Object.values(FIELD_FOR_CODE)),
      new Set(["username", "email", "phoneNumber", "password", "registrationCode", "currentPassword", "code", "acceptTerms", "confirmAdult"])
    );
    for (const code of Object.keys(FIELD_FOR_CODE)) assert.ok(ALL_ERROR_CODES.includes(code), `${code} is not a real error code`);
  });

  it("takes the first message of each field of a validation error, keyed by the last path segment", () => {
    const error = new ApiError(400, "VALIDATION_ERROR", "Invalid request", { details: { fields: { displayName: ["Too short", "Other"], "body.email": ["Bad email"] } } });
    assert.deepEqual(fieldErrors(error, t), { displayName: "Too short", email: "Bad email" });
    assert.equal(isFieldError(error), true);
  });

  it("does not claim a general error belongs to a field", () => {
    assert.equal(isFieldError(new ApiError(500, "INTERNAL", "x")), false);
    assert.equal(isFieldError(new Error("x")), false);
    assert.deepEqual(fieldErrors(new Error("x"), t), {});
  });
});
