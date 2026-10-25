/**
 * Account lifecycle: register, login, password change/reset, erasure, export.
 * Routes stay thin; every rule lives here so it can be tested without HTTP.
 */
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import {
  auditLogs,
  certificates,
  courseEnrollments,
  lessonProgress,
  moduleProgress,
  pushDevices,
  quizAttempts,
  refreshTokens,
  users,
  type Role,
} from "@shared/schema";
import {
  checkPassword,
  isValidEmail,
  isValidUsername,
  normalizeEmail,
  normalizePhone,
  normalizeUsername,
  PASSWORD_MIN_STAFF,
} from "@shared/validation";
import { config } from "../config";
import { db, type DbOrTx } from "../db";
import { AppError, err } from "../errors";
import { logger } from "../logger";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "../auth/password";
import { createSession, revokeAllSessions, type SessionTokens } from "../auth/sessions";
import { generateResetCode, hashResetCode, safeEqualHex } from "../auth/tokens";
import { invalidateAuthUser } from "../auth/userCache";
import { isEmailConfigured, sendPasswordResetEmail } from "./email";

type UserRow = typeof users.$inferSelect;

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  preferredLang: "en" | "hi";
  avatarUrl: string | null;
  email: string | null;
  phoneNumber: string | null;
  mustChangePassword: boolean;
  createdAt: Date;
}

export function publicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    preferredLang: u.preferredLang,
    avatarUrl: u.avatarUrl,
    email: u.email,
    phoneNumber: u.phoneNumber,
    mustChangePassword: u.mustChangePassword,
    createdAt: u.createdAt,
  };
}

const validationError = (field: string, message: string) =>
  new AppError("VALIDATION_ERROR", { details: { fields: { [field]: [message] } } });

const sha = (s: string) => createHash("sha256").update(s).digest();
const safeEqualText = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

export interface SessionMeta {
  userAgent?: string | null;
}

export interface AuthResult extends SessionTokens {
  user: PublicUser;
}

// ─── fields shared by register / profile / admin ─────────────────────────────
export function cleanUsername(raw: string): string {
  const username = normalizeUsername(raw);
  if (!isValidUsername(username)) {
    throw validationError("username", "Use 3–30 letters, numbers or underscores");
  }
  return username;
}

export function cleanEmail(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  const email = normalizeEmail(raw);
  if (!isValidEmail(email)) throw validationError("email", "Enter a valid email address");
  return email;
}

export function cleanPhone(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  const phone = normalizePhone(raw);
  if (!phone) throw err("PHONE_INVALID");
  return phone;
}

/** `role` is given for existing accounts: staff (admin, trainer) need a longer password than learners. */
export function assertPasswordAllowed(password: string, username?: string, role?: string): void {
  const staff = role !== undefined && role !== "worker";
  const problem = checkPassword(password, { username, staff });
  if (!problem) return;
  if (problem === "PASSWORD_TOO_SHORT" && staff) throw err(problem, { message: `Staff passwords need at least ${PASSWORD_MIN_STAFF} characters` });
  throw err(problem);
}

// ─── profile ─────────────────────────────────────────────────────────────────
export async function getAccount(userId: string): Promise<PublicUser> {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), sql`${users.deletedAt} IS NULL`))
    .limit(1);
  if (!user) throw err("UNAUTHORIZED");
  return publicUser(user);
}

export interface ProfilePatch {
  displayName?: string;
  preferredLang?: "en" | "hi";
  /** `null` clears the value, `undefined` leaves it alone. */
  phoneNumber?: string | null;
  email?: string | null;
}

export async function updateProfile(userId: string, patch: ProfilePatch): Promise<PublicUser> {
  const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (patch.displayName !== undefined) set.displayName = patch.displayName.trim();
  if (patch.preferredLang !== undefined) set.preferredLang = patch.preferredLang;
  if (patch.phoneNumber !== undefined) set.phoneNumber = cleanPhone(patch.phoneNumber);
  if (patch.email !== undefined) set.email = cleanEmail(patch.email);

  const [updated] = await db.update(users).set(set).where(eq(users.id, userId)).returning();
  if (!updated) throw err("UNAUTHORIZED");
  invalidateAuthUser(userId); // the cached display name is stale now
  return publicUser(updated);
}

