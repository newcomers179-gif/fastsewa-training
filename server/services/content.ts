/**
 * Course catalogue management (admin): courses, modules, lessons.
 *
 * Rules that the old API left to the admin console (or to nobody):
 *  - every lesson is validated for its type: a video needs an allowed link and
 *    a length (the anti-skip rule depends on it), a text lesson needs text, an
 *    image lesson an image; the provider is derived from the URL, never typed;
 *  - media links must come from the allow-list in services/media.ts;
 *  - a course cannot be published empty;
 *  - items that learners already have records on cannot be deleted (the old
 *    API cascade-deleted their progress and certificates); courses can be
 *    archived instead;
 *  - after the structure changes, the stored completion percentage of every
 *    enrolled learner is recomputed so nobody keeps a stale "100%".
 */
import { and, asc, count, countDistinct, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  certificates,
  courseEnrollments,
  courses,
  lessonProgress,
  lessons,
  moduleProgress,
  modules,
  quizAttempts,
  quizQuestions,
  quizzes,
} from "@shared/schema";
import { db } from "../db";
import { AppError, err, isPgUniqueViolation, notFound } from "../errors";
import { logger } from "../logger";
import { validateMediaUrl, videoProviderOf } from "./media";
import { recomputeCourseProgress } from "./progress";
import type {
  courseCreateBody,
  courseUpdateBody,
  lessonCreateBody,
  lessonUpdateBody,
  moduleCreateBody,
  moduleUpdateBody,
} from "../validators";

type CourseCreate = z.infer<typeof courseCreateBody>;
type CourseUpdate = z.infer<typeof courseUpdateBody>;
type ModuleCreate = z.infer<typeof moduleCreateBody>;
type ModuleUpdate = z.infer<typeof moduleUpdateBody>;
type LessonCreate = z.infer<typeof lessonCreateBody>;
type LessonUpdate = z.infer<typeof lessonUpdateBody>;
type LessonRow = typeof lessons.$inferSelect;

const blankToNull = (v: string | null | undefined): string | null => {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
};

function fieldError(fields: Record<string, string[]>, message?: string): AppError {
  return new AppError("VALIDATION_ERROR", { message, details: { fields } });
}

// ─── Background recompute ────────────────────────────────────────────────────
/** Recomputes stored completion (and issues certificates that are now due) for everyone enrolled in a course. */
export async function recomputeAllEnrollments(courseId: string): Promise<number> {
  const rows = await db.select({ userId: courseEnrollments.userId }).from(courseEnrollments).where(eq(courseEnrollments.courseId, courseId));
  for (const { userId } of rows) {
    await db.transaction((tx) => recomputeCourseProgress(tx, userId, courseId));
  }
  return rows.length;
}

const recomputeState = new Map<string, "running" | "dirty">();

/** Fire-and-forget; coalesces bursts of edits (a change made while a run is in progress triggers one more run). */
export function scheduleCourseRecompute(courseId: string): void {
  if (recomputeState.has(courseId)) {
    recomputeState.set(courseId, "dirty");
    return;
  }
  recomputeState.set(courseId, "running");
  void (async () => {
    try {
      do {
        recomputeState.set(courseId, "running");
        await recomputeAllEnrollments(courseId);
      } while (recomputeState.get(courseId) === "dirty");
    } catch (error) {
      logger.error({ err: error, courseId }, "could not recompute learner progress after a content change");
    } finally {
      recomputeState.delete(courseId);
    }
  })();
}

// ─── Courses ─────────────────────────────────────────────────────────────────
export type CourseStatus = "draft" | "published" | "archived";
export const courseStatus = (c: { isPublished: boolean; archivedAt: Date | null }): CourseStatus =>
  c.archivedAt ? "archived" : c.isPublished ? "published" : "draft";

