/**
 * Learning progress rules. One module owns them so every endpoint agrees.
 *
 *  - Progress only moves forward: a lesson once completed stays completed
 *    (the old upsert overwrote `completed` with whatever the last request
 *    said, so saving a video position could un-complete a lesson).
 *  - Completion cannot be claimed instantly: the server accumulates the time
 *    actually spent on a lesson from the gaps between its own heartbeats and
 *    requires WATCH_THRESHOLD of the video's length (or a few seconds for
 *    text) before accepting `completed: true`. Time reported by the client is
 *    never trusted.
 *  - A module is complete when its required lessons are done and its quiz (if
 *    any) is passed; a course when all of its (non-empty) modules are. All of
 *    that is recomputed inside one transaction that locks the enrolment row,
 *    so concurrent requests cannot double-issue a certificate.
 */
import { and, eq, sql } from "drizzle-orm";
import {
  certificates,
  courseEnrollments,
  courses,
  lessonProgress,
  moduleProgress,
  users,
  type Role,
} from "@shared/schema";
import { db, type DbOrTx, type Tx } from "../db";
import { err, notFound } from "../errors";
import { getCourseAccess, getLessonContext, type Lesson } from "./access";
import { generateCertificateNumber } from "./certificate";

/** Share of a video's length that must have elapsed before it can be marked complete. */
export const WATCH_THRESHOLD = 0.7;
/** Minimum time on any lesson (text/image/unknown-length video). */
export const MIN_DWELL_SECONDS = 5;
/** Heartbeats further apart than this are treated as a pause, not as time spent. */
export const MAX_HEARTBEAT_GAP_SECONDS = 30;

/**
 * How much time the server must have measured before a lesson can be completed: the watch share of a video's
 * length (never less than the minimum dwell), the minimum dwell for everything else. A clip no longer than the
 * minimum dwell cannot be "watched for 5 seconds" in one viewing, so it asks for its own share instead of a
 * time the learner could only reach by replaying it.
 */
export function requiredWatchSeconds(lesson: Pick<Lesson, "contentType" | "videoDurationSeconds">): number {
  const duration = lesson.contentType === "video" ? lesson.videoDurationSeconds : null;
  if (duration && duration > 0) {
    if (duration <= MIN_DWELL_SECONDS) return Math.max(1, Math.floor(duration * WATCH_THRESHOLD));
    return Math.max(MIN_DWELL_SECONDS, Math.ceil(duration * WATCH_THRESHOLD));
  }
  return MIN_DWELL_SECONDS;
}

// ─── Module state ────────────────────────────────────────────────────────────
export interface ModuleState {
  moduleId: string;
  totalLessons: number;
  requiredLessons: number;
  requiredDone: number;
  allDone: number;
  hasQuiz: boolean;
  quizPassed: boolean;
  completedAt: Date | null;
}

async function loadModuleStates(dbc: DbOrTx, userId: string, filter: ReturnType<typeof sql>): Promise<ModuleState[]> {
  const result = await dbc.execute(sql`
    SELECT m.id AS "moduleId",
           COUNT(l.id)::int AS "totalLessons",
           (COUNT(l.id) FILTER (WHERE l.is_required))::int AS "requiredLessons",
           (COUNT(lp.id) FILTER (WHERE lp.completed AND l.is_required))::int AS "requiredDone",
           (COUNT(lp.id) FILTER (WHERE lp.completed))::int AS "allDone",
           EXISTS (SELECT 1 FROM quizzes q WHERE q.module_id = m.id) AS "hasQuiz",
           COALESCE(mp.quiz_passed, false) AS "quizPassed",
           mp.completed_at AS "completedAt"
    FROM modules m
    LEFT JOIN lessons l ON l.module_id = m.id
    LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ${userId}
    LEFT JOIN module_progress mp ON mp.module_id = m.id AND mp.user_id = ${userId}
    WHERE ${filter}
    GROUP BY m.id, m.sort_order, m.created_at, mp.quiz_passed, mp.completed_at
    ORDER BY m.sort_order, m.created_at
  `);
  return result.rows as unknown as ModuleState[];
}

export const getCourseModuleStates = (dbc: DbOrTx, userId: string, courseId: string) =>
  loadModuleStates(dbc, userId, sql`m.course_id = ${courseId}`);

export async function getModuleState(dbc: DbOrTx, userId: string, moduleId: string): Promise<ModuleState | null> {
  const rows = await loadModuleStates(dbc, userId, sql`m.id = ${moduleId}`);
  return rows[0] ?? null;
}

