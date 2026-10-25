/**
 * One place for "something unexpected happened". By default it only prints in development; to ship
 * crash reports, call `setErrorReporter` once at start-up with Sentry's (or any other) `captureException`.
 * Expected trouble (no signal, a wrong password, a full quiz allowance) is never reported: that is
 * the app working, not failing.
 */
import { ApiError } from "./apiClient";

type Reporter = (error: unknown, context?: Record<string, unknown>) => void;

let reporter: Reporter = (error, context) => {
  if (typeof __DEV__ !== "undefined" && __DEV__) console.error("[app]", error, context ?? "");
};

export function setErrorReporter(next: Reporter): void {
  reporter = next;
}

export function reportError(error: unknown, context?: Record<string, unknown>): void {
  try {
    reporter(error, context);
  } catch {
    /* reporting must never break the app */
  }
}

/** For failed requests: only what we did not expect (a crash on the server, an unreadable answer, a bug on our side). */
export function reportUnexpected(error: unknown): void {
  if (error instanceof ApiError) {
    if (error.isConnectionProblem) return;
    if (error.status < 500 && error.code !== "BAD_RESPONSE") return;
  }
  reportError(error);
}