export async function listCoursesAdmin() {
  const rows = await db.select().from(courses).orderBy(asc(courses.sortOrder), desc(courses.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((c) => c.id);

  const [sizes, enrollments] = await Promise.all([
    db
      .select({ courseId: modules.courseId, moduleCount: countDistinct(modules.id), lessonCount: count(lessons.id) })
      .from(modules)
      .leftJoin(lessons, eq(lessons.moduleId, modules.id))
      .where(inArray(modules.courseId, ids))
      .groupBy(modules.courseId),
    db
      .select({
        courseId: courseEnrollments.courseId,
        enrolled: count(),
        completed: sql<number>`count(${courseEnrollments.completedAt})::int`,
      })
      .from(courseEnrollments)
      .where(inArray(courseEnrollments.courseId, ids))
      .groupBy(courseEnrollments.courseId),
  ]);
  const size = new Map(sizes.map((s) => [s.courseId, s]));
  const enr = new Map(enrollments.map((e) => [e.courseId, e]));

  return rows.map((c) => ({
    ...c,
    status: courseStatus(c),
    moduleCount: size.get(c.id)?.moduleCount ?? 0,
    lessonCount: size.get(c.id)?.lessonCount ?? 0,
    enrolled: enr.get(c.id)?.enrolled ?? 0,
    completed: enr.get(c.id)?.completed ?? 0,
  }));
}

/** The whole tree for the editor: modules, lessons (without the long text, fetched on demand) and quiz summaries. */
export async function getCourseTreeAdmin(courseId: string) {
  const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  if (!course) throw notFound("Course");

  const [moduleRows, lessonRows, quizRows] = await Promise.all([
    db.select().from(modules).where(eq(modules.courseId, courseId)).orderBy(asc(modules.sortOrder), asc(modules.createdAt)),
    db
      .select({
        id: lessons.id,
        moduleId: lessons.moduleId,
        title: lessons.title,
        titleHi: lessons.titleHi,
        contentType: lessons.contentType,
        videoUrl: lessons.videoUrl,
        videoProvider: lessons.videoProvider,
        videoDurationSeconds: lessons.videoDurationSeconds,
        imageUrl: lessons.imageUrl,
        sortOrder: lessons.sortOrder,
        isRequired: lessons.isRequired,
        hasText: sql<boolean>`(coalesce(length(${lessons.content}), 0) + coalesce(length(${lessons.contentHi}), 0)) > 0`,
      })
      .from(lessons)
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .where(eq(modules.courseId, courseId))
      .orderBy(asc(lessons.sortOrder), asc(lessons.createdAt)),
    db
      .select({
        id: quizzes.id,
        moduleId: quizzes.moduleId,
        title: quizzes.title,
        passingScore: quizzes.passingScore,
        questionCount: count(quizQuestions.id),
      })
      .from(quizzes)
      .innerJoin(modules, eq(modules.id, quizzes.moduleId))
      .leftJoin(quizQuestions, eq(quizQuestions.quizId, quizzes.id))
      .where(eq(modules.courseId, courseId))
      .groupBy(quizzes.id),
  ]);

  return {
    ...course,
    status: courseStatus(course),
    modules: moduleRows.map((m) => ({
      ...m,
      lessons: lessonRows.filter((x) => x.moduleId === m.id),
      quiz: quizRows.find((q) => q.moduleId === m.id) ?? null,
    })),
  };
}

function thumbnail(raw: string | null | undefined, existing?: string | null): string | null {
  const value = blankToNull(raw);
  if (!value) return null;
  if (existing && value === existing) return existing; // unchanged: do not re-judge historic data
  return validateMediaUrl(value, "image");
}

function slugConflict(error: unknown): never {
  if (isPgUniqueViolation(error, "slug")) {
    throw err("CONFLICT", { message: "Another course already uses that slug", cause: error, details: { fields: { slug: ["Already in use"] } } });
  }
  throw error;
}

export async function createCourse(actorId: string, input: CourseCreate) {
  try {
    const [course] = await db
      .insert(courses)
      .values({
        slug: input.slug,
        title: input.title,
        titleHi: blankToNull(input.titleHi),
        description: input.description,
        descriptionHi: blankToNull(input.descriptionHi),
        category: input.category,
        difficulty: input.difficulty,
        thumbnailUrl: thumbnail(input.thumbnailUrl),
        durationMinutes: input.durationMinutes ?? 0,
        sortOrder: input.sortOrder ?? 0,
        createdBy: actorId,
      })
      .returning();
    return course;
  } catch (error) {
    return slugConflict(error);
  }
}

export async function updateCourse(id: string, patch: CourseUpdate) {
  const [existing] = await db.select().from(courses).where(eq(courses.id, id)).limit(1);
  if (!existing) throw notFound("Course");

  const set: Partial<typeof courses.$inferInsert> = { updatedAt: new Date() };
  if (patch.slug !== undefined) set.slug = patch.slug;
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.titleHi !== undefined) set.titleHi = blankToNull(patch.titleHi);
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.descriptionHi !== undefined) set.descriptionHi = blankToNull(patch.descriptionHi);
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.difficulty !== undefined) set.difficulty = patch.difficulty;
  if (patch.thumbnailUrl !== undefined) set.thumbnailUrl = thumbnail(patch.thumbnailUrl, existing.thumbnailUrl);
  if (patch.durationMinutes !== undefined) set.durationMinutes = patch.durationMinutes;
  if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;

  try {
    const [updated] = await db.update(courses).set(set).where(eq(courses.id, id)).returning();
    return updated;
  } catch (error) {
    return slugConflict(error);
  }
}

