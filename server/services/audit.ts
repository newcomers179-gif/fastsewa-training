import type { Request } from "express";
import { auditLogs } from "@shared/schema";
import { db, type DbOrTx } from "../db";
import { logger } from "../logger";

export interface AuditTarget {
  type: string;
  id?: string | null;
}

/**
 * Records who did what (admin/trainer actions, account erasure, password
 * resets...). Pass `tx` to make the entry part of the same transaction as the
 * change it describes. Outside a transaction a failed audit write is logged
 * but never fails the user's request.
 */
export async function audit(
  req: Request | null,
  action: string,
  target?: AuditTarget,
  metadata?: Record<string, unknown>,
  dbc: DbOrTx = db
): Promise<void> {
  const write = () =>
    dbc.insert(auditLogs).values({
      actorId: req?.user?.id ?? null,
      actorUsername: req?.user?.username ?? null,
      action,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      metadata: metadata ?? null,
      ip: req?.ip ?? null,
      requestId: req?.id ?? null,
    });

  if (dbc !== db) {
    await write(); // inside a transaction: let a failure roll the change back
    return;
  }
  try {
    await write();
  } catch (error) {
    logger.error({ err: error, action }, "failed to write audit log");
  }
}
