/**
 * Dependency-free validation helpers shared by the API (server/) and the
 * mobile app (client/). Keep this file free of Node- or React-specific
 * imports so Metro and esbuild can both bundle it as-is.
 *
 * One definition of "what is a valid username / phone number / password"
 * means the on-screen hints, the client-side checks and the server's
 * authoritative checks can never drift apart again (the old regex rejected
 * the very placeholder the register screen suggested: "+91 9876543210").
 */

// ─── Usernames ───────────────────────────────────────────────────────────────
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const USERNAME_RE = /^[a-z0-9_]+$/;

/** Usernames are case-insensitive; we always store and compare lower-case. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidUsername(normalized: string): boolean {
  return (
    normalized.length >= USERNAME_MIN &&
    normalized.length <= USERNAME_MAX &&
    USERNAME_RE.test(normalized)
  );
}

// ─── Display names ───────────────────────────────────────────────────────────
export const DISPLAY_NAME_MAX = 60;
/**
 * Names are printed on certificates, which embed one Latin and one Devanagari font. A name in any
 * other script (or with digits/emoji) would come out as "?" on the certificate, so it is refused
 * up front with a clear message instead of failing later on a document someone has to reissue.
 */
const NAME_CHARS = "A-Za-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F\\u0900-\\u097F\\u200C\\u200D";
export const DISPLAY_NAME_RE = new RegExp(`^[${NAME_CHARS}][${NAME_CHARS} .'\u2019-]*$`);

export function normalizeDisplayName(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function isValidDisplayName(normalized: string): boolean {
  return normalized.length > 0 && normalized.length <= DISPLAY_NAME_MAX && DISPLAY_NAME_RE.test(normalized);
}

// ─── Email ───────────────────────────────────────────────────────────────────
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(normalized: string): boolean {
  return normalized.length <= 254 && EMAIL_RE.test(normalized);
}

// ─── Phone numbers ───────────────────────────────────────────────────────────
/**
 * Normalises a phone number to E.164 ("+919876543210") or returns null.
 *
 * Accepts the formats people actually type: "9876543210", "09876543210",
 * "+91 98765 43210", "91-9876543210", "0091 9876543210" and other countries'
 * numbers written with a leading "+" (8–15 digits). Indian mobile numbers
 * must be 10 digits starting 6–9.
 */
export function normalizePhone(raw: string, defaultCountryCode = "91"): string | null {
  let s = raw.trim().replace(/[\s\-().]/g, "");
  if (!s) return null;
  if (s.startsWith("00")) s = "+" + s.slice(2);

  if (s.startsWith("+")) {
    const digits = s.slice(1);
    if (!/^\d{8,15}$/.test(digits)) return null;
    if (digits.startsWith("91")) {
      // India: country code + exactly 10 digits, mobile numbers start 6-9.
      if (digits.length !== 12 || !/^[6-9]/.test(digits[2])) return null;
    }
    return "+" + digits;
  }

  if (!/^\d+$/.test(s)) return null;
  if (s.length === 12 && s.startsWith(defaultCountryCode)) s = s.slice(defaultCountryCode.length);
  else if (s.length === 11 && s.startsWith("0")) s = s.slice(1);
  if (defaultCountryCode === "91") {
    return s.length === 10 && /^[6-9]/.test(s) ? `+91${s}` : null;
  }
  return s.length >= 8 && s.length <= 12 ? `+${defaultCountryCode}${s}` : null;
}

// ─── Passwords ───────────────────────────────────────────────────────────────
export const PASSWORD_MIN = 8;
/** Admins and trainers can see and change every learner's data, so their passwords must be longer. */
export const PASSWORD_MIN_STAFF = 12;
export const PASSWORD_MAX = 128;

export type PasswordProblem =
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_TOO_LONG"
  | "PASSWORD_TOO_COMMON"
  | "PASSWORD_SAME_AS_USERNAME";

/**
 * A compact deny-list of the passwords attackers try first (plus every
 * default credential this project ever shipped). It is NOT a substitute for
 * a breached-password check; it just stops the laziest choices.
 */
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "password1234", "passw0rd", "p@ssw0rd", "p@ssword",
  "12345678", "123456789", "1234567890", "123123123", "11111111", "00000000", "87654321", "12341234",
  "qwertyui", "qwerty123", "qwertyuiop", "qwerty12", "1q2w3e4r", "1qaz2wsx", "asdfghjk", "zxcvbnm1",
  "abcd1234", "abc12345", "abcdefgh", "iloveyou", "letmein1", "welcome1", "welcome123", "monkey123",
  "dragon123", "football1", "baseball1", "superman", "sunshine", "princess", "trustno1", "changeme",
  "changeme1", "changeme123", "admin123", "admin1234", "admin@123", "admin@1234", "administrator",
  "trainer123", "trainer@123", "worker123", "worker@123", "fastsewa", "fastsewa1", "fastsewa123",
  "fastsewa@123", "construction", "construction1", "india123", "india@123", "indian123", "jaishreeram",
  "ramesh123", "priya123", "test1234", "testtest", "guest123", "default1", "secret123", "login123",
]);

export function checkPassword(
  password: string,
  context: { username?: string; staff?: boolean } = {}
): PasswordProblem | null {
  if (password.length < (context.staff ? PASSWORD_MIN_STAFF : PASSWORD_MIN)) return "PASSWORD_TOO_SHORT";
  if (password.length > PASSWORD_MAX) return "PASSWORD_TOO_LONG";
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return "PASSWORD_TOO_COMMON";
  if (/^(.)\1+$/.test(password)) return "PASSWORD_TOO_COMMON"; // "aaaaaaaa"
  if (context.username && lower === normalizeUsername(context.username)) {
    return "PASSWORD_SAME_AS_USERNAME";
  }
  return null;
}

// ─── Media URLs ──────────────────────────────────────────────────────────────
const YT_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

/** Extracts the video id from any common YouTube URL shape, or null. */
export function parseYouTubeId(url: string): string | null {
  const m = url.match(
    /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:embed\/|v\/|shorts\/|live\/|watch\?(?:[^#]*&)?v=))([A-Za-z0-9_-]{6,20})/
  );
  const id = m?.[1];
  return id && YT_ID_RE.test(id) ? id : null;
}