export async function setPublished(id: string, published: boolean) {
  const [existing] = await db.select().from(courses).where(eq(courses.id, id)).limit(1);
  if (!existing) throw notFound("Course");

  if (published) {
    const rows = await db
      .select({ id: lessons.id, title: lessons.title, type: lessons.contentType, url: lessons.videoUrl, seconds: lessons.videoDurationSeconds })
      .from(lessons)
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .where(eq(modules.courseId, id));
    if (rows.length === 0) {
      throw fieldError({ published: ["Add at least one lesson before publishing"] }, "Add at least one lesson before publishing");
    }
    const broken = rows.filter((x) => x.type === "video" && (!x.url || !x.seconds));
    if (broken.length > 0) {
      throw fieldError(
        { published: [`Video lessons need a link and a length: ${broken.slice(0, 5).map((b) => b.title).join(", ")}`] },
        "Some video lessons are incomplete"
      );
    }
  }
  const [updated] = await db.update(courses).set({ isPublished: published, updatedAt: new Date() }).where(eq(courses.id, id)).returning();
  return updated;
}

export async function setArchived(id: string, archived: boolean) {
  const [updated] = await db
    .update(courses)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(eq(courses.id, id))
    .returning();
  if (!updated) throw notFound("Course");
  return updated;
}

export async function deleteCourse(id: string): Promise<void> {
  const [existing] = await db.select({ id: courses.id }).from(courses).where(eq(courses.id, id)).limit(1);
  if (!existing) throw notFound("Course");
  const [[enrolled], [certs]] = await Promise.all([
    db.select({ n: count() }).from(courseEnrollments).where(eq(courseEnrollments.courseId, id)),
    db.select({ n: count() }).from(certificates).where(eq(certificates.courseId, id)),
  ]);
  if (enrolled.n > 0 || certs.n > 0) {
    throw err("COURSE_HAS_RECORDS", {
      message: "Learners are enrolled in this course or hold certificates for it. Archive it instead of deleting it.",
      details: { enrolled: enrolled.n, certificates: certs.n },
    });
  }
  await db.delete(courses).where(eq(courses.id, id));
}

// ─── Ordering ────────────────────────────────────────────────────────────────
async function nextSortOrder(table: "modules" | "lessons", parentId: string): Promise<number> {
  const query =
    table === "modules"
      ? db.select({ max: sql<number | null>`max(${modules.sortOrder})` }).from(modules).where(eq(modules.courseId, parentId))
      : db.select({ max: sql<number | null>`max(${lessons.sortOrder})` }).from(lessons).where(eq(lessons.moduleId, parentId));
  const [row] = await query;
  return (row?.max ?? -1) + 1;
}

function sameIds(expected: string[], received: string[]): boolean {
  if (expected.length !== received.length) return false;
  const set = new Set(expected);
  return received.every((id) => set.delete(id)) && set.size === 0;
}

export async function reorderModules(courseId: string, ids: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await tx.select({ id: modules.id }).from(modules).where(eq(modules.courseId, courseId)).for("update");
    if (!sameIds(current.map((m) => m.id), ids)) {
      throw fieldError({ ids: ["Send every module of the course exactly once"] });
    }
    for (let i = 0; i < ids.length; i++) await tx.update(modules).set({ sortOrder: i }).where(eq(modules.id, ids[i]));
  });
}

