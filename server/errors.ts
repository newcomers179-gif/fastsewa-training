import type { ErrorCode } from "@shared/errors";

/** HTTP status and default English message for every API error code. */
const TABLE: Record<ErrorCode, [status: number, message: string]> = {
  VALIDATION_ERROR: [400, "Invalid request"],
  UNAUTHORIZED: [401, "Authentication required"],
  TOKEN_EXPIRED: [401, "Access token expired"],
  FORBIDDEN: [403, "You do not have permission to do that"],
  NOT_FOUND: [404, "Not found"],
  CONFLICT: [409, "The request conflicts with the current state"],
  RATE_LIMITED: [429, "Too many requests, please try again later"],
  PAYLOAD_TOO_LARGE: [413, "Request body too large"],
  SERVER_BUSY: [503, "The server is busy, please retry"],
  SERVICE_UNAVAILABLE: [503, "Service temporarily unavailable"],
  INTERNAL: [500, "Something went wrong on our side"],

  INVALID_CREDENTIALS: [401, "Invalid username or password"],
  ACCOUNT_DISABLED: [403, "This account has been deactivated"],
  USERNAME_TAKEN: [409, "Username already taken"],
  EMAIL_TAKEN: [409, "Email already in use"],
  PHONE_INVALID: [400, "Enter a valid mobile number"],
  REGISTRATION_CLOSED: [403, "Registration is closed"],
  REGISTRATION_CODE_INVALID: [403, "Invalid registration code"],
  CONSENT_REQUIRED: [400, "You must accept the privacy policy to register"],
  ADULT_CONFIRMATION_REQUIRED: [400, "You must confirm that you are 18 or older"],
  PASSWORD_TOO_SHORT: [400, "Password is too short"],
  PASSWORD_TOO_LONG: [400, "Password is too long"],
  PASSWORD_TOO_COMMON: [400, "That password is too easy to guess"],
  PASSWORD_SAME_AS_USERNAME: [400, "Password must not be the same as the username"],
  CURRENT_PASSWORD_INCORRECT: [400, "Current password is incorrect"],
  RESET_CODE_INVALID: [400, "Invalid or expired reset code"],
  PASSWORD_CHANGE_REQUIRED: [403, "You must change your password before continuing"],
  EMAIL_RESET_UNAVAILABLE: [503, "Password reset by email is not available. Ask your trainer to reset it."],

  NOT_ENROLLED: [403, "Enrol in this course first"],
  COURSE_NOT_AVAILABLE: [404, "This course is not available"],
  VIDEO_NOT_WATCHED: [409, "Spend a little more time on this lesson before marking it complete"],
  QUIZ_LOCKED: [403, "Complete all required lessons of this module before the quiz"],
  QUIZ_ATTEMPTS_EXCEEDED: [429, "Too many quiz attempts, try again later"],
  QUIZ_ANSWERS_INVALID: [400, "Answers do not match the quiz questions"],

  MEDIA_URL_NOT_ALLOWED: [400, "That media link is not from an allowed source"],
  MEDIA_TYPE_NOT_ALLOWED: [415, "That file type is not allowed"],
  MEDIA_TOO_LARGE: [413, "File is too large"],
  MEDIA_NOT_CONFIGURED: [503, "Media uploads are not configured on this server"],
  MEDIA_UPLOAD_NOT_FOUND: [404, "Uploaded file not found"],
  COURSE_HAS_RECORDS: [409, "This item has learner records and cannot be deleted. Archive it instead."],
  LAST_ADMIN: [409, "There must always be at least one active admin"],
  SELF_ACTION_FORBIDDEN: [403, "You cannot do that to your own account"],
  CONFIRMATION_MISMATCH: [400, "Confirmation text does not match"],
};

export interface AppErrorOptions {
  message?: string;
  details?: unknown;
  headers?: Record<string, string>;
  cause?: unknown;
}

/** An error that is safe to show to the client: it carries an HTTP status and a stable code. */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly headers?: Record<string, string>;

  constructor(code: ErrorCode, opts: AppErrorOptions = {}) {
    const [status, defaultMessage] = TABLE[code];
    super(opts.message ?? defaultMessage, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = opts.details;
    this.headers = opts.headers;
  }
}

/** `throw err("NOT_FOUND", { message: "Course not found" })` */
export function err(code: ErrorCode, opts?: AppErrorOptions): AppError {
  return new AppError(code, opts);
}

export function notFound(what: string): AppError {
  return new AppError("NOT_FOUND", { message: `${what} not found` });
}