export function evaluateModule(s: ModuleState) {
  // A module whose lessons are all optional is done when all of them are.
  const needed = s.requiredLessons > 0 ? s.requiredLessons : s.totalLessons;
  const done = s.requiredLessons > 0 ? s.requiredDone : s.allDone;
  const lessonsDone = done >= needed;
  /** Empty modules (no lessons, no quiz) carry no learning content and do not count towards the course. */
  const counted = s.totalLessons > 0 || s.hasQuiz;
  const satisfied = counted && lessonsDone && (!s.hasQuiz || s.quizPassed);
  return { counted, lessonsDone, satisfied };
}

// ─── Course completion + certificate ─────────────────────────────────────────
export type CertificateRow = typeof certificates.$inferSelect;

/** What the app is told about a certificate that was just earned (client/src/types/api.ts: CertificateIssued). Never the raw row. */
export interface IssuedCertificate {
  id: string;
  certificateNumber: string;
  courseId: string;
  earnedAt: Date;
}

export function toIssuedCertificate(row: CertificateRow | null | undefined): IssuedCertificate | null {
  return row ? { id: row.id, certificateNumber: row.certificateNumber, courseId: row.courseId, earnedAt: row.earnedAt } : null;
}

export interface CourseProgressResult {
  percent: number;
  completed: boolean;
  /** Set only when this call issued the certificate. */
  newCertificate: CertificateRow | null;
}

