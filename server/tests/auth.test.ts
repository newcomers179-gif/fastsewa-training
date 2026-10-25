import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { auditLogs, certificates, refreshTokens, users } from "@shared/schema";
import { config } from "../config";
import { db, pool } from "../db";
import { testOutbox } from "../services/email";
import { Api, STRONG_PASSWORD, createCourse, createUser, resetDatabase, shutdown, signIn, startServer, uniq, completeLesson, type TestServer } from "./helpers";

let server: TestServer;
let api: Api;

before(async () => {
  await resetDatabase();
  server = await startServer();
  api = server.api;
});
after(async () => {
  await server.close();
  await shutdown();
});

const registration = (over: Record<string, unknown> = {}) => ({
  username: uniq("reg"),
  password: STRONG_PASSWORD,
  displayName: "Asha Kumari",
  acceptTerms: true,
  confirmAdult: true,
  ...over,
});

describe("registration", () => {
  it("creates a worker, signs them in, and stores only a hash of the password", async () => {
    const body = registration({ phoneNumber: "98765 01234", email: "Asha@Example.com", preferredLang: "hi" });
    const res = await api.post("/api/v1/auth/register", body);
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, "worker");
    assert.equal(res.body.user.phoneNumber, "+919876501234");
    assert.equal(res.body.user.email, "asha@example.com");
    assert.equal(res.body.user.preferredLang, "hi");
    assert.ok(res.body.accessToken && res.body.refreshToken);
    assert.ok(!JSON.stringify(res.body).includes(STRONG_PASSWORD));
    assert.ok(!("passwordHash" in res.body.user));

    const [row] = await db.select().from(users).where(eq(users.id, res.body.user.id));
    assert.match(row.passwordHash, /^scrypt\$/);
    assert.equal(row.consentVersion, config.legal.consentVersion);
    assert.ok(row.consentAcceptedAt);

    const me = await api.get("/api/v1/auth/me", res.body.accessToken);
    assert.equal(me.status, 200);
    assert.equal(me.body.username, body.username);
  });

  it("requires the privacy-policy consent and the adult confirmation", async () => {
    assert.equal((await api.post("/api/v1/auth/register", registration({ acceptTerms: false }))).body.code, "CONSENT_REQUIRED");
    assert.equal((await api.post("/api/v1/auth/register", registration({ acceptTerms: undefined }))).body.code, "CONSENT_REQUIRED");
    assert.equal((await api.post("/api/v1/auth/register", registration({ confirmAdult: false }))).body.code, "ADULT_CONFIRMATION_REQUIRED");
  });

  it("rejects bad input with a precise code", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ password: "short" }, "PASSWORD_TOO_SHORT"],
      [{ password: "password123" }, "PASSWORD_TOO_COMMON"],
      [{ phoneNumber: "12345" }, "PHONE_INVALID"],
      [{ username: "a b" }, "VALIDATION_ERROR"],
      [{ username: "ab" }, "VALIDATION_ERROR"],
      [{ email: "not-an-email" }, "VALIDATION_ERROR"],
      [{ displayName: "Anil 🦺" }, "VALIDATION_ERROR"],
      [{ displayName: "   " }, "VALIDATION_ERROR"],
      [{ displayName: undefined }, "VALIDATION_ERROR"],
    ];
    for (const [over, code] of cases) {
      const res = await api.post("/api/v1/auth/register", registration(over));
      assert.equal(res.status, 400, JSON.stringify(over));
      assert.equal(res.body.code, code, JSON.stringify(over));
      assert.ok(res.body.requestId);
    }
    const same = await api.post("/api/v1/auth/register", registration({ username: "same_as_pw1", password: "same_as_pw1" }));
    assert.equal(same.body.code, "PASSWORD_SAME_AS_USERNAME");
  });

  it("reports which field is wrong for the app to highlight", async () => {
    const res = await api.post("/api/v1/auth/register", registration({ displayName: "Anil 🦺" }));
    assert.deepEqual(Object.keys(res.body.details.fields), ["displayName"]);
  });

  it("treats usernames and e-mails as unique, ignoring case", async () => {
    const name = uniq("dup");
    assert.equal((await api.post("/api/v1/auth/register", registration({ username: name, email: `${name}@example.com` }))).status, 201);
    const again = await api.post("/api/v1/auth/register", registration({ username: name.toUpperCase() }));
    assert.equal(again.status, 409);
    assert.equal(again.body.code, "USERNAME_TAKEN");
    const mail = await api.post("/api/v1/auth/register", registration({ email: `${name.toUpperCase()}@example.com` }));
    assert.equal(mail.body.code, "EMAIL_TAKEN");
  });

  it("survives two simultaneous registrations of the same username (one wins, the other gets a clean 409)", async () => {
    const name = uniq("race");
    const results = await Promise.all([1, 2, 3].map(() => api.post("/api/v1/auth/register", registration({ username: name }))));
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
    assert.ok(results.filter((r) => r.status === 409).every((r) => r.body.code === "USERNAME_TAKEN"));
  });

  it("can be closed or restricted to people who know a site code", async () => {
    const original = { ...config.registration };
    try {
      config.registration.mode = "closed";
      assert.equal((await api.post("/api/v1/auth/register", registration())).body.code, "REGISTRATION_CLOSED");
      assert.equal((await api.get("/api/v1/config")).body.registrationMode, "closed");

      config.registration.mode = "code";
      config.registration.code = "SITE-2026";
      assert.equal((await api.post("/api/v1/auth/register", registration())).body.code, "REGISTRATION_CODE_INVALID");
      assert.equal((await api.post("/api/v1/auth/register", registration({ registrationCode: "wrong" }))).body.code, "REGISTRATION_CODE_INVALID");
      assert.equal((await api.post("/api/v1/auth/register", registration({ registrationCode: "SITE-2026" }))).status, 201);
      assert.equal((await api.get("/api/v1/config")).body.registrationCodeRequired, true);
    } finally {
      Object.assign(config.registration, original);
    }
  });
});