export async function reorderLessons(moduleId: string, ids: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await tx.select({ id: lessons.id }).from(lessons).where(eq(lessons.moduleId, moduleId)).for("update");
    if (!sameIds(current.map((l) => l.id), ids)) {
      throw fieldError({ ids: ["Send every lesson of the module exactly once"] });
    }
    for (let i = 0; i < ids.length; i++) await tx.update(lessons).set({ sortOrder: i }).where(eq(lessons.id, ids[i]));
  });
}

// ─── Modules ─────────────────────────────────────────────────────────────────
export async function createModule(courseId: string, input: ModuleCreate) {
  const [course] = await db.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId)).limit(1);
  if (!course) throw notFound("Course");
  const [created] = await db
    .insert(modules)
    .values({
      courseId,
      title: input.title,
      titleHi: blankToNull(input.titleHi),
      description: blankToNull(input.description),
      descriptionHi: blankToNull(input.descriptionHi),
      sortOrder: input.sortOrder ?? (await nextSortOrder("modules", courseId)),
    })
    .returning();
  return created;
}

export async function updateModule(id: string, patch: ModuleUpdate) {
  const set: Partial<typeof modules.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.titleHi !== undefined) set.titleHi = blankToNull(patch.titleHi);
  if (patch.description !== undefined) set.description = blankToNull(patch.description);
  if (patch.descriptionHi !== undefined) set.descriptionHi = blankToNull(patch.descriptionHi);
  if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;
  if (Object.keys(set).length === 0) {
    const [current] = await db.select().from(modules).where(eq(modules.id, id)).limit(1);
    if (!current) throw notFound("Module");
    return current;
  }
  const [updated] = await db.update(modules).set(set).where(eq(modules.id, id)).returning();
  if (!updated) throw notFound("Module");
  return updated;
}

export async function deleteModule(id: string): Promise<string> {
  const [mod] = await db.select().from(modules).where(eq(modules.id, id)).limit(1);
  if (!mod) throw notFound("Module");

  const [[touched], [attempts], [finished]] = await Promise.all([
    db
      .select({ n: count() })
      .from(lessonProgress)
      .innerJoin(lessons, eq(lessons.id, lessonProgress.lessonId))
      .where(eq(lessons.moduleId, id)),
    db
      .select({ n: count() })
      .from(quizAttempts)
      .innerJoin(quizzes, eq(quizzes.id, quizAttempts.quizId))
      .where(eq(quizzes.moduleId, id)),
    db
      .select({ n: sql<number>`count(${moduleProgress.completedAt})::int` })
      .from(moduleProgress)
      .where(eq(moduleProgress.moduleId, id)),
  ]);
  if (touched.n + attempts.n + finished.n > 0) {
    throw err("COURSE_HAS_RECORDS", {
      message: "Learners already have progress in this module, so it cannot be deleted. Remove its lessons from the course by archiving the course, or edit the module instead.",
    });
  }
  await db.delete(modules).where(eq(modules.id, id));
  scheduleCourseRecompute(mod.courseId);
  return mod.courseId;
}

// ─── Lessons ─────────────────────────────────────────────────────────────────
interface ResolvedLesson {
  title: string;
  titleHi: string | null;
  contentType: LessonRow["contentType"];
  videoUrl: string | null;
  videoProvider: string | null;
  videoDurationSeconds: number | null;
  content: string | null;
  contentHi: string | null;
  imageUrl: string | null;
  isRequired: boolean;
}