async function ensureCertificate(tx: Tx, userId: string, courseId: string): Promise<{ row: CertificateRow; created: boolean }> {
  const find = async () => {
    const [row] = await tx
      .select()
      .from(certificates)
      .where(and(eq(certificates.userId, userId), eq(certificates.courseId, courseId)))
      .limit(1);
    return row;
  };
  const existing = await find();
  if (existing) return { row: existing, created: false };

  const [[user], [course]] = await Promise.all([
    tx.select({ name: users.displayName }).from(users).where(eq(users.id, userId)).limit(1),
    tx.select({ title: courses.title }).from(courses).where(eq(courses.id, courseId)).limit(1),
  ]);

  for (let attempt = 0; attempt < 5; attempt++) {
    const [row] = await tx
      .insert(certificates)
      .values({
        userId,
        courseId,
        certificateNumber: generateCertificateNumber(),
        issuedName: user?.name ?? null,
        issuedCourseTitle: course?.title ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (row) return { row, created: true };
    const raced = await find(); // someone else issued it, or the number collided (then we retry)
    if (raced) return { row: raced, created: false };
  }
  throw err("INTERNAL", { message: "Could not allocate a certificate number" });
}

/**
 * Recomputes module completion, the enrolment percentage and (once) the
 * certificate for one learner and course. Always run inside a transaction.
 */
export async function recomputeCourseProgress(tx: Tx, userId: string, courseId: string): Promise<CourseProgressResult | null> {
  const [enrollment] = await tx
    .select()
    .from(courseEnrollments)
    .where(and(eq(courseEnrollments.userId, userId), eq(courseEnrollments.courseId, courseId)))
    .for("update")
    .limit(1);
  if (!enrollment) return null;

  const states = await getCourseModuleStates(tx, userId, courseId);
  let counted = 0;
  let complete = 0;
  const newlyComplete: string[] = [];
  for (const state of states) {
    const e = evaluateModule(state);
    if (!e.counted) continue;
    counted++;
    // "Monotonic": a module that was completed once stays completed even if the admin later adds lessons to it.
    if (state.completedAt || e.satisfied) {
      complete++;
      if (!state.completedAt) newlyComplete.push(state.moduleId);
    }
  }

  for (const moduleId of newlyComplete) {
    await tx
      .insert(moduleProgress)
      .values({ userId, moduleId, completedAt: new Date() })
      .onConflictDoUpdate({
        target: [moduleProgress.userId, moduleProgress.moduleId],
        set: { completedAt: sql`COALESCE(${moduleProgress.completedAt}, now())` },
      });
  }

  const percent = counted === 0 ? 0 : Math.round((complete / counted) * 100);
  const completedAt = percent === 100 ? (enrollment.completedAt ?? new Date()) : enrollment.completedAt;
  await tx
    .update(courseEnrollments)
    .set({ completionPercent: percent, completedAt })
    .where(eq(courseEnrollments.id, enrollment.id));

  let newCertificate: CertificateRow | null = null;
  if (percent === 100) {
    const { row, created } = await ensureCertificate(tx, userId, courseId);
    if (created) newCertificate = row;
  }
  return { percent, completed: percent === 100, newCertificate };
}

// ─── Lesson progress ─────────────────────────────────────────────────────────
export interface LessonProgressView {
  lessonId: string;
  completed: boolean;
  videoProgressSeconds: number;
  watchedSeconds: number;
  requiredSeconds: number;
  canComplete: boolean;
  completedAt: Date | null;
}

export interface RecordResult {
  progress: LessonProgressView;
  course: { percent: number; completed: boolean } | null;
  newCertificate: IssuedCertificate | null;
}

export function toLessonProgressView(
  lesson: Pick<Lesson, "id" | "contentType" | "videoDurationSeconds">,
  row: Pick<typeof lessonProgress.$inferSelect, "completed" | "videoProgressSeconds" | "watchedSeconds" | "completedAt"> | null
): LessonProgressView {
  const requiredSeconds = requiredWatchSeconds(lesson);
  const watched = row?.watchedSeconds ?? 0;
  return {
    lessonId: lesson.id,
    completed: row?.completed ?? false,
    videoProgressSeconds: row?.videoProgressSeconds ?? 0,
    watchedSeconds: watched,
    requiredSeconds,
    canComplete: (row?.completed ?? false) || watched >= requiredSeconds,
    completedAt: row?.completedAt ?? null,
  };
}

export async function recordLessonProgress(
  user: { id: string; role: Role },
  input: { lessonId: string; positionSeconds?: number; completed?: boolean }
): Promise<RecordResult> {
  const ctx = await getLessonContext(input.lessonId);
  if (!ctx) throw notFound("Lesson");
  await getCourseAccess(user, ctx.courseId, "learn");
  const { lesson } = ctx;
  const required = requiredWatchSeconds(lesson);

  const outcome = await db.transaction(async (tx) => {
    await tx.insert(lessonProgress).values({ userId: user.id, lessonId: lesson.id }).onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(lessonProgress)
      .where(and(eq(lessonProgress.userId, user.id), eq(lessonProgress.lessonId, lesson.id)))
      .for("update")
      .limit(1);
    // Touching a lesson "starts" its module.
    await tx.insert(moduleProgress).values({ userId: user.id, moduleId: ctx.moduleId }).onConflictDoNothing();

    const now = new Date();
    let delta = 0;
    if (row.lastHeartbeatAt && !row.completed) {
      const gap = (now.getTime() - row.lastHeartbeatAt.getTime()) / 1000;
      if (gap >= 1 && gap <= MAX_HEARTBEAT_GAP_SECONDS) delta = Math.floor(gap);
    }
    const watched = row.watchedSeconds + delta;

    let position = input.positionSeconds ?? row.videoProgressSeconds;
    if (lesson.videoDurationSeconds) position = Math.min(position, lesson.videoDurationSeconds);

    let completed = row.completed;
    let rejected = false;
    if (input.completed && !row.completed) {
      if (watched >= required) completed = true;
      else rejected = true;
    }

    const [saved] = await tx
      .update(lessonProgress)
      .set({
        watchedSeconds: watched,
        videoProgressSeconds: position,
        lastHeartbeatAt: now,
        completed,
        completedAt: completed ? (row.completedAt ?? now) : row.completedAt,
        updatedAt: now,
      })
      .where(eq(lessonProgress.id, row.id))
      .returning();

    let course: CourseProgressResult | null = null;
    if (completed && !row.completed) course = await recomputeCourseProgress(tx, user.id, ctx.courseId);

    return { saved, rejected, course };
  });

  const progress = toLessonProgressView(lesson, outcome.saved);
  if (outcome.rejected) {
    // Thrown after commit so the time we did measure is kept.
    throw err("VIDEO_NOT_WATCHED", {
      details: {
        watchedSeconds: progress.watchedSeconds,
        requiredSeconds: progress.requiredSeconds,
        remainingSeconds: Math.max(0, progress.requiredSeconds - progress.watchedSeconds),
      },
    });
  }
  return {
    progress,
    course: outcome.course ? { percent: outcome.course.percent, completed: outcome.course.completed } : null,
    newCertificate: toIssuedCertificate(outcome.course?.newCertificate),
  };
}

// ─── Enrolment ───────────────────────────────────────────────────────────────
/**
 * Idempotent: enrolling twice (a double tap, or a retry after a lost response) returns the
 * existing enrolment instead of an error. `created` tells the route which status to send.
 */
export async function enrollInCourse(user: { id: string; role: Role }, courseId: string) {
  const access = await getCourseAccess(user, courseId, "outline");
  if (access.preview) throw err("COURSE_NOT_AVAILABLE");
  if (access.enrollment) return { enrollment: access.enrollment, created: false };

  const [inserted] = await db
    .insert(courseEnrollments)
    .values({ userId: user.id, courseId })
    .onConflictDoNothing()
    .returning();
  if (inserted) return { enrollment: inserted, created: true };

  // A parallel request enrolled this learner between our check and the insert.
  const [existing] = await db
    .select()
    .from(courseEnrollments)
    .where(and(eq(courseEnrollments.userId, user.id), eq(courseEnrollments.courseId, courseId)))
    .limit(1);
  return { enrollment: existing, created: false };
}
