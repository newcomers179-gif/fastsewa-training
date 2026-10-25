import type { Logger } from "pino";
import type { Role } from "@shared/schema";

declare global {
   
  namespace Express {
    interface Request {
      /** Correlation id, echoed in the X-Request-Id response header and in every log line of the request. */
      id: string;
      log: Logger;
      user?: { id: string; username: string; displayName: string; role: Role };
    }
  }
}

export {};
