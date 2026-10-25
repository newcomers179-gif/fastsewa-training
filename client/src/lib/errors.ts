/**
 * Turns whatever went wrong into one sentence in the learner's language.
 *
 * The server sends a stable `code` with every error (shared/errors.ts); the sentence lives in the
 * translation files under `errors.<CODE>`. Nothing here ever prints a server message, an object or a
 * stack trace, so the "[object Object]" screens of the old app cannot come back.
 */
import { ERROR_CODES } from "@shared/errors";
import { ApiError } from "./apiClient";
import { countText, type Translate } from "./translate";

export type { Translate };

/** Codes only the app can produce (see apiClient.ts) plus the catch-alls. */
export const CLIENT_ERROR_CODES = ["NETWORK", "TIMEOUT", "BAD_RESPONSE", "SESSION_EXPIRED", "UNKNOWN"] as const;

/** Every code that needs a translated sentence. client/tests/errors.test.ts checks both languages have all of them. */
export const ALL_ERROR_CODES: readonly string[] = [...ERROR_CODES, ...CLIENT_ERROR_CODES];

/** "45 seconds", "3 minutes", "2 hours" — through the translation files so Hindi reads naturally. */
export function waitText(seconds: number, t: Translate): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 90) return countText(t, "wait.seconds", s);
  const minutes = Math.ceil(s / 60);
  if (minutes < 90) return countText(t, "wait.minutes", minutes);
  return countText(t, "wait.hours", Math.ceil(minutes / 60));
}

export function isAbort(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === "AbortError";
}

export function errorCode(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  return "UNKNOWN";
}

export function errorMessage(error: unknown, t: Translate): string {
  const code = errorCode(error);
  const known = ALL_ERROR_CODES.includes(code) ? code : error instanceof ApiError && error.status >= 500 ? "INTERNAL" : "UNKNOWN";
  const options: Record<string, unknown> = {};
  if (error instanceof ApiError) {
    if (error.retryAfterSeconds !== undefined) options.wait = waitText(error.retryAfterSeconds, t);
    const remaining = (error.details as { remainingSeconds?: unknown } | null | undefined)?.remainingSeconds;
    if (typeof remaining === "number") options.wait = waitText(remaining, t);
  }
  if (options.wait === undefined) options.wait = t("wait.moment");
  return t(`errors.${known}`, options);
}

/** Which form field a code is about (so the message shows under that field instead of in a pop-up). */
export const FIELD_FOR_CODE: Readonly<Record<string, string>> = {
  USERNAME_TAKEN: "username",
  EMAIL_TAKEN: "email",
  PHONE_INVALID: "phoneNumber",
  PASSWORD_TOO_SHORT: "password",
  PASSWORD_TOO_LONG: "password",
  PASSWORD_TOO_COMMON: "password",
  PASSWORD_SAME_AS_USERNAME: "password",
  REGISTRATION_CODE_INVALID: "registrationCode",
  CURRENT_PASSWORD_INCORRECT: "currentPassword",
  RESET_CODE_INVALID: "code",
  CONSENT_REQUIRED: "acceptTerms",
  ADULT_CONFIRMATION_REQUIRED: "confirmAdult",
};

/**
 * Errors keyed by form field. A VALIDATION_ERROR carries the server's own English field messages
 * (the forms check everything locally first, so these appear only when the rules changed under us);
 * every other code maps to its field through FIELD_FOR_CODE, in the learner's language.
 */
export function fieldErrors(error: unknown, t: Translate): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  for (const [path, messages] of Object.entries(error.fields)) {
    if (messages[0]) out[path.split(".").pop() ?? path] = messages[0];
  }
  const field = FIELD_FOR_CODE[error.code];
  if (field) out[field] = errorMessage(error, t);
  return out;
}

/** True when the message belongs to a field and must not also be shown as a general error. */
export function isFieldError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.code in FIELD_FOR_CODE || Object.keys(error.fields).length > 0;
}
