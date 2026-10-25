/**
 * Machine-readable error codes returned by the API (`{ error, code, ... }`).
 * The English `error` string is for logs and developers; the mobile app maps
 * `code` to a translated message (see client/src/lib/errors.ts), which is why
 * no screen ever shows "[object Object]" or a raw server sentence again.
 */
export const ERROR_CODES = [
  // generic
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "TOKEN_EXPIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "PAYLOAD_TOO_LARGE",
  "SERVER_BUSY",
  "SERVICE_UNAVAILABLE",
  "INTERNAL",
  // accounts
  "INVALID_CREDENTIALS",
  "ACCOUNT_DISABLED",
  "USERNAME_TAKEN",
  "EMAIL_TAKEN",
  "PHONE_INVALID",
  "REGISTRATION_CLOSED",
  "REGISTRATION_CODE_INVALID",
  "CONSENT_REQUIRED",
  "ADULT_CONFIRMATION_REQUIRED",
  "PASSWORD_TOO_SHORT",
  "PASSWORD_TOO_LONG",
  "PASSWORD_TOO_COMMON",
  "PASSWORD_SAME_AS_USERNAME",
  "CURRENT_PASSWORD_INCORRECT",
  "RESET_CODE_INVALID",
  "PASSWORD_CHANGE_REQUIRED",
  "EMAIL_RESET_UNAVAILABLE",
  // learning
  "NOT_ENROLLED",
  "COURSE_NOT_AVAILABLE",
  "VIDEO_NOT_WATCHED",
  "QUIZ_LOCKED",
  "QUIZ_ATTEMPTS_EXCEEDED",
  "QUIZ_ANSWERS_INVALID",
  // admin / media
  "MEDIA_URL_NOT_ALLOWED",
  "MEDIA_TYPE_NOT_ALLOWED",
  "MEDIA_TOO_LARGE",
  "MEDIA_NOT_CONFIGURED",
  "MEDIA_UPLOAD_NOT_FOUND",
  "COURSE_HAS_RECORDS",
  "LAST_ADMIN",
  "SELF_ACTION_FORBIDDEN",
  "CONFIRMATION_MISMATCH",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