describe("login", () => {
  it("accepts any capitalisation of the username and returns tokens", async () => {
    const user = await createUser({ username: uniq("login") });
    const res = await api.post("/api/v1/auth/login", { username: ` ${user.username.toUpperCase()} `, password: user.password });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.username, user.username);
    assert.equal(res.body.expiresIn, config.auth.accessTtlSeconds);
  });

  it("gives the same answer for a wrong password and an unknown user", async () => {
    const user = await createUser();
    const wrong = await api.post("/api/v1/auth/login", { username: user.username, password: "Wrong#Password1" });
    const unknown = await api.post("/api/v1/auth/login", { username: uniq("nobody"), password: "Wrong#Password1" });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.code, "INVALID_CREDENTIALS");
    assert.equal(wrong.body.error, unknown.body.error);
  });

  it("tells only someone who knows the password that the account is deactivated", async () => {
    const user = await createUser({ isActive: false });
    assert.equal((await api.post("/api/v1/auth/login", { username: user.username, password: "Wrong#Password1" })).body.code, "INVALID_CREDENTIALS");
    const res = await api.post("/api/v1/auth/login", { username: user.username, password: user.password });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "ACCOUNT_DISABLED");
  });

  it("forces a change when the password is one of the known defaults", async () => {
    const user = await createUser({ password: "Admin@1234" });
    const res = await api.post("/api/v1/auth/login", { username: user.username, password: "Admin@1234" });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.mustChangePassword, true);
  });

  it("upgrades a legacy bcrypt hash to scrypt on the first successful login", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    const user = await createUser();
    await db.update(users).set({ passwordHash: bcrypt.hashSync(user.password, 4) }).where(eq(users.id, user.id));
    assert.equal((await api.post("/api/v1/auth/login", { username: user.username, password: user.password })).status, 200);
    const [row] = await db.select({ h: users.passwordHash }).from(users).where(eq(users.id, user.id));
    assert.match(row.h, /^scrypt\$/);
    assert.equal((await api.post("/api/v1/auth/login", { username: user.username, password: user.password })).status, 200);
  });

  it("rejects malformed bodies without touching the database", async () => {
    assert.equal((await api.post("/api/v1/auth/login", {})).status, 400);
    assert.equal((await api.post("/api/v1/auth/login", { username: 5, password: {} })).status, 400);
    assert.equal((await api.request("POST", "/api/v1/auth/login", { body: "{bad json", headers: { "content-type": "application/json" } })).body.code, "VALIDATION_ERROR");
    const huge = await api.post("/api/v1/auth/login", { username: "x", password: "y".repeat(40_000) });
    assert.equal(huge.status, 413);
    assert.equal(huge.body.code, "PAYLOAD_TOO_LARGE");
  });
});

