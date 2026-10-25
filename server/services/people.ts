/**
 * People management for the admin console: learners ("workers") and staff
 * (admins and trainers).
 */
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { certificates, courseEnrollments, courses, moduleProgress, modules, users } from "@shared/schema";
import { db } from "../db";
import { err, notFound } from "../errors";
import { hashPassword } from "../auth/password";
import { bumpTokenVersion, revokeAllSessions } from "../auth/sessions";
import { invalidateAuthUser } from "../auth/userCache";
import { escapeLike } from "../utils/params";
import { cleanEmail, cleanPhone, cleanUsername, generateTemporaryPassword, lockAdmins, publicUser, setTemporaryPassword, STAFF_TEMP_PASSWORD_LENGTH } from "./accounts";
import type { staffCreateBody, staffUpdateBody, workerListQuery, workerUpdateBody } from "../validators";

type WorkerQuery = z.infer<typeof workerListQuery>;
type WorkerPatch = z.infer<typeof workerUpdateBody>;
type StaffCreate = z.infer<typeof staffCreateBody>;
type StaffPatch = z.infer<typeof staffUpdateBody>;

// ─── Workers ─────────────────────────────────────────────────────────────────
function workerFilter(q: { q?: string; status: "all" | "active" | "inactive" }): SQL {
  const conditions: SQL[] = [eq(users.role, "worker"), isNull(users.deletedAt)];
  if (q.status === "active") conditions.push(eq(users.isActive, true));
  if (q.status === "inactive") conditions.push(eq(users.isActive, false));
  if (q.q) {
    const pattern = `%${escapeLike(q.q)}%`;
    conditions.push(
      or(ilike(users.username, pattern), ilike(users.displayName, pattern), ilike(users.phoneNumber, pattern), ilike(users.email, pattern))!
    );
  }
  return and(...conditions)!;
}

const workerColumns = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  phoneNumber: users.phoneNumber,
  email: users.email,
  preferredLang: users.preferredLang,
  isActive: users.isActive,
  mustChangePassword: users.mustChangePassword,
  createdAt: users.createdAt,
  lastLoginAt: users.lastLoginAt,
  // `"users"."id"` is written out on purpose: drizzle prints a bare "id" for a column used inside
  // a single-table select, which a correlated subquery would resolve to its OWN id column
  // (every count would silently be 0).
  coursesEnrolled: sql<number>`(SELECT count(*)::int FROM course_enrollments e WHERE e.user_id = "users"."id")`,
  coursesCompleted: sql<number>`(SELECT count(*)::int FROM course_enrollments e WHERE e.user_id = "users"."id" AND e.completed_at IS NOT NULL)`,
  certificates: sql<number>`(SELECT count(*)::int FROM certificates c WHERE c.user_id = "users"."id" AND c.revoked_at IS NULL)`,
};

export async function listWorkers(q: WorkerQuery) {
  const where = workerFilter(q);
  const order =
    q.sort === "name"
      ? [asc(sql`lower(${users.displayName})`), asc(users.id)]
      : q.sort === "lastLogin"
        ? [sql`${users.lastLoginAt} DESC NULLS LAST`, asc(users.id)]
        : [desc(users.createdAt), asc(users.id)];

  const [items, [total]] = await Promise.all([
    db
      .select(workerColumns)
      .from(users)
      .where(where)
      .orderBy(...order)
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: count() }).from(users).where(where),
  ]);
  return { items, total: total.n, page: q.page, pageSize: q.pageSize };
}

/**
 * Streams every matching worker in stable pages, so exporting 50 000 people never holds them all
 * in memory. The cursor keeps the timestamp as Postgres prints it (microseconds): a JS Date only
 * has milliseconds, so round-tripping through one would select the last row of every page again.
 */
