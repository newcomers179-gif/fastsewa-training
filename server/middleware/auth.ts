import type { Request, RequestHandler } from "express";
import type { Role } from "@shared/schema";
import { verifyAccessToken } from "../auth/tokens";
import { loadAuthUser } from "../auth/userCache";
import { err } from "../errors";

/**
 * While `must_change_password` is set (after an admin-issued temporary
 * password, or when a login revealed a well-known default password) the
 * account may only do what is needed to choose a new password.
 */
const ALLOWED_WHILE_MUST_CHANGE = new Set([
  "GET /api/v1/auth/me",
  "POST /api/v1/auth/change-password",
  "POST /api/v1/auth/logout",
  "GET /api/v1/config",
]);

/**
 * Verifies the bearer token and loads the current account into `req.user`.
 * Exposed separately so a route can accept either a bearer token or a signed
 * link (certificate downloads) without duplicating these checks.
 */
export async function authenticate(req: Request): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !/^Bearer\s+\S+$/i.test(header)) throw err("UNAUTHORIZED");

  const claims = verifyAccessToken(header.replace(/^Bearer\s+/i, ""));
  const user = await loadAuthUser(claims.userId);
  // token_version mismatch = the user changed password / was deactivated / re-roled since this token was issued.
  if (!user || !user.isActive || user.tokenVersion !== claims.tokenVersion) throw err("UNAUTHORIZED");

  req.user = { id: user.id, username: user.username, displayName: user.displayName, role: user.role };

  if (user.mustChangePassword) {
    const route = `${req.method} ${req.originalUrl.split("?")[0]}`;
    if (!ALLOWED_WHILE_MUST_CHANGE.has(route)) throw err("PASSWORD_CHANGE_REQUIRED");
  }
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  await authenticate(req);
  next();
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) throw err("FORBIDDEN");
    next();
  };
}

export const isStaff = (role: Role) => role === "admin" || role === "trainer";