// ─── register ────────────────────────────────────────────────────────────────
export interface RegisterInput {
  username: string;
  password: string;
  displayName: string;
  email?: string | null;
  phoneNumber?: string | null;
  preferredLang?: "en" | "hi";
  registrationCode?: string;
  acceptTerms?: boolean;
  confirmAdult?: boolean;
}

export async function registerWorker(input: RegisterInput, meta: SessionMeta): Promise<AuthResult> {
  const { mode, code } = config.registration;
  if (mode === "closed") throw err("REGISTRATION_CLOSED");
  if (mode === "code" && !(input.registrationCode && code && safeEqualText(input.registrationCode, code))) {
    throw err("REGISTRATION_CODE_INVALID");
  }
  if (!input.acceptTerms) throw err("CONSENT_REQUIRED");
  if (!input.confirmAdult) throw err("ADULT_CONFIRMATION_REQUIRED");

  const username = cleanUsername(input.username);
  assertPasswordAllowed(input.password, username);
  const email = cleanEmail(input.email);
  const phone = cleanPhone(input.phoneNumber);

  // Cheap uniqueness pre-check so a taken name does not cost a password hash;
  // the unique indexes remain the real guarantee (a lost race maps to the same errors).
  const [taken] = await db
    .select({ username: users.username, email: users.email })
    .from(users)
    .where(email ? sql`${users.username} = ${username} OR ${users.email} = ${email}` : eq(users.username, username))
    .limit(1);
  if (taken) throw err(taken.username === username ? "USERNAME_TAKEN" : "EMAIL_TAKEN");

  const passwordHash = await hashPassword(input.password);
  const [user] = await db
    .insert(users)
    .values({
      username,
      passwordHash,
      displayName: input.displayName.trim(),
      email,
      phoneNumber: phone,
      preferredLang: input.preferredLang ?? "en",
      role: "worker",
      consentVersion: config.legal.consentVersion,
      consentAcceptedAt: new Date(),
      lastLoginAt: new Date(),
    })
    .returning();

  const tokens = await createSession(user, meta);
  return { user: publicUser(user), ...tokens };
}

// ─── login ───────────────────────────────────────────────────────────────────
export async function loginWithPassword(input: { username: string; password: string }, meta: SessionMeta): Promise<AuthResult> {
  const username = normalizeUsername(input.username);
  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);

  if (!user || user.deletedAt) {
    await verifyAgainstDummy(input.password); // same cost as a real check: no username enumeration by timing
    throw err("INVALID_CREDENTIALS");
  }
  const { valid, needsRehash } = await verifyPassword(input.password, user.passwordHash);
  if (!valid) throw err("INVALID_CREDENTIALS");
  // Only someone who knows the password learns that the account is disabled.
  if (!user.isActive) throw err("ACCOUNT_DISABLED");

  const updates: Partial<typeof users.$inferInsert> = { lastLoginAt: new Date() };
  if (needsRehash) updates.passwordHash = await hashPassword(input.password);
  // A shipped default / very common password still works once — and must be replaced right away.
  const weak = checkPassword(input.password, { username });
  if (weak === "PASSWORD_TOO_COMMON" || weak === "PASSWORD_SAME_AS_USERNAME") updates.mustChangePassword = true;

  const [updated] = await db.update(users).set(updates).where(eq(users.id, user.id)).returning();
  invalidateAuthUser(user.id);
  const tokens = await createSession(updated, meta);
  return { user: publicUser(updated), ...tokens };
}