export async function* iterateWorkers(q: { q?: string; status: "all" | "active" | "inactive" }, pageSize = 1000) {
  const base = workerFilter(q);
  let cursor: { ts: string; id: string } | null = null;
  for (;;) {
    const where: SQL = cursor ? and(base, sql`(${users.createdAt}, ${users.id}) > (${cursor.ts}::timestamptz, ${cursor.id})`)! : base;
    const rows = await db
      .select({ ...workerColumns, cursorTs: sql<string>`"users"."created_at"::text` })
      .from(users)
      .where(where)
      .orderBy(asc(users.createdAt), asc(users.id))
      .limit(pageSize);
    if (rows.length === 0) return;
    yield rows;
    const last = rows[rows.length - 1];
    cursor = { ts: last.cursorTs, id: last.id };
    if (rows.length < pageSize) return;
  }
}

async function findWorker(id: string) {
  const [worker] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.role, "worker"), isNull(users.deletedAt)))
    .limit(1);
  if (!worker) throw notFound("Worker");
  return worker;
}

export async function getWorkerDetail(id: string) {
  const worker = await findWorker(id);
  const [enrollments, moduleRows, certs] = await Promise.all([
    db
      .select({
        courseId: courseEnrollments.courseId,
        courseTitle: courses.title,
        enrolledAt: courseEnrollments.enrolledAt,
        completedAt: courseEnrollments.completedAt,
        completionPercent: courseEnrollments.completionPercent,
      })
      .from(courseEnrollments)
      .innerJoin(courses, eq(courses.id, courseEnrollments.courseId))
      .where(eq(courseEnrollments.userId, id))
      .orderBy(desc(courseEnrollments.enrolledAt)),
    db
      .select({
        moduleId: moduleProgress.moduleId,
        moduleTitle: modules.title,
        courseId: modules.courseId,
        startedAt: moduleProgress.startedAt,
        completedAt: moduleProgress.completedAt,
        quizScore: moduleProgress.quizScore,
        quizPassed: moduleProgress.quizPassed,
      })
      .from(moduleProgress)
      .innerJoin(modules, eq(modules.id, moduleProgress.moduleId))
      .where(eq(moduleProgress.userId, id))
      .orderBy(desc(moduleProgress.startedAt)),
    db
      .select({
        id: certificates.id,
        certificateNumber: certificates.certificateNumber,
        earnedAt: certificates.earnedAt,
        revokedAt: certificates.revokedAt,
        revokedReason: certificates.revokedReason,
        courseId: certificates.courseId,
        courseTitle: courses.title,
      })
      .from(certificates)
      .innerJoin(courses, eq(courses.id, certificates.courseId))
      .where(eq(certificates.userId, id))
      .orderBy(desc(certificates.earnedAt)),
  ]);

  return {
    user: {
      id: worker.id,
      username: worker.username,
      displayName: worker.displayName,
      phoneNumber: worker.phoneNumber,
      email: worker.email,
      preferredLang: worker.preferredLang,
      isActive: worker.isActive,
      mustChangePassword: worker.mustChangePassword,
      createdAt: worker.createdAt,
      lastLoginAt: worker.lastLoginAt,
      consentVersion: worker.consentVersion,
      consentAcceptedAt: worker.consentAcceptedAt,
    },
    enrollments,
    modules: moduleRows,
    certificates: certs,
  };
}

export async function updateWorker(id: string, patch: WorkerPatch) {
  const existing = await findWorker(id);

  const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (patch.displayName !== undefined) set.displayName = patch.displayName;
  if (patch.preferredLang !== undefined) set.preferredLang = patch.preferredLang;
  if (patch.phoneNumber !== undefined) set.phoneNumber = cleanPhone(patch.phoneNumber);
  if (patch.email !== undefined) set.email = cleanEmail(patch.email);
  if (patch.isActive !== undefined) set.isActive = patch.isActive;

  const [updated] = await db.update(users).set(set).where(eq(users.id, id)).returning();
  if (patch.isActive === false && existing.isActive) await revokeAllSessions(id); // also kills access tokens
  else invalidateAuthUser(id);
  return publicUser(updated);
}