describe("access tokens on protected routes", () => {
  it("are required, and garbage is rejected", async () => {
    assert.equal((await api.get("/api/v1/auth/me")).status, 401);
    assert.equal((await api.get("/api/v1/auth/me", "garbage")).status, 401);
    assert.equal((await api.request("GET", "/api/v1/auth/me", { headers: { authorization: "Basic abc" } })).status, 401);
  });

  it("stop working the moment the account is deactivated or its role changes", async () => {
    const user = await createUser();
    const session = await signIn(api, user);
    assert.equal((await api.get("/api/v1/auth/me", session.token)).status, 200);
    await db.update(users).set({ isActive: false, tokenVersion: 1 }).where(eq(users.id, user.id));
    assert.equal((await api.get("/api/v1/auth/me", session.token)).status, 401);
  });
});

describe("refresh tokens", () => {
  it("rotate on every use", async () => {
    const session = await signIn(api, await createUser());
    const first = await api.post("/api/v1/auth/refresh", { refreshToken: session.refreshToken });
    assert.equal(first.status, 200);
    assert.notEqual(first.body.refreshToken, session.refreshToken);
    assert.equal((await api.get("/api/v1/auth/me", first.body.accessToken)).status, 200);
    const second = await api.post("/api/v1/auth/refresh", { refreshToken: first.body.refreshToken });
    assert.equal(second.status, 200);
  });

  it("tolerate one retry of the same token (the response may have been lost on a weak network)", async () => {
    const session = await signIn(api, await createUser());
    const first = await api.post("/api/v1/auth/refresh", { refreshToken: session.refreshToken });
    const retry = await api.post("/api/v1/auth/refresh", { refreshToken: session.refreshToken });
    assert.equal(first.status, 200);
    assert.equal(retry.status, 200, "inside the grace window the retry succeeds");
    assert.equal((await api.post("/api/v1/auth/refresh", { refreshToken: retry.body.refreshToken })).status, 200);
  });

  it("detect theft: a rotated token replayed after the grace window revokes the whole session", async () => {
    const user = await createUser();
    const session = await signIn(api, user);
    const rotated = await api.post("/api/v1/auth/refresh", { refreshToken: session.refreshToken });
    assert.equal(rotated.status, 200);
    await pool.query(`UPDATE refresh_tokens SET rotated_at = now() - interval '5 minutes' WHERE user_id = $1 AND rotated_at IS NOT NULL`, [user.id]);

    const replay = await api.post("/api/v1/auth/refresh", { refreshToken: session.refreshToken });
    assert.equal(replay.status, 401);
    // The thief's replay also killed the legitimate holder's newest token.
    assert.equal((await api.post("/api/v1/auth/refresh", { refreshToken: rotated.body.refreshToken })).status, 401);
    const alive = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, user.id));
    assert.ok(alive.every((t) => t.revokedAt !== null || t.rotatedAt !== null));
  });

  it("do not outlive the absolute session limit or the account", async () => {
    const user = await createUser();
    const session = await signIn(api, user);
    await pool.query(`UPDATE refresh_tokens SET session_started_at = now() - interval '200 days', expires_at = now() + interval '1 day' WHERE user_id = $1`, [user.id]);
    assert.equal((await api.post("/api/v1/auth/refresh", { refreshToken: session.refreshToken })).status, 401);

    const other = await createUser();
    const s2 = await signIn(api, other);
    await db.update(users).set({ isActive: false }).where(eq(users.id, other.id));
    assert.equal((await api.post("/api/v1/auth/refresh", { refreshToken: s2.refreshToken })).status, 401);
  });

  it("are not accepted when invented", async () => {
    assert.equal((await api.post("/api/v1/auth/refresh", { refreshToken: "x".repeat(43) })).status, 401);
    assert.equal((await api.post("/api/v1/auth/refresh", { refreshToken: "short" })).status, 400);
  });
});

describe("logout", () => {
  it("ends the session even when the access token has expired, and is idempotent", async () => {
    const session = await signIn(api, await createUser());
    assert.equal((await api.post("/api/v1/auth/logout", { refreshToken: session.refreshToken })).status, 200);
    assert.equal((await api.post("/api/v1/auth/refresh", { refreshToken: session.refreshToken })).status, 401);
    assert.equal((await api.post("/api/v1/auth/logout", { refreshToken: session.refreshToken })).status, 200);
    assert.equal((await api.post("/api/v1/auth/logout", {})).status, 200);
  });

  it("logout-all signs every device out and kills outstanding access tokens", async () => {
    const user = await createUser();
    const a = await signIn(api, user);
    const b = await signIn(api, user);
    assert.equal((await api.post("/api/v1/auth/logout-all", {}, a.token)).status, 200);
    assert.equal((await api.get("/api/v1/auth/me", b.token)).status, 401);
    assert.equal((await api.post("/api/v1/auth/refresh", { refreshToken: b.refreshToken })).status, 401);
  });
});

