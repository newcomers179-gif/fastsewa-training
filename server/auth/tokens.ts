/**
 * Token primitives.
 *
 *  - Access token: short-lived HS256 JWT. Pinned algorithm, issuer, audience
 *    and an explicit `typ` so a refresh/other token can never be replayed as
 *    one. `tv` is the user's token_version: bumping it in the database
 *    (password change, deactivation, role change) kills every outstanding
 *    access token immediately.
 *  - Refresh token: 256 random bits, opaque. Only its SHA-256 is stored.
 *  - Reset codes and signed download links use HMAC keys derived (HKDF) from
 *    the JWT secret, so a database leak alone does not allow offline guessing.
 */
import { createHash, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { ROLES, type Role } from "@shared/schema";
import { config } from "../config";
import { err } from "../errors";

const ISSUER = "fastsewa-api";
const AUDIENCE = "fastsewa-app";

export interface AccessClaims {
  userId: string;
  role: Role;
  tokenVersion: number;
}

export function signAccessToken(user: { id: string; role: Role; tokenVersion: number }): {
  token: string;
  expiresInSeconds: number;
} {
  const token = jwt.sign({ typ: "access", role: user.role, tv: user.tokenVersion }, config.auth.jwtSecret, {
    algorithm: "HS256",
    subject: user.id,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: config.auth.accessTtlSeconds,
  });
  return { token, expiresInSeconds: config.auth.accessTtlSeconds };
}

export function verifyAccessToken(token: string): AccessClaims {
  // Current secret first, then any previous ones (secret rotation without logging everyone out).
  const secrets = [config.auth.jwtSecret, ...config.auth.jwtSecretsPrevious];
  let payload: JwtPayload | undefined;
  for (const secret of secrets) {
    try {
      const decoded = jwt.verify(token, secret, {
        algorithms: ["HS256"],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      if (typeof decoded === "string") throw err("UNAUTHORIZED");
      payload = decoded;
      break;
    } catch (error) {
      if ((error as Error).name === "TokenExpiredError") throw err("TOKEN_EXPIRED");
      // wrong signature / malformed / wrong issuer: try the next secret
    }
  }
  if (!payload) throw err("UNAUTHORIZED");

  const { sub, typ, role, tv } = payload as JwtPayload & { typ?: string; role?: string; tv?: number };
  if (typ !== "access" || typeof sub !== "string" || typeof tv !== "number" || !ROLES.includes(role as Role)) {
    throw err("UNAUTHORIZED");
  }
  return { userId: sub, role: role as Role, tokenVersion: tv };
}

// ─── Refresh tokens ──────────────────────────────────────────────────────────
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex. Suitable for high-entropy random tokens (not for passwords). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ─── Derived HMAC keys ───────────────────────────────────────────────────────
const keyCache = new Map<string, Buffer>();
function subKey(purpose: string): Buffer {
  let key = keyCache.get(purpose);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", config.auth.jwtSecret, "fastsewa-api", `fastsewa:${purpose}`, 32));
    keyCache.set(purpose, key);
  }
  return key;
}

function hmacHex(purpose: string, data: string): string {
  return createHmac("sha256", subKey(purpose)).update(data).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

// ─── Password-reset codes ────────────────────────────────────────────────────
// No 0/O, 1/I/L: easy to read off a screen and type correctly.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateResetCode(length = 8): string {
  let code = "";
  for (let i = 0; i < length; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return code;
}

export function hashResetCode(email: string, code: string): string {
  return hmacHex("reset-code", `${email.toLowerCase()}:${code.trim().toUpperCase()}`);
}

// ─── Signed, expiring links (certificate PDF download from a browser) ────────
export function signLink(resource: string, ttlSeconds: number): { exp: number; sig: string } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return { exp, sig: hmacHex("signed-link", `${resource}:${exp}`) };
}

export function verifyLink(resource: string, exp: unknown, sig: unknown): boolean {
  const expNum = Number(exp);
  if (!Number.isInteger(expNum) || typeof sig !== "string" || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (expNum < Math.floor(Date.now() / 1000)) return false;
  return safeEqualHex(hmacHex("signed-link", `${resource}:${expNum}`), sig);
}
