import type { Request } from "express";
import { z } from "zod";
import { AppError } from "../errors";

/** Row ids are uuids (varchar(36)); anything else cannot exist, so answer 404 without touching the database. */
const ID_RE = /^[0-9a-fA-F-]{36}$/;

/**
 * Express 5 types a route parameter as `string | string[]`; at runtime it is a
 * single string for the `/:id` shapes used here. This narrows it honestly.
 */
export function paramStr(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/** Returns the route parameter if it looks like an id, otherwise throws NOT_FOUND. */
export function idParam(req: Request, name: string, what = "Resource"): string {
  const value = paramStr(req.params[name]);
  if (!ID_RE.test(value)) throw new AppError("NOT_FOUND", { message: `${what} not found` });
  return value;
}

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export function offsetOf(p: { page: number; pageSize: number }): number {
  return (p.page - 1) * p.pageSize;
}

/** Escapes `%`, `_` and `\` so user text is matched literally inside an ILIKE pattern. */
export const escapeLike = (text: string): string => text.replace(/[\\%_]/g, "\\$&");