export async function resetWorkerPassword(id: string): Promise<{ username: string; temporaryPassword: string }> {
  const worker = await findWorker(id);
  const temporaryPassword = await setTemporaryPassword(id);
  return { username: worker.username, temporaryPassword };
}

export async function findWorkerForErasure(id: string) {
  return findWorker(id);
}

// ─── Staff (admins and trainers) ─────────────────────────────────────────────
const staffColumns = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  email: users.email,
  role: users.role,
  isActive: users.isActive,
  mustChangePassword: users.mustChangePassword,
  createdAt: users.createdAt,
  lastLoginAt: users.lastLoginAt,
};

export async function listStaff() {
  return db
    .select(staffColumns)
    .from(users)
    .where(and(inArray(users.role, ["admin", "trainer"]), isNull(users.deletedAt)))
    .orderBy(asc(users.role), asc(sql`lower(${users.displayName})`));
}

async function findStaff(id: string, dbc: Pick<typeof db, "select"> = db) {
  const [row] = await dbc
    .select()
    .from(users)
    .where(and(eq(users.id, id), inArray(users.role, ["admin", "trainer"]), isNull(users.deletedAt)))
    .limit(1);
  if (!row) throw notFound("Staff member");
  return row;
}

export type StaffRow = Awaited<ReturnType<typeof listStaff>>[number];

export async function createStaff(input: StaffCreate): Promise<{ user: StaffRow; temporaryPassword: string }> {
  const username = cleanUsername(input.username);
  const email = cleanEmail(input.email);
  const temporaryPassword = generateTemporaryPassword(STAFF_TEMP_PASSWORD_LENGTH);
  const passwordHash = await hashPassword(temporaryPassword);

  const [created] = await db
    .insert(users)
    .values({
      username,
      email,
      passwordHash,
      displayName: input.displayName.trim(),
      role: input.role,
      mustChangePassword: true,
    })
    .returning(staffColumns);
  return { user: created, temporaryPassword };
}

export async function updateStaff(actorId: string, id: string, patch: StaffPatch) {
  const roleChange = patch.role !== undefined;
  const deactivation = patch.isActive === false;

  return db.transaction(async (tx) => {
    await lockAdmins(tx); // two admins demoting each other at the same moment must not leave the system with none
    const existing = await findStaff(id, tx);

    const demoting = roleChange && patch.role !== existing.role && existing.role === "admin";
    const disabling = deactivation && existing.isActive;
    if (id === actorId && ((roleChange && patch.role !== existing.role) || deactivation)) throw err("SELF_ACTION_FORBIDDEN");

    if (existing.role === "admin" && existing.isActive && (demoting || disabling)) {
      const [others] = await tx
        .select({ n: count() })
        .from(users)
        .where(and(eq(users.role, "admin"), eq(users.isActive, true), isNull(users.deletedAt), sql`${users.id} <> ${id}`));
      if (others.n === 0) throw err("LAST_ADMIN");
    }

    const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (patch.displayName !== undefined) set.displayName = patch.displayName;
    if (patch.role !== undefined) set.role = patch.role;
    if (patch.isActive !== undefined) set.isActive = patch.isActive;
    const [updated] = await tx.update(users).set(set).where(eq(users.id, id)).returning(staffColumns);

    if (disabling) await revokeAllSessions(id, tx);
    else if (roleChange && patch.role !== existing.role) await bumpTokenVersion(id, tx);
    else invalidateAuthUser(id);
    return updated;
  });
}

export async function resetStaffPassword(actorId: string, id: string): Promise<{ username: string; temporaryPassword: string }> {
  if (id === actorId) throw err("SELF_ACTION_FORBIDDEN", { message: "Use “Change password” for your own account" });
  const staff = await findStaff(id);
  const temporaryPassword = await setTemporaryPassword(id, db, STAFF_TEMP_PASSWORD_LENGTH);
  return { username: staff.username, temporaryPassword };
}
