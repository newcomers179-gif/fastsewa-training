import type { Request } from "express";
import { config } from "../config";

/** The public origin of this API: the configured PUBLIC_BASE_URL, else what the request itself says (development). */
export const originOf = (req: Request): string => config.publicBaseUrl ?? `${req.protocol}://${req.get("host")}`;
