import { Router, type Request } from "express";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { db } from "../db";
import { err } from "../errors";
import { verifyPassword } from "../auth/password";
import { revokeAllSessions, revokeSessionByToken, rotateSession } from "../auth/sessions";
import { requireAuth } from "../middleware/auth";
import type { Limiters } from "../middleware/rateLimit";
import {
  changePassword,
  eraseAccount,
  exportAccount,
  getAccount,
  loginWithPassword,
  registerWorker,
  requestPasswordReset,
  resetPasswordWithCode,
  updateProfile,
} from "../services/accounts";
import { audit } from "../services/audit";
import { registerPushToken, unregisterPushToken } from "../services/notification";
import { parse } from "../utils/validate";
import {
  changePasswordBody,
  deleteAccountBody,
  forgotPasswordBody,
  loginBody,
  logoutBody,
  pushTokenBody,
  refreshBody,
  registerBody,
  resetPasswordBody,
  updateProfileBody,
} from "../validators";

const meta = (req: Request) => ({ userAgent: req.get("user-agent") });

export function authRoutes(l: Limiters): Router {
  const r = Router();

  // ─── anonymous ─────────────────────────────────────────────────────────────
  r.post("/register", l.anonymous, l.register, async (req, res) => {
    const body = parse(registerBody, req.body);
    res.status(201).json(await registerWorker(body, meta(req)));
  });

  r.post("/login", l.anonymous, l.loginByIp, l.loginByUser, async (req, res) => {
    const body = parse(loginBody, req.body);
    res.json(await loginWithPassword(body, meta(req)));
  });

  r.post("/refresh", l.anonymous, l.refresh, async (req, res) => {
    const body = parse(refreshBody, req.body);
    const { tokens } = await rotateSession(body.refreshToken, meta(req));
    res.json(tokens);
  });

  /**
   * Works without a valid access token on purpose: a client whose access token
   * has expired must still be able to end its session. Possession of the
   * refresh token is the credential. Always answers 200 (idempotent).
   */
  r.post("/logout", l.anonymous, async (req, res) => {
    const body = parse(logoutBody, req.body ?? {});
    await revokeSessionByToken(body.refreshToken);
    res.json({ message: "Logged out" });
  });

  r.post("/forgot-password", l.anonymous, l.forgotByIp, l.forgotByEmail, async (req, res) => {
    const body = parse(forgotPasswordBody, req.body);
    await requestPasswordReset(body.email);
    // Identical answer whether or not the address is registered.
    res.json({ message: "If that email is registered, a reset code has been sent." });
  });

  r.post("/reset-password", l.anonymous, l.resetByIp, async (req, res) => {
    const body = parse(resetPasswordBody, req.body);
    await resetPasswordWithCode(body);
    res.json({ message: "Password reset successful. Please log in again." });
  });

  // ─── signed in ─────────────────────────────────────────────────────────────
  r.use(requireAuth, l.authenticated);

  r.get("/me", async (req, res) => {
    res.json(await getAccount(req.user!.id));
  });

  r.patch("/me", async (req, res) => {
    const body = parse(updateProfileBody, req.body);
    res.json(await updateProfile(req.user!.id, body));
  });

  r.post("/change-password", l.sensitiveAccount, async (req, res) => {
    const body = parse(changePasswordBody, req.body);
    // Every other device is signed out; this one receives a fresh session so the user is not kicked out.
    res.json(await changePassword(req.user!.id, body, meta(req)));
  });

  r.post("/logout-all", async (req, res) => {
    await revokeAllSessions(req.user!.id);
    res.json({ message: "Signed out on all devices" });
  });

  r.post("/push-token", async (req, res) => {
    const body = parse(pushTokenBody, req.body);
    await registerPushToken(req.user!.id, body.token, body.platform);
    res.json({ message: "Registered" });
  });

  r.delete("/push-token", async (req, res) => {
    const body = parse(pushTokenBody.pick({ token: true }), { token: req.body?.token ?? req.query.token });
    await unregisterPushToken(req.user!.id, body.token);
    res.json({ message: "Removed" });
  });

  /** DPDP: right of access — everything the app holds about the signed-in person. */
  r.get("/me/export", l.sensitiveAccount, async (req, res) => {
    const data = await exportAccount(req.user!.id);
    res.set("Content-Disposition", 'attachment; filename="fastsewa-my-data.json"');
    res.json(data);
  });

  /** DPDP: right to erasure. Requires the password so a stolen unlocked phone cannot wipe an account. */
  r.delete("/me", l.sensitiveAccount, async (req, res) => {
    const body = parse(deleteAccountBody, req.body);
    const [row] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!row) throw err("UNAUTHORIZED");
    const { valid } = await verifyPassword(body.password, row.hash);
    if (!valid) throw err("CURRENT_PASSWORD_INCORRECT");

    const userId = req.user!.id;
    await eraseAccount(userId);
    // No username in the entry: the person asked to be forgotten.
    await audit(null, "account.erased", { type: "user", id: userId }, { by: "self" });
    res.json({ message: "Your account and learning records have been deleted." });
  });

  return r;
}