describe("changing the password", () => {
  it("needs the current password, enforces the policy and signs other devices out", async () => {
    const user = await createUser();
    const phone = await signIn(api, user);
    const laptop = await signIn(api, user);

    assert.equal((await api.post("/api/v1/auth/change-password", { currentPassword: "wrong", newPassword: "Brand-New#Pass7" }, phone.token)).body.code, "CURRENT_PASSWORD_INCORRECT");
    assert.equal((await api.post("/api/v1/auth/change-password", { currentPassword: user.password, newPassword: "password123" }, phone.token)).body.code, "PASSWORD_TOO_COMMON");
    assert.equal((await api.post("/api/v1/auth/change-password", { currentPassword: user.password, newPassword: user.password }, phone.token)).status, 400);

    const ok = await api.post("/api/v1/auth/change-password", { currentPassword: user.password, newPassword: "Brand-New#Pass7" }, phone.token);
    assert.equal(ok.status, 200);
    assert.ok(ok.body.accessToken && ok.body.refreshToken, "this device continues with a fresh session");
    assert.equal((await api.get("/api/v1/auth/me", ok.body.accessToken)).status, 200);
    assert.equal((await api.get("/api/v1/auth/me", phone.token)).status, 401, "the old access token is dead");
    assert.equal((await api.get("/api/v1/auth/me", laptop.token)).status, 401, "other devices are signed out");
    assert.equal((await api.post("/api/v1/auth/login", { username: user.username, password: user.password })).status, 401);
    assert.equal((await api.post("/api/v1/auth/login", { username: user.username, password: "Brand-New#Pass7" })).status, 200);
  });

  it("asks staff for a longer password than learners (12 characters vs 8)", async () => {
    const eleven = "Abcde#12345";
    assert.equal(eleven.length, 11);
    const learner = await signIn(api, await createUser());
    assert.equal((await api.post("/api/v1/auth/change-password", { currentPassword: learner.user.password, newPassword: "Abcd#123" }, learner.token)).status, 200, "8 characters are fine for a learner");

    for (const role of ["trainer", "admin"] as const) {
      const staff = await signIn(api, await createUser({ role }));
      const short = await api.post("/api/v1/auth/change-password", { currentPassword: staff.user.password, newPassword: eleven }, staff.token);
      assert.equal(short.status, 400, role);
      assert.equal(short.body.code, "PASSWORD_TOO_SHORT");
      assert.match(short.body.error, /12 characters/);
      const long = await api.post("/api/v1/auth/change-password", { currentPassword: staff.user.password, newPassword: `${eleven}6` }, staff.token);
      assert.equal(long.status, 200, role);
    }
  });

  it("is enforced after an admin issued a temporary password: nothing else works until it is changed", async () => {
    const user = await createUser({ mustChangePassword: true });
    const session = await signIn(api, user);
    assert.equal(session.user.id, user.id);
    const gated = await api.get("/api/v1/courses", session.token);
    assert.equal(gated.status, 403);
    assert.equal(gated.body.code, "PASSWORD_CHANGE_REQUIRED");
    assert.equal((await api.get("/api/v1/auth/me", session.token)).status, 200);
    assert.equal((await api.get("/api/v1/config")).status, 200);

    const changed = await api.post("/api/v1/auth/change-password", { currentPassword: user.password, newPassword: "Brand-New#Pass7" }, session.token);
    assert.equal(changed.status, 200);
    assert.equal(changed.body.user.mustChangePassword, false);
    assert.equal((await api.get("/api/v1/courses", changed.body.accessToken)).status, 200);
  });
});