// ─── change password (knows the current one) ─────────────────────────────────
export async function changePassword(
  userId: string,
  input: { currentPassword: string; newPassword: string },
  meta: SessionMeta
): Promise<AuthResult> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw err("UNAUTHORIZED");
  const { valid } = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!valid) throw err("CURRENT_PASSWORD_INCORRECT");
  assertPasswordAllowed(input.newPassword, user.username, user.role);
  if (input.newPassword === input.currentPassword) {
    throw validationError("newPassword", "The new password must be different from the current one");
  }

  const passwordHash = await hashPassword(input.newPassword);
  return db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: false,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        passwordResetAttempts: 0,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    // Every other device is signed out and every old access token dies; this device gets a fresh session.
    await revokeAllSessions(userId, tx);
    const [fresh] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    const tokens = await createSession(fresh, meta, tx);
    return { user: publicUser(fresh), ...tokens };
  });
}

// ─── forgot / reset (by e-mail code) ─────────────────────────────────────────
const RESET_TTL_MS = 30 * 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;

export async function requestPasswordReset(rawEmail: string): Promise<void> {
  if (!isEmailConfigured()) throw err("EMAIL_RESET_UNAVAILABLE");
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) throw validationError("email", "Enter a valid email address");

  const [user] = await db
    .select({ id: users.id, displayName: users.displayName, isActive: users.isActive, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Same response whether or not the address is registered (no account enumeration).
  if (!user || !user.isActive || user.deletedAt) return;

  const code = generateResetCode();
  await db
    .update(users)
    .set({
      passwordResetTokenHash: hashResetCode(email, code),
      passwordResetExpiresAt: new Date(Date.now() + RESET_TTL_MS),
      passwordResetAttempts: 0,
    })
    .where(eq(users.id, user.id));

  // Not awaited: sending takes longer than "no such account", and the difference must not be observable.
  void sendPasswordResetEmail(email, code, user.displayName).catch((error) =>
    logger.error({ err: error }, "failed to send password reset email")
  );
}

export async function resetPasswordWithCode(input: { email: string; code: string; newPassword: string }): Promise<void> {
  const email = normalizeEmail(input.email);
  assertPasswordAllowed(input.newPassword); // policy errors are independent of the account

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const now = new Date();
  const usable =
    !!user &&
    user.isActive &&
    !user.deletedAt &&
    !!user.passwordResetTokenHash &&
    !!user.passwordResetExpiresAt &&
    user.passwordResetExpiresAt > now &&
    user.passwordResetAttempts < RESET_MAX_ATTEMPTS;
  if (!usable) throw err("RESET_CODE_INVALID");

  if (!safeEqualHex(user.passwordResetTokenHash!, hashResetCode(email, input.code))) {
    const [bumped] = await db
      .update(users)
      .set({ passwordResetAttempts: sql`${users.passwordResetAttempts} + 1` })
      .where(eq(users.id, user.id))
      .returning({ attempts: users.passwordResetAttempts });
    if (bumped && bumped.attempts >= RESET_MAX_ATTEMPTS) {
      // Too many wrong guesses: this code is burnt, a new one must be requested.
      await db.update(users).set({ passwordResetTokenHash: null, passwordResetExpiresAt: null }).where(eq(users.id, user.id));
    }
    throw err("RESET_CODE_INVALID");
  }
  // The code was right, so it is safe to apply the account-specific rule (staff need a longer password).
  assertPasswordAllowed(input.newPassword, user.username, user.role);

  const passwordHash = await hashPassword(input.newPassword);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: false,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        passwordResetAttempts: 0,
        updatedAt: now,
      })
      .where(eq(users.id, user.id));
    await revokeAllSessions(user.id, tx);
  });
}

// ─── admin-issued temporary passwords ────────────────────────────────────────
const TEMP_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

/** Learners get a short one (it is read out in person or over the phone); staff accounts hold admin powers, so theirs is longer. */
export const LEARNER_TEMP_PASSWORD_LENGTH = 10;
export const STAFF_TEMP_PASSWORD_LENGTH = 16;

export function generateTemporaryPassword(length = LEARNER_TEMP_PASSWORD_LENGTH): string {
  return Array.from({ length }, () => TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)]).join("");
}

