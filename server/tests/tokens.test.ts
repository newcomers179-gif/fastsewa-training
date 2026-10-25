import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import {
  generateRefreshToken,
  generateResetCode,
  hashResetCode,
  hashToken,
  signAccessToken,
  signLink,
  verifyAccessToken,
  verifyLink,
} from "../auth/tokens";
import { config } from "../config";

const user = { id: "11111111-2222-3333-4444-555555555555", role: "worker" as const, tokenVersion: 3 };
const base = { typ: "access", role: "worker", tv: 3 };
const sign = (payload: object, opts: jwt.SignOptions = {}, secret = config.auth.jwtSecret) =>
  jwt.sign(payload, secret, { algorithm: "HS256", subject: user.id, issuer: "fastsewa-api", audience: "fastsewa-app", expiresIn: 60, ...opts });

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code ?? "no-code";
  }
  return "no-error";
}

describe("access tokens", () => {
  afterEach(() => {
    config.auth.jwtSecretsPrevious = [];
  });

  it("round-trips the claims", () => {
    const { token, expiresInSeconds } = signAccessToken(user);
    assert.equal(expiresInSeconds, config.auth.accessTtlSeconds);
    assert.deepEqual(verifyAccessToken(token), { userId: user.id, role: "worker", tokenVersion: 3 });
  });

  it("rejects tokens that are not exactly ours", () => {
    assert.equal(codeOf(() => verifyAccessToken("not-a-jwt")), "UNAUTHORIZED");
    assert.equal(codeOf(() => verifyAccessToken(sign(base, {}, "another-secret-another-secret-another"))), "UNAUTHORIZED");
    assert.equal(codeOf(() => verifyAccessToken(sign(base, { audience: "someone-else" }))), "UNAUTHORIZED");
    assert.equal(codeOf(() => verifyAccessToken(sign(base, { issuer: "someone-else" }))), "UNAUTHORIZED");
    assert.equal(codeOf(() => verifyAccessToken(sign({ ...base, typ: "refresh" }))), "UNAUTHORIZED");
    assert.equal(codeOf(() => verifyAccessToken(sign({ ...base, role: "superuser" }))), "UNAUTHORIZED");
    assert.equal(codeOf(() => verifyAccessToken(sign({ typ: "access", role: "worker" }))), "UNAUTHORIZED", "token_version is mandatory");
  });

  it("refuses the 'none' algorithm and other algorithms", () => {
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify({ ...base, sub: user.id, iss: "fastsewa-api", aud: "fastsewa-app" })).toString("base64url")}.`;
    assert.equal(codeOf(() => verifyAccessToken(none)), "UNAUTHORIZED");
    assert.equal(codeOf(() => verifyAccessToken(sign(base, { algorithm: "HS512" }))), "UNAUTHORIZED");
  });

  it("distinguishes an expired token (the app refreshes) from an invalid one (the app signs out)", () => {
    const expired = sign(base, { expiresIn: -10 });
    assert.equal(codeOf(() => verifyAccessToken(expired)), "TOKEN_EXPIRED");
  });

  it("accepts a token signed with a previous secret while the secret is being rotated", () => {
    const oldSecret = "previous-secret-previous-secret-0123456789";
    const token = sign(base, {}, oldSecret);
    assert.equal(codeOf(() => verifyAccessToken(token)), "UNAUTHORIZED");
    config.auth.jwtSecretsPrevious = [oldSecret];
    assert.equal(verifyAccessToken(token).userId, user.id);
  });
});

describe("refresh tokens and reset codes", () => {
  it("generates unguessable, unique refresh tokens and stores only their hash", () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    assert.notEqual(a, b);
    assert.ok(a.length >= 43);
    assert.match(hashToken(a), /^[0-9a-f]{64}$/);
    assert.notEqual(hashToken(a), a);
  });

  it("makes readable reset codes without look-alike characters", () => {
    for (let i = 0; i < 50; i++) assert.match(generateResetCode(), /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/);
  });

  it("binds a reset code to the e-mail address and ignores case/whitespace in what the user types", () => {
    const h = hashResetCode("Asha@Example.com", "abcd2345");
    assert.equal(h, hashResetCode("asha@example.com", " ABCD2345 "));
    assert.notEqual(h, hashResetCode("other@example.com", "ABCD2345"));
    assert.notEqual(h, hashResetCode("asha@example.com", "ABCD2346"));
  });
});

describe("signed download links", () => {
  it("verifies an untouched link", () => {
    const { exp, sig } = signLink("cert:abc", 300);
    assert.equal(verifyLink("cert:abc", exp, sig), true);
    assert.equal(verifyLink("cert:abc", String(exp), sig), true, "query strings arrive as text");
  });

  it("rejects another resource, a changed expiry, a bad or missing signature and an expired link", () => {
    const { exp, sig } = signLink("cert:abc", 300);
    assert.equal(verifyLink("cert:other", exp, sig), false);
    assert.equal(verifyLink("cert:abc", exp + 1000, sig), false);
    assert.equal(verifyLink("cert:abc", exp, sig.replace(/.$/, (c) => (c === "0" ? "1" : "0"))), false);
    assert.equal(verifyLink("cert:abc", exp, undefined), false);
    assert.equal(verifyLink("cert:abc", exp, "short"), false);
    const expired = signLink("cert:abc", -5);
    assert.equal(verifyLink("cert:abc", expired.exp, expired.sig), false);
  });
});