/** Applies a create/update on top of the existing row, then validates the *result* for its content type. */
function resolveLesson(base: Partial<LessonRow>, patch: LessonCreate | LessonUpdate): ResolvedLesson {
  const pick = <K extends keyof LessonRow>(key: K): LessonRow[K] | undefined =>
    (patch as Partial<LessonRow>)[key] !== undefined ? ((patch as Partial<LessonRow>)[key] as LessonRow[K]) : base[key];

  const contentType = pick("contentType");
  if (!contentType) throw fieldError({ contentType: ["Choose a lesson type"] });
  const errors: Record<string, string[]> = {};
  const add = (field: string, message: string) => (errors[field] ??= []).push(message);

  let videoUrl: string | null = null;
  let videoProvider: string | null = null;
  let duration: number | null = null;

  if (contentType === "video") {
    const requested = blankToNull(pick("videoUrl") as string | null | undefined);
    duration = (pick("videoDurationSeconds") as number | null | undefined) ?? null;
    if (!requested) add("videoUrl", "Add a YouTube link or upload a video");
    else if (requested === base.videoUrl) videoUrl = requested; // unchanged: keep historic data editable
    else {
      try {
        videoUrl = validateMediaUrl(requested, "video");
      } catch (error) {
        if (error instanceof AppError) add("videoUrl", error.message);
        else throw error;
      }
    }
    if (videoUrl) videoProvider = videoProviderOf(videoUrl);
    if (!duration) add("videoDurationSeconds", "Enter the video length — learners must spend this long before it can be marked complete");
  }

  const content = blankToNull(pick("content") as string | null | undefined);
  const contentHi = blankToNull(pick("contentHi") as string | null | undefined);
  if (contentType === "text" && !content) add("content", "Write the lesson text");

  let imageUrl: string | null = null;
  const requestedImage = blankToNull(pick("imageUrl") as string | null | undefined);
  if (requestedImage) {
    if (requestedImage === base.imageUrl) imageUrl = requestedImage;
    else {
      try {
        imageUrl = validateMediaUrl(requestedImage, "image");
      } catch (error) {
        if (error instanceof AppError) add("imageUrl", error.message);
        else throw error;
      }
    }
  } else if (contentType === "image") add("imageUrl", "Add an image");

  if (Object.keys(errors).length > 0) throw fieldError(errors);

  return {
    title: pick("title") as string,
    titleHi: blankToNull(pick("titleHi") as string | null | undefined),
    contentType,
    videoUrl,
    videoProvider,
    videoDurationSeconds: duration,
    content,
    contentHi,
    imageUrl,
    isRequired: (pick("isRequired") as boolean | undefined) ?? true,
  };
}

export async function getLessonAdmin(id: string) {
  const [row] = await db
    .select({ lesson: lessons, courseId: modules.courseId })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .where(eq(lessons.id, id))
    .limit(1);
  if (!row) throw notFound("Lesson");
  return { ...row.lesson, courseId: row.courseId };
}

export async function createLesson(moduleId: string, input: LessonCreate) {
  const [mod] = await db.select().from(modules).where(eq(modules.id, moduleId)).limit(1);
  if (!mod) throw notFound("Module");
  const resolved = resolveLesson({}, input);
  const [created] = await db
    .insert(lessons)
    .values({ ...resolved, moduleId, sortOrder: input.sortOrder ?? (await nextSortOrder("lessons", moduleId)) })
    .returning();
  scheduleCourseRecompute(mod.courseId);
  return created;
}

export async function updateLesson(id: string, patch: LessonUpdate) {
  const ctx = await getLessonAdmin(id);
  const resolved = resolveLesson(ctx, patch);
  const [updated] = await db
    .update(lessons)
    .set({ ...resolved, ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}) })
    .where(eq(lessons.id, id))
    .returning();
  if (resolved.isRequired !== ctx.isRequired) scheduleCourseRecompute(ctx.courseId);
  return updated;
}

export async function deleteLesson(id: string): Promise<void> {
  const ctx = await getLessonAdmin(id);
  const [touched] = await db.select({ n: count() }).from(lessonProgress).where(eq(lessonProgress.lessonId, id));
  if (touched.n > 0) {
    throw err("COURSE_HAS_RECORDS", {
      message: "Learners have already opened this lesson, so it cannot be deleted. Mark it as optional instead.",
      details: { learners: touched.n },
    });
  }
  await db.delete(lessons).where(and(eq(lessons.id, id)));
  scheduleCourseRecompute(ctx.courseId);
}

/** Resolves the course a module belongs to (used by routes that need to refresh learner progress). */
export async function courseIdOfModule(moduleId: string): Promise<string> {
  const [mod] = await db.select({ courseId: modules.courseId }).from(modules).where(eq(modules.id, moduleId)).limit(1);
  if (!mod) throw notFound("Module");
  return mod.courseId;
}