/** Sets a one-time password, signs the user out everywhere and forces a change at next login. */
export async function setTemporaryPassword(userId: string, dbc: DbOrTx = db, length = LEARNER_TEMP_PASSWORD_LENGTH): Promise<string> {
  const temporary = generateTemporaryPassword(length);
  const passwordHash = await hashPassword(temporary);
  await dbc
    .update(users)
    .set({
      passwordHash,
      mustChangePassword: true,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      passwordResetAttempts: 0,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
  await revokeAllSessions(userId, dbc);
  return temporary;
}

// ─── erasure and export (DPDP: right to erasure / access) ────────────────────
export async function countOtherActiveAdmins(dbc: DbOrTx, exceptUserId: string): Promise<number> {
  const [row] = await dbc
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isActive, true), sql`${users.deletedAt} IS NULL`, ne(users.id, exceptUserId)));
  return row?.n ?? 0;
}

/** Serialises changes that could remove the last active admin (demote, deactivate, erase). */
export async function lockAdmins(tx: DbOrTx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('fastsewa:admins', 0))`);
}

/**
 * Erases a person: learning records, certificates, sessions and devices are
 * deleted; the user row stays as an anonymous tombstone ("Deleted user") so
 * audit-log entries and foreign keys remain consistent. Callers decide
 * whether the actor may do this (the user themself, or an admin).
 */
export async function eraseAccount(userId: string, dbc: DbOrTx = db): Promise<void> {
  const run = async (tx: DbOrTx) => {
    await lockAdmins(tx);
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw err("NOT_FOUND", { message: "User not found" });
    if (user.role === "admin" && user.isActive && (await countOtherActiveAdmins(tx, userId)) === 0) throw err("LAST_ADMIN");

    await tx.delete(lessonProgress).where(eq(lessonProgress.userId, userId));
    await tx.delete(moduleProgress).where(eq(moduleProgress.userId, userId));
    await tx.delete(quizAttempts).where(eq(quizAttempts.userId, userId));
    await tx.delete(courseEnrollments).where(eq(courseEnrollments.userId, userId));
    await tx.delete(certificates).where(eq(certificates.userId, userId));
    await tx.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
    await tx.delete(pushDevices).where(eq(pushDevices.userId, userId));
    // Audit entries stay (they describe what staff did), but the erased person's name must not.
    await tx.update(auditLogs).set({ actorUsername: null }).where(eq(auditLogs.actorId, userId));

    const unusable = await hashPassword(generateTemporaryPassword(32));
    await tx
      .update(users)
      .set({
        username: `deleted_${userId.replace(/-/g, "").slice(0, 16)}`,
        displayName: "Deleted user",
        email: null,
        phoneNumber: null,
        avatarUrl: null,
        expoPushToken: null,
        passwordHash: unusable,
        isActive: false,
        mustChangePassword: false,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        consentVersion: null,
        consentAcceptedAt: null,
        deletedAt: new Date(),
        updatedAt: new Date(),
        tokenVersion: sql`${users.tokenVersion} + 1`,
      })
      .where(eq(users.id, userId));
  };

  if (dbc === db) await db.transaction(run);
  else await run(dbc);
  invalidateAuthUser(userId);
}

export async function exportAccount(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw err("NOT_FOUND", { message: "User not found" });
  const [enrollments, lessons, modulesDone, attempts, certs] = await Promise.all([
    db.select().from(courseEnrollments).where(eq(courseEnrollments.userId, userId)),
    db.select().from(lessonProgress).where(eq(lessonProgress.userId, userId)),
    db.select().from(moduleProgress).where(eq(moduleProgress.userId, userId)),
    db.select().from(quizAttempts).where(eq(quizAttempts.userId, userId)),
    db.select().from(certificates).where(eq(certificates.userId, userId)),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    profile: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: user.role,
      preferredLanguage: user.preferredLang,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      consent: { version: user.consentVersion, acceptedAt: user.consentAcceptedAt },
    },
    enrollments,
    lessonProgress: lessons,
    moduleProgress: modulesDone,
    quizAttempts: attempts,
    certificates: certs,
  };
}