describe("forgotten password (e-mail code)", () => {
  it("is advertised through /config and answers identically for known and unknown addresses", async () => {
    assert.equal((await api.get("/api/v1/config")).body.passwordResetByEmail, true);
    const user = await createUser({ email: `${uniq("fp")}@example.com` });
    const known = await api.post("/api/v1/auth/forgot-password", { email: user.username });
    assert.equal(known.status, 400, "must be an e-mail address");
    const a = await api.post("/api/v1/auth/forgot-password", { email: `${uniq("ghost")}@example.com` });
    const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, user.id));
    const b = await api.post("/api/v1/auth/forgot-password", { email: row.email });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.deepEqual(a.body, b.body);
  });

  it("lets the code holder choose a new password once, and signs every session out", async () => {
    const email = `${uniq("reset")}@example.com`;
    const user = await createUser({ email });
    const session = await signIn(api, user);
    testOutbox.length = 0;
    assert.equal((await api.post("/api/v1/auth/forgot-password", { email: email.toUpperCase() })).status, 200);
    await new Promise((r) => setTimeout(r, 50)); // the mail is sent after the response
    const mail = testOutbox.find((m) => m.to === email);
    assert.ok(mail?.code, "a code was e-mailed");
    assert.ok(!JSON.stringify(await db.select({ h: users.passwordResetTokenHash }).from(users).where(eq(users.id, user.id))).includes(mail.code!), "only a keyed hash of the code is stored");

    const wrong = await api.post("/api/v1/auth/reset-password", { email, code: "AAAAAAAA", newPassword: "Reset#Pass-77" });
    assert.equal(wrong.body.code, "RESET_CODE_INVALID");
    const ok = await api.post("/api/v1/auth/reset-password", { email, code: mail.code!.toLowerCase(), newPassword: "Reset#Pass-77" });
    assert.equal(ok.status, 200);
    assert.equal((await api.post("/api/v1/auth/reset-password", { email, code: mail.code, newPassword: "Another#Pass-88" })).body.code, "RESET_CODE_INVALID", "a code works once");
    assert.equal((await api.get("/api/v1/auth/me", session.token)).status, 401);
    assert.equal((await api.post("/api/v1/auth/login", { username: user.username, password: "Reset#Pass-77" })).status, 200);
  });

  it("burns a code after five wrong guesses", async () => {
    const email = `${uniq("brute")}@example.com`;
    await createUser({ email });
    testOutbox.length = 0;
    await api.post("/api/v1/auth/forgot-password", { email });
    await new Promise((r) => setTimeout(r, 50));
    const code = testOutbox.find((m) => m.to === email)!.code!;
    for (let i = 0; i < 5; i++) {
      assert.equal((await api.post("/api/v1/auth/reset-password", { email, code: "ZZZZZZZZ", newPassword: "Reset#Pass-77" })).body.code, "RESET_CODE_INVALID");
    }
    assert.equal((await api.post("/api/v1/auth/reset-password", { email, code, newPassword: "Reset#Pass-77" })).body.code, "RESET_CODE_INVALID", "even the right code no longer works");
  });

  it("expires after 30 minutes and is not offered for deactivated accounts", async () => {
    const email = `${uniq("late")}@example.com`;
    const user = await createUser({ email });
    testOutbox.length = 0;
    await api.post("/api/v1/auth/forgot-password", { email });
    await new Promise((r) => setTimeout(r, 50));
    const code = testOutbox.find((m) => m.to === email)!.code!;
    await pool.query(`UPDATE users SET password_reset_expires_at = now() - interval '1 minute' WHERE id = $1`, [user.id]);
    assert.equal((await api.post("/api/v1/auth/reset-password", { email, code, newPassword: "Reset#Pass-77" })).body.code, "RESET_CODE_INVALID");

    const off = await createUser({ email: `${uniq("off")}@example.com`, isActive: false });
    testOutbox.length = 0;
    await api.post("/api/v1/auth/forgot-password", { email: (await db.select({ e: users.email }).from(users).where(eq(users.id, off.id)))[0].e });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(testOutbox.length, 0);
  });
});

describe("profile", () => {
  it("can be updated, with validation and no way to change the role", async () => {
    const session = await signIn(api, await createUser());
    const ok = await api.patch("/api/v1/auth/me", { displayName: "Ramesh Kumar", preferredLang: "hi", phoneNumber: "98765 43210" }, session.token);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.displayName, "Ramesh Kumar");
    assert.equal(ok.body.phoneNumber, "+919876543210");
    assert.equal((await api.patch("/api/v1/auth/me", { displayName: "Ramesh 🦺" }, session.token)).status, 400);
    assert.equal((await api.patch("/api/v1/auth/me", { phoneNumber: "1" }, session.token)).body.code, "PHONE_INVALID");
    assert.equal((await api.patch("/api/v1/auth/me", { role: "admin" }, session.token)).status, 400, "unknown fields are refused");
    assert.equal((await api.get("/api/v1/auth/me", session.token)).body.role, "worker");
    assert.equal((await api.patch("/api/v1/auth/me", { phoneNumber: null }, session.token)).body.phoneNumber, null);
  });

  it("stores and removes push tokens", async () => {
    const session = await signIn(api, await createUser());
    const token = "ExponentPushToken[abcdefghijklmnopqrstuv]";
    assert.equal((await api.post("/api/v1/auth/push-token", { token, platform: "android" }, session.token)).status, 200);
    assert.equal((await api.post("/api/v1/auth/push-token", { token, platform: "android" }, session.token)).status, 200, "idempotent");
    assert.equal((await api.post("/api/v1/auth/push-token", { token: "garbage" }, session.token)).status, 400);
    assert.equal((await api.delete("/api/v1/auth/push-token", { token }, session.token)).status, 200);
  });
});

