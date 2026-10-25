import { Router } from "express";
import { and, asc, count, countDistinct, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";
import { courseEnrollments, courses, lessonProgress, lessons, modules, quizzes } from "@shared/schema";
import { db } from "../db";
import { notFound } from "../errors";
import { requireAuth } from "../middleware/auth";
import type { Limiters } from "../middleware/rateLimit";
import { getCourseAccess, getLessonContext, getModuleContext, isStaffRole, type Course } from "../services/access";
import {
  enrollInCourse,
  evaluateModule,
  getCourseModuleStates,
  getModuleState,
  toLessonProgressView,
} from "../services/progress";
import { getQuizStatus } from "../services/quiz";
import { escapeLike, idParam } from "../utils/params";
import { parse } from "../utils/validate";
import { courseListQuery } from "../validators";

/** Lesson fields that are safe to show to anyone who can see the course outline (no URLs, no content). */
const lessonOutline = {
  id: lessons.id,
  moduleId: lessons.moduleId,
  title: lessons.title,
  titleHi: lessons.titleHi,
  contentType: lessons.contentType,
  videoDurationSeconds: lessons.videoDurationSeconds,
  sortOrder: lessons.sortOrder,
  isRequired: lessons.isRequired,
} as const;

function courseView(c: Course) {
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    titleHi: c.titleHi,
    description: c.description,
    descriptionHi: c.descriptionHi,
    category: c.category,
    difficulty: c.difficulty,
    thumbnailUrl: c.thumbnailUrl,
    durationMinutes: c.durationMinutes,
    isPublished: c.isPublished,
    archivedAt: c.archivedAt,
  };
}

