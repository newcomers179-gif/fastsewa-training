import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError, isPgUniqueViolation, normalizeError, rateLimited } from "../errors";
import { csvCell, csvLine } from "../services/reports";
import { escapeLike } from "../utils/params";

describe("CSV export", () => {
  it("neutralises spreadsheet formulas but leaves numbers and phone numbers alone", () => {
    assert.equal(csvCell("=HYPERLINK(\"http://evil\")"), `"'=HYPERLINK(""http://evil"")"`);
    assert.equal(csvCell("+cmd|' /C calc'!A0"), "'+cmd|' /C calc'!A0");
    assert.equal(csvCell("@SUM(1+1)"), "'@SUM(1+1)");
    assert.equal(csvCell("-2+3"), "'-2+3");
    assert.equal(csvCell("\t=1+1"), "'\t=1+1");
    assert.equal(csvCell("+919876543210"), "+919876543210");
    assert.equal(csvCell(-5), "-5");
    assert.equal(csvCell(42), "42");
  });

  it("quotes separators, quotes and line breaks; renders dates and blanks", () => {
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell("two\nlines"), '"two\nlines"');
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(undefined), "");
    assert.equal(csvCell(new Date("2026-10-18T01:02:03Z")), "2026-10-18T01:02:03.000Z");
    assert.equal(csvLine(["a", 1, null]), "a,1,\r\n");
  });
});

describe("LIKE patterns", () => {
  it("escapes wildcard characters typed into a search box", () => {
    assert.equal(escapeLike("100%_done\\"), "100\\%\\_done\\\\");
  });
});

describe("error normalisation", () => {
  const pg = (code: string, extra: object = {}) => Object.assign(new Error("pg"), { code, ...extra });

  it("maps database errors to stable client codes", () => {
    assert.equal(normalizeError(pg("23505", { constraint: "users_username_unique" })).code, "USERNAME_TAKEN");
    assert.equal(normalizeError(pg("23505", { constraint: "users_email_unique" })).code, "EMAIL_TAKEN");
    assert.equal(normalizeError(pg("23505", { constraint: "something_else" })).code, "CONFLICT");
    assert.equal(normalizeError(pg("23503", { message: "update or delete on table \"courses\" violates foreign key" })).code, "COURSE_HAS_RECORDS");
    assert.equal(normalizeError(pg("23503", { message: "insert or update on table \"lessons\" violates foreign key" })).code, "VALIDATION_ERROR");
    assert.equal(normalizeError(pg("23514")).code, "VALIDATION_ERROR");
    for (const code of ["40001", "40P01", "55P03", "57014"]) {
      const e = normalizeError(pg(code));
      assert.equal(e.code, "SERVER_BUSY", code);
      assert.equal(e.status, 503);
    }
    assert.equal(normalizeError(pg("08006")).code, "SERVICE_UNAVAILABLE");
  });

  it("finds the database error inside a wrapper's cause (drizzle wraps driver errors)", () => {
    const wrapped = Object.assign(new Error("Failed query"), { cause: pg("23505", { constraint: "users_username_unique" }) });
    assert.equal(normalizeError(wrapped).code, "USERNAME_TAKEN");
    assert.ok(isPgUniqueViolation(wrapped));
    assert.ok(isPgUniqueViolation(wrapped, "username"));
    assert.ok(!isPgUniqueViolation(wrapped, "email"));
  });

  it("maps connection trouble to 503 and unknown failures to a generic 500 that leaks nothing", () => {
    assert.equal(normalizeError(new Error("timeout exceeded when trying to connect")).code, "SERVICE_UNAVAILABLE");
    assert.equal(normalizeError(new Error("Connection terminated unexpectedly")).code, "SERVICE_UNAVAILABLE");
    const unknown = normalizeError(new Error("SELECT * FROM users WHERE password_hash = 'secret'"));
    assert.equal(unknown.code, "INTERNAL");
    assert.equal(unknown.status, 500);
    assert.ok(!unknown.message.includes("secret"));
  });

  it("maps body-parser and multer failures", () => {
    assert.equal(normalizeError({ type: "entity.too.large" }).code, "PAYLOAD_TOO_LARGE");
    assert.equal(normalizeError({ type: "entity.parse.failed" }).code, "VALIDATION_ERROR");
    assert.equal(normalizeError({ name: "MulterError", code: "LIMIT_FILE_SIZE" }).code, "MEDIA_TOO_LARGE");
  });

  it("builds a 429 with a Retry-After header", () => {
    const e = rateLimited(12.2);
    assert.ok(e instanceof AppError);
    assert.equal(e.status, 429);
    assert.equal(e.headers?.["Retry-After"], "13");
  });
});
