/** Staff tools for certificates: look one up by number, withdraw it, reinstate it. */
import { eq } from "drizzle-orm";
import { certificates, courses, users } from "@shared/schema";
import { db } from "../db";
import { notFound } from "../errors";
import { parseCertificateNumber } from "./certificate";

const columns = {
  id: certificates.id,
  certificateNumber: certificates.certificateNumber,
  earnedAt: certificates.earnedAt,
  revokedAt: certificates.revokedAt,
  revokedReason: certificates.revokedReason,
  userId: certificates.userId,
  username: users.username,
  holderName: certificates.issuedName,
  workerName: users.displayName,
  courseId: certificates.courseId,
  courseTitle: courses.title,
  issuedCourseTitle: certificates.issuedCourseTitle,
};

async function find(where: ReturnType<typeof eq>) {
  const [row] = await db
    .select(columns)
    .from(certificates)
    .innerJoin(users, eq(users.id, certificates.userId))
    .innerJoin(courses, eq(courses.id, certificates.courseId))
    .where(where)
    .limit(1);
  if (!row) throw notFound("Certificate");
  return {
    id: row.id,
    certificateNumber: row.certificateNumber,
    earnedAt: row.earnedAt,
    revoked: row.revokedAt !== null,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason,
    userId: row.userId,
    username: row.username,
    holderName: row.holderName ?? row.workerName,
    courseId: row.courseId,
    courseTitle: row.issuedCourseTitle ?? row.courseTitle,
  };
}

export async function lookupByNumber(raw: string) {
  const number = parseCertificateNumber(raw);
  if (!number) throw notFound("Certificate");
  return find(eq(certificates.certificateNumber, number));
}

export async function revokeCertificate(id: string, reason: string) {
  const [updated] = await db
    .update(certificates)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(eq(certificates.id, id))
    .returning({ id: certificates.id });
  if (!updated) throw notFound("Certificate");
  return find(eq(certificates.id, id));
}

export async function reinstateCertificate(id: string) {
  const [updated] = await db
    .update(certificates)
    .set({ revokedAt: null, revokedReason: null })
    .where(eq(certificates.id, id))
    .returning({ id: certificates.id });
  if (!updated) throw notFound("Certificate");
  return find(eq(certificates.id, id));
}
