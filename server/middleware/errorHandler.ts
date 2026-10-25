import type { ErrorRequestHandler, RequestHandler } from "express";
import { logger } from "../logger";
import { normalizeError } from "../errors";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: "Route not found", code: "NOT_FOUND", requestId: req.id });
};

/**
 * Final error handler. Every failure leaves the API in one shape:
 *   { error: "<english sentence>", code: "<STABLE_CODE>", details?: …, requestId }
 * Unexpected errors are logged with their stack but only ever described to
 * the client as INTERNAL — no stack traces, SQL or file paths leak out.
 */
 
export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    // Too late to send JSON; let Express close the connection.
    next(error);
    return;
  }
  const e = normalizeError(error);
  const log = req.log ?? logger;
  if (e.status >= 500) log.error({ err: e.cause ?? error, code: e.code }, "request failed");
  else if (e.status === 429) log.warn({ code: e.code }, "rate limited");

  if (e.headers) res.set(e.headers);
  res.status(e.status).json({
    error: e.message,
    code: e.code,
    ...(e.details !== undefined ? { details: e.details } : {}),
    requestId: req.id,
  });
};
