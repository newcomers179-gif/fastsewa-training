import { eq } from "drizzle-orm";
import { users, type Role } from "@shared/schema";
import { config } from "../config";
import { db } from "../db";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  tokenVersion: number;
  mustChangePassword: boolean;
}

/**
 * Every authenticated request needs the user's current role / active flag /
 * token version (that is what makes deactivation and password changes take
 * effect immediately). A tiny in-process TTL cache removes most of those
 * lookups. Writes made through this process call invalidateAuthUser() so they
 * apply instantly here; with several API instances another instance may serve
 * the cached value for at most AUTH_CACHE_TTL_MS (default 10 s).
 */
const MAX_ENTRIES = 5000;
const cache = new Map<string, { user: AuthUser; expires: number }>();

export async function loadAuthUser(id: string): Promise<AuthUser | null> {
  const ttl = config.auth.userCacheTtlMs;
  const now = Date.now();
  if (ttl > 0) {
    const hit = cache.get(id);
    if (hit && hit.expires > now) return hit.user;
  }

  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      isActive: users.isActive,
      tokenVersion: users.tokenVersion,
      mustChangePassword: users.mustChangePassword,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!row) return null;

  if (ttl > 0) {
    if (cache.size >= MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(id, { user: row, expires: now + ttl });
  }
  return row;
}

export function invalidateAuthUser(id: string): void {
  cache.delete(id);
}

export function clearAuthCache(): void {
  cache.clear();
}