export function rateLimited(retryAfterSeconds: number, message?: string): AppError {
  const secs = Math.max(1, Math.ceil(retryAfterSeconds));
  return new AppError("RATE_LIMITED", {
    message,
    details: { retryAfterSeconds: secs },
    headers: { "Retry-After": String(secs) },
  });
}

// ─── Normalising foreign errors ─────────────────────────────────────────────
interface PgLikeError {
  code?: string;
  constraint?: string;
  table?: string;
  detail?: string;
  message?: string;
}

/** Drizzle ≥ 0.44 wraps driver errors in DrizzleQueryError; the pg error is on `.cause`. */
function findPgError(error: unknown): PgLikeError | null {
  let cur: unknown = error;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const c = cur as PgLikeError & { cause?: unknown };
    if (typeof c.code === "string" && /^[0-9A-Z]{5}$/.test(c.code)) return c;
    cur = c.cause;
  }
  return null;
}

export function isPgUniqueViolation(error: unknown, constraintIncludes?: string): boolean {
  const pg = findPgError(error);
  if (!pg || pg.code !== "23505") return false;
  return constraintIncludes ? (pg.constraint ?? "").includes(constraintIncludes) : true;
}

/** Turns anything thrown inside a request into an AppError (unknown → INTERNAL). */
export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const e = error as {
    type?: string;
    status?: number;
    statusCode?: number;
    name?: string;
    code?: string;
    message?: string;
    issues?: { path: (string | number)[]; message: string }[];
  };

  if (e?.name === "ZodError" && Array.isArray(e.issues)) {
    return new AppError("VALIDATION_ERROR", { details: zodDetails(e.issues), cause: error });
  }

  // body-parser (express.json)
  if (e?.type === "entity.too.large") return new AppError("PAYLOAD_TOO_LARGE", { cause: error });
  if (e?.type === "entity.parse.failed" || e?.type === "encoding.unsupported" || e?.type === "charset.unsupported") {
    return new AppError("VALIDATION_ERROR", { message: "Request body is not valid JSON", cause: error });
  }

  // multer
  if (e?.name === "MulterError") {
    if (e.code === "LIMIT_FILE_SIZE") return new AppError("MEDIA_TOO_LARGE", { cause: error });
    return new AppError("VALIDATION_ERROR", { message: e.message, cause: error });
  }

  // PostgreSQL
  const pg = findPgError(error);
  if (pg) {
    switch (pg.code) {
      case "23505": {
        const c = pg.constraint ?? "";
        if (c.includes("username")) return new AppError("USERNAME_TAKEN", { cause: error });
        if (c.includes("email")) return new AppError("EMAIL_TAKEN", { cause: error });
        return new AppError("CONFLICT", { cause: error });
      }
      case "23503": // foreign_key_violation
        // "update or delete on table ..." = something still references the row being removed;
        // "insert or update on table ..." = the row points at a parent that does not exist.
        return /^update or delete/i.test(pg.message ?? "")
          ? new AppError("COURSE_HAS_RECORDS", { cause: error })
          : new AppError("VALIDATION_ERROR", { message: "Referenced item does not exist", cause: error });
      case "23514": // check_violation
      case "23502": // not_null_violation
      case "22001": // string_data_right_truncation
      case "22003": // numeric_value_out_of_range
        return new AppError("VALIDATION_ERROR", { cause: error });
      case "40001": // serialization_failure
      case "40P01": // deadlock_detected
      case "55P03": // lock_not_available
      case "57014": // query_canceled (statement_timeout)
        return new AppError("SERVER_BUSY", { headers: { "Retry-After": "2" }, cause: error });
      default:
        if (/^(08|53|57P)/.test(pg.code ?? "")) {
          return new AppError("SERVICE_UNAVAILABLE", { headers: { "Retry-After": "5" }, cause: error });
        }
    }
  }

  // node-postgres pool exhaustion / connection problems
  if (
    e?.message &&
    /timeout exceeded when trying to connect|Connection terminated|ECONNREFUSED|ECONNRESET|the database system is (starting up|shutting down)/i.test(e.message)
  ) {
    return new AppError("SERVICE_UNAVAILABLE", { headers: { "Retry-After": "5" }, cause: error });
  }

  return new AppError("INTERNAL", { cause: error });
}

export function zodDetails(issues: readonly { path: readonly PropertyKey[]; message: string }[]): { fields: Record<string, string[]> } {
  const fields: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.length ? issue.path.map(String).join(".") : "_";
    (fields[key] ??= []).push(issue.message);
  }
  return { fields };
}