describe("data export and account deletion (DPDP rights)", () => {
  it("exports everything held about the learner", async () => {
    const user = await createUser();
    const session = await signIn(api, user);
    const fixture = await createCourse();
    await api.post(`/api/v1/courses/${fixture.courseId}/enroll`, {}, session.token);
    await completeLesson(api, session, fixture.modules[0].lessonIds[0]);

    const res = await api.get("/api/v1/auth/me/export", session.token);
    assert.equal(res.status, 200);
    assert.equal(res.body.profile.username, user.username);
    assert.equal(res.body.enrollments.length, 1);
    assert.equal(res.body.lessonProgress.length, 1);
    assert.ok(!JSON.stringify(res.body).includes("scrypt$"), "never the password hash");
  });

  it("erases the account only for someone who proves they know the password", async () => {
    const user = await createUser();
    const session = await signIn(api, user);
    const fixture = await createCourse({ modules: 1 });
    await api.post(`/api/v1/courses/${fixture.courseId}/enroll`, {}, session.token);
    for (const lessonId of fixture.modules[0].lessonIds) await completeLesson(api, session, lessonId);
    await api.post(`/api/v1/quiz/${fixture.modules[0].quizId}/submit`, { answers: fixture.modules[0].answers }, session.token);
    assert.equal((await db.select().from(certificates).where(eq(certificates.userId, user.id))).length, 1);

    assert.equal((await api.delete("/api/v1/auth/me", { password: "wrong-password" }, session.token)).body.code, "CURRENT_PASSWORD_INCORRECT");
    assert.equal((await api.delete("/api/v1/auth/me", {}, session.token)).status, 400);
    const res = await api.delete("/api/v1/auth/me", { password: user.password }, session.token);
    assert.equal(res.status, 200);

    assert.equal((await api.get("/api/v1/auth/me", session.token)).status, 401);
    assert.equal((await api.post("/api/v1/auth/login", { username: user.username, password: user.password })).status, 401);
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    assert.ok(row.deletedAt);
    assert.equal(row.displayName, "Deleted user");
    assert.ok(!row.username.includes(user.username));
    assert.equal(row.email, null);
    assert.equal(row.phoneNumber, null);
    assert.equal((await db.select().from(certificates).where(eq(certificates.userId, user.id))).length, 0);
    const trail = await db.select().from(auditLogs).where(eq(auditLogs.targetId, user.id));
    assert.ok(trail.every((entry) => !JSON.stringify(entry).includes(user.username)), "the audit trail keeps the fact, not the identity");

    assert.equal((await api.post("/api/v1/auth/register", registration({ username: user.username }))).status, 201, "the username is free again");
  });
});

describe("API surface", () => {
  it("answers unknown routes and methods with the standard JSON error", async () => {
    const res = await api.get("/api/v1/nope");
    assert.equal(res.status, 404);
    assert.equal(res.body.code, "NOT_FOUND");
    assert.ok(res.body.requestId);
    assert.equal(res.headers.get("x-request-id"), res.body.requestId);
  });

  it("sets protective headers and never caches API answers", async () => {
    const res = await api.get("/api/v1/config");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-powered-by"), null);
    assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  });

  it("exposes liveness and readiness for the orchestrator", async () => {
    assert.equal((await api.get("/api/health")).body.status, "ok");
    const ready = await api.get("/api/health/ready");
    assert.equal(ready.status, 200);
    assert.equal(ready.body.database.ok, true);
  });

  it("only answers CORS preflights for configured origins", async () => {
    const allowed = await api.request("OPTIONS", "/api/v1/courses", { headers: { origin: "http://localhost:8081", "access-control-request-method": "GET" } });
    assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:8081");
    const denied = await api.request("OPTIONS", "/api/v1/courses", { headers: { origin: "https://evil.example.com", "access-control-request-method": "GET" } });
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
  });
});
