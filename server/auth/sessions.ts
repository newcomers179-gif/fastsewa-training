/**
 * Login sessions = a family of rotating, opaque refresh tokens.
 *
 *   login            → new family, token #1
 *   refresh(token#n) → token#n marked rotated, token#n+1 issued (same family)
 *   refresh(token#n) again later → the token was already used: it was either
 *       copied (theft) or replayed → the whole family is revoked.
 *
 * A mobile client on a flaky network can legitimately retry a refresh whose
 * response it never received. For REUSE_GRACE_MS the previous token may be
 * presented again *if its replacement was never used*; the unused replacement
 * is revoked and a fresh one issued, so the user stays signed in.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { refreshTokens, users, type Role } from "@shared/schema";
import { config } from "../config";
import { db, type DbOrTx } from "../db";
import { err } from "../errors";
import { logger } from "../logger";
import { generateRefreshToken, hashToken, signAccessToken } from "./tokens";
import { invalidateAuthUser } from "./userCache";

const REUSE_GRACE_MS = 30_000;
const DAY_MS = 86_400_000;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  tokenVersion: number;
}

const clip = (value: string | null | undefined, max: number) => (value ? value.slice(0, max) : null);

function refreshExpiry(sessionStartedAt: Date): Date {
  const sliding = Date.now() + config.auth.refreshTtlDays * DAY_MS;
  const absolute = sessionStartedAt.getTime() + config.auth.sessionMaxDays * DAY_MS;
  return new Date(Math.min(sliding, absolute));
}

export async function createSession(
  user: Pick<SessionUser, "id" | "role" | "tokenVersion">,
  meta: { userAgent?: string | null } = {},
  dbc: DbOrTx = db
): Promise<SessionTokens> {
  const refreshToken = generateRefreshToken();
  const startedAt = new Date();
  await dbc.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    sessionStartedAt: startedAt,
    expiresAt: refreshExpiry(startedAt),
    userAgent: clip(meta.userAgent, 200),
  });
  const access = signAccessToken(user);
  return { accessToken: access.token, refreshToken, expiresIn: access.expiresInSeconds };
}

async function revokeFamily(dbc: DbOrTx, familyId: string): Promise<void> {
  await dbc
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

type RotateOutcome =
  | { kind: "ok"; tokens: SessionTokens; user: SessionUser }
  | { kind: "reject"; reason: "unknown" | "revoked" | "expired" | "inactive" | "reuse" | "max-age" };

export async function rotateSession(
  rawToken: unknown,
  meta: { userAgent?: string | null } = {}
): Promise<{ tokens: SessionTokens; user: SessionUser }> {
  // Accept any plausible opaque string (legacy refresh JWTs are ~200 chars and still map to a stored hash).
  if (typeof rawToken !== "string" || rawToken.length < 16 || rawToken.length > 1024) {
    throw err("UNAUTHORIZED", { message: "Invalid refresh token" });
  }
  const hash = hashToken(rawToken);

  const outcome = await db.transaction(async (tx): Promise<RotateOutcome> => {
    // The row lock serialises concurrent refreshes with the same token (double tap, retries).
    const [row] = await tx.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hash)).for("update").limit(1);
    if (!row) return { kind: "reject", reason: "unknown" };

    const now = new Date();
    if (row.revokedAt) return { kind: "reject", reason: "revoked" };
    if (row.expiresAt <= now) return { kind: "reject", reason: "expired" };
    if (row.sessionStartedAt.getTime() + config.auth.sessionMaxDays * DAY_MS <= now.getTime()) {
      return { kind: "reject", reason: "max-age" };
    }

    const [user] = await tx
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        tokenVersion: users.tokenVersion,
        isActive: users.isActive,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.id, row.userId))
      .limit(1);
    if (!user || !user.isActive || user.deletedAt) {
      await revokeFamily(tx, row.familyId);
      return { kind: "reject", reason: "inactive" };
    }

    if (row.rotatedAt) {
      // This token was already exchanged once.
      let retry = false;
      if (now.getTime() - row.rotatedAt.getTime() <= REUSE_GRACE_MS && row.replacedById) {
        const [child] = await tx
          .select()
          .from(refreshTokens)
          .where(eq(refreshTokens.id, row.replacedById))
          .for("update")
          .limit(1);
        if (child && !child.revokedAt && !child.rotatedAt && !child.lastUsedAt) {
          await tx.update(refreshTokens).set({ revokedAt: now }).where(eq(refreshTokens.id, child.id));
          retry = true;
        }
      }
      if (!retry) {
        await revokeFamily(tx, row.familyId);
        return { kind: "reject", reason: "reuse" };
      }
    }

    const next = generateRefreshToken();
    const [child] = await tx
      .insert(refreshTokens)
      .values({
        userId: row.userId,
        tokenHash: hashToken(next),
        familyId: row.familyId,
        sessionStartedAt: row.sessionStartedAt,
        expiresAt: refreshExpiry(row.sessionStartedAt),
        userAgent: clip(meta.userAgent, 200) ?? row.userAgent,
      })
      .returning({ id: refreshTokens.id });
    await tx
      .update(refreshTokens)
      .set({ rotatedAt: row.rotatedAt ?? now, lastUsedAt: now, replacedById: child.id })
      .where(eq(refreshTokens.id, row.id));

    const access = signAccessToken(user);
    return {
      kind: "ok",
      tokens: { accessToken: access.token, refreshToken: next, expiresIn: access.expiresInSeconds },
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        tokenVersion: user.tokenVersion,
      },
    };
  });

  if (outcome.kind === "reject") {
    // Thrown after the transaction committed, so a revoked family stays revoked.
    if (outcome.reason === "reuse") {
      logger.warn({ event: "refresh_token_reuse" }, "refresh token reuse detected: session family revoked");
    }
    throw err("UNAUTHORIZED", { message: "Invalid refresh token" });
  }
  return { tokens: outcome.tokens, user: outcome.user };
}

/** Sign out one device (the family the token belongs to). Unknown tokens are ignored. */
export async function revokeSessionByToken(rawToken: unknown): Promise<void> {
  if (typeof rawToken !== "string" || rawToken.length < 16 || rawToken.length > 1024) return;
  const [row] = await db
    .select({ familyId: refreshTokens.familyId })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashToken(rawToken)))
    .limit(1);
  if (row) await revokeFamily(db, row.familyId);
}

/** Sign out every device, and invalidate outstanding access tokens immediately. */
export async function revokeAllSessions(userId: string, dbc: DbOrTx = db): Promise<void> {
  await dbc
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  await bumpTokenVersion(userId, dbc);
}

/** Invalidates all access tokens of a user (used on password change, deactivation, role change). */
export async function bumpTokenVersion(userId: string, dbc: DbOrTx = db): Promise<void> {
  await dbc
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, userId));
  invalidateAuthUser(userId);
}

/**
 * Deletes tokens that can no longer matter: expired ones, and rotated/revoked
 * ones past the reuse-detection window. Batched so it never holds a long lock.
 */
export async function purgeSessions(batch = 5000): Promise<number> {
  let total = 0;
  for (;;) {
    const result = await db.execute(sql`
      DELETE FROM refresh_tokens
      WHERE id IN (
        SELECT id FROM refresh_tokens
        WHERE expires_at < now() - interval '1 day'
           OR rotated_at < now() - interval '2 days'
           OR revoked_at < now() - interval '2 days'
        LIMIT ${batch}
      )
    `);
    const n = result.rowCount ?? 0;
    total += n;
    if (n < batch) return total;
  }
}
