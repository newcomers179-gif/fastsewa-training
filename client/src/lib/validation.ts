/**
 * Checks a form field before it is sent, with the same rules the server applies (shared/validation.ts),
 * so a typo is explained on the spot instead of after a round trip. Each function answers with a
 * translation key (or null when the value is fine); the screen shows `t(key)` under the field.
 * The server still checks everything again: these are for the person's convenience, not for security.
 */
import {
  checkPassword,
  isValidDisplayName,
  isValidEmail,
  isValidUsername,
  normalizeDisplayName,
  normalizeEmail,
  normalizePhone,
  normalizeUsername,
} from "@shared/validation";

export function validateUsername(raw: string): string | null {
  const username = normalizeUsername(raw);
  if (username === "") return "validation.required";
  return isValidUsername(username) ? null : "validation.username";
}

export function validateDisplayName(raw: string): string | null {
  const name = normalizeDisplayName(raw);
  if (name === "") return "validation.required";
  return isValidDisplayName(name) ? null : "validation.displayName";
}

/** Optional unless `required`. */
export function validateEmail(raw: string, required = false): string | null {
  const email = normalizeEmail(raw);
  if (email === "") return required ? "validation.required" : null;
  return isValidEmail(email) ? null : "validation.email";
}

/** Optional: an empty field is fine, a filled one must be a real number. */
export function validatePhone(raw: string): string | null {
  if (raw.trim() === "") return null;
  return normalizePhone(raw) ? null : "errors.PHONE_INVALID";
}

export function validateNewPassword(password: string, context: { username?: string; staff?: boolean } = {}): string | null {
  if (password === "") return "validation.required";
  const problem = checkPassword(password, context);
  return problem ? `errors.${problem}` : null;
}

export function validateConfirmation(password: string, confirmation: string): string | null {
  if (confirmation === "") return "validation.required";
  return password === confirmation ? null : "validation.passwordMismatch";
}

export function validateRequired(raw: string): string | null {
  return raw.trim() === "" ? "validation.required" : null;
}

/** Drops fields without a problem, so `Object.keys(result).length === 0` means "all good". */
export function onlyProblems(checks: Record<string, string | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, problem] of Object.entries(checks)) if (problem) out[field] = problem;
  return out;
}
