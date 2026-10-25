import type { z } from "zod";
import { AppError, zodDetails } from "../errors";

/** Parses `data` with `schema`; invalid input becomes a 400 VALIDATION_ERROR with per-field messages. */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError("VALIDATION_ERROR", { details: zodDetails(result.error.issues) });
  }
  return result.data;
}