export function coursesRoutes(l: Limiters): Router {
  const r = Router();
  r.use(requireAuth, l.authenticated);

  // Specific routes first: "/module/:id" and "/lesson/:id" must not be read as "/:id".

  // GET /courses/module/:moduleId — a module with its lessons, the learner's ticks and the quiz status
  r.get("/module/:moduleId", async (req, res) => {
    const user = req.user!;
    const moduleId = idParam(req, "moduleId", "Module");
    const mod = await getModuleContext(moduleId);
    if (!mod) throw notFound("Module");
    await getCourseAccess(user, mod.courseId, "content");

    const [lessonRows, doneRows, state, [quiz]] = await Promise.all([
      db.select(lessonOutline).from(lessons).where(eq(lessons.moduleId, moduleId)).orderBy(asc(lessons.sortOrder), asc(lessons.createdAt)),
      db
        .select({ lessonId: lessonProgress.lessonId })
        .from(lessonProgress)
        .innerJoin(lessons, eq(lessons.id, lessonProgress.lessonId))
        .where(and(eq(lessonProgress.userId, user.id), eq(lessons.moduleId, moduleId), eq(lessonProgress.completed, true))),
      getModuleState(db, user.id, moduleId),
      db.select().from(quizzes).where(eq(quizzes.moduleId, moduleId)).limit(1),
    ]);
    const done = new Set(doneRows.map((d) => d.lessonId));
    const evaluated = state ? evaluateModule(state) : null;

    res.json({
      id: mod.id,
      courseId: mod.courseId,
      title: mod.title,
      titleHi: mod.titleHi,
      description: mod.description,
      descriptionHi: mod.descriptionHi,
      sortOrder: mod.sortOrder,
      lessons: lessonRows.map((x) => ({ ...x, completed: done.has(x.id) })),
      progress: state
        ? {
            requiredLessons: state.requiredLessons,
            requiredDone: state.requiredDone,
            lessonsDone: evaluated!.lessonsDone,
            completed: !!state.completedAt || evaluated!.satisfied,
          }
        : null,
      quiz: quiz
        ? {
            id: quiz.id,
            title: quiz.title,
            passingScore: quiz.passingScore,
            ...(await getQuizStatus(db, user.id, quiz.id, moduleId)),
          }
        : null,
    });
  });

  // GET /courses/lesson/:lessonId — the lesson itself (URLs, text) + the learner's progress on it
  r.get("/lesson/:lessonId", async (req, res) => {
    const user = req.user!;
    const lessonId = idParam(req, "lessonId", "Lesson");
    const ctx = await getLessonContext(lessonId);
    if (!ctx) throw notFound("Lesson");
    await getCourseAccess(user, ctx.courseId, "content");

    const [row] = await db
      .select()
      .from(lessonProgress)
      .where(and(eq(lessonProgress.userId, user.id), eq(lessonProgress.lessonId, lessonId)))
      .limit(1);

    const l0 = ctx.lesson;
    res.json({
      id: l0.id,
      moduleId: ctx.moduleId,
      courseId: ctx.courseId,
      title: l0.title,
      titleHi: l0.titleHi,
      contentType: l0.contentType,
      videoUrl: l0.videoUrl,
      videoProvider: l0.videoProvider,
      videoDurationSeconds: l0.videoDurationSeconds,
      content: l0.content,
      contentHi: l0.contentHi,
      imageUrl: l0.imageUrl,
      sortOrder: l0.sortOrder,
      isRequired: l0.isRequired,
      progress: toLessonProgressView(l0, row ?? null),
    });
  });

  // GET /courses — learners see published, non-archived courses; staff see everything
  r.get("/", async (req, res) => {
    const user = req.user!;
    const q = parse(courseListQuery, req.query);

    const conditions: SQL[] = [];
    if (!isStaffRole(user.role)) conditions.push(eq(courses.isPublished, true), isNull(courses.archivedAt));
    if (q.category) conditions.push(eq(courses.category, q.category));
    if (q.q) {
      const pattern = `%${escapeLike(q.q)}%`;
      conditions.push(or(ilike(courses.title, pattern), ilike(courses.titleHi, pattern), ilike(courses.description, pattern))!);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [totals]] = await Promise.all([
      db
        .select()
        .from(courses)
        .where(where)
        .orderBy(asc(courses.sortOrder), asc(courses.title), asc(courses.id))
        .limit(q.limit)
        .offset(q.offset),
      db.select({ total: count() }).from(courses).where(where),
    ]);
    res.set("X-Total-Count", String(totals.total));
    if (rows.length === 0) {
      res.json([]);
      return;
    }

    const ids = rows.map((c) => c.id);
    const [enrollRows, countRows] = await Promise.all([
      db
        .select({
          courseId: courseEnrollments.courseId,
          completionPercent: courseEnrollments.completionPercent,
          completedAt: courseEnrollments.completedAt,
        })
        .from(courseEnrollments)
        .where(and(eq(courseEnrollments.userId, user.id), inArray(courseEnrollments.courseId, ids))),
      db
        .select({
          courseId: modules.courseId,
          moduleCount: countDistinct(modules.id),
          lessonCount: count(lessons.id),
        })
        .from(modules)
        .leftJoin(lessons, eq(lessons.moduleId, modules.id))
        .where(inArray(modules.courseId, ids))
        .groupBy(modules.courseId),
    ]);
    const enrollment = new Map(enrollRows.map((e) => [e.courseId, e]));
    const sizes = new Map(countRows.map((c) => [c.courseId, c]));

    res.json(
      rows.map((c) => ({
        ...courseView(c),
        moduleCount: sizes.get(c.id)?.moduleCount ?? 0,
        lessonCount: sizes.get(c.id)?.lessonCount ?? 0,
        enrolled: enrollment.has(c.id),
        completionPercent: enrollment.get(c.id)?.completionPercent ?? 0,
        completedAt: enrollment.get(c.id)?.completedAt ?? null,
      }))
    );
  });

  // GET /courses/:id — outline: modules and lesson titles, never URLs or lesson text
  r.get("/:id", async (req, res) => {
    const user = req.user!;
    const courseId = idParam(req, "id", "Course");
    const { course, enrollment, preview } = await getCourseAccess(user, courseId, "outline");

    const [moduleRows, lessonRows, doneRows, states] = await Promise.all([
      db.select().from(modules).where(eq(modules.courseId, courseId)).orderBy(asc(modules.sortOrder), asc(modules.createdAt)),
      db
        .select(lessonOutline)
        .from(lessons)
        .innerJoin(modules, eq(modules.id, lessons.moduleId))
        .where(eq(modules.courseId, courseId))
        .orderBy(asc(lessons.sortOrder), asc(lessons.createdAt)),
      db
        .select({ lessonId: lessonProgress.lessonId })
        .from(lessonProgress)
        .innerJoin(lessons, eq(lessons.id, lessonProgress.lessonId))
        .innerJoin(modules, eq(modules.id, lessons.moduleId))
        .where(and(eq(lessonProgress.userId, user.id), eq(modules.courseId, courseId), eq(lessonProgress.completed, true))),
      getCourseModuleStates(db, user.id, courseId),
    ]);
    const done = new Set(doneRows.map((d) => d.lessonId));
    const stateOf = new Map(states.map((s) => [s.moduleId, s]));

    res.json({
      ...courseView(course),
      preview,
      enrollment: enrollment
        ? {
            id: enrollment.id,
            enrolledAt: enrollment.enrolledAt,
            completedAt: enrollment.completedAt,
            completionPercent: enrollment.completionPercent,
          }
        : null,
      modules: moduleRows.map((m) => {
        const state = stateOf.get(m.id);
        const evaluated = state ? evaluateModule(state) : null;
        return {
          id: m.id,
          title: m.title,
          titleHi: m.titleHi,
          description: m.description,
          descriptionHi: m.descriptionHi,
          sortOrder: m.sortOrder,
          hasQuiz: state?.hasQuiz ?? false,
          quizPassed: state?.quizPassed ?? false,
          completed: !!state?.completedAt || (evaluated?.satisfied ?? false),
          lessons: lessonRows.filter((x) => x.moduleId === m.id).map((x) => ({ ...x, completed: done.has(x.id) })),
        };
      }),
    });
  });

  // POST /courses/:id/enroll
  r.post("/:id/enroll", async (req, res) => {
    const { enrollment, created } = await enrollInCourse(req.user!, idParam(req, "id", "Course"));
    res.status(created ? 201 : 200).json(enrollment);
  });

  return r;
}
