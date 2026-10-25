import { Router } from "express";
import { and, asc, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  certificates,
  courseEnrollments,
  courses,
  lessonProgress,
  lessons,
  moduleProgress,
  modules,
} from "@shared/schema";
import { db } from "../db";
import { err, notFound } from "../errors";
import { requireAuth } from "../middleware/auth";
import type { Limiters } from "../middleware/rateLimit";
import { getCourseAccess, getLessonContext, getModuleContext } from "../services/access";
import {
  evaluateModule,
  getCourseModuleStates,
  getModuleState,
  recordLessonProgress,
  toLessonProgressView,
} from "../services/progress";
import { idParam } from "../utils/params";
import { parse } from "../utils/validate";
import { lessonProgressBody } from "../validators";

export function progressRoutes(l: Limiters): Router {
  const r = Router();
  r.use(requireAuth, l.authenticated);

  /**
   * POST /progress/lesson — heartbeat + completion.
   * The app sends this every ~10 s while a lesson is open (position for "resume", and the server
   * measures time spent itself), and once more with `completed: true` when the learner finishes.
   */
  r.post("/lesson", async (req, res) => {
    const body = parse(lessonProgressBody, req.body);
    const result = await recordLessonProgress(req.user!, {
      lessonId: body.lessonId,
      positionSeconds: body.positionSeconds ?? body.videoProgressSeconds,
      completed: body.completed,
    });
    res.json(result);
  });

  // GET /progress/lesson/:lessonId — resume point + how close the learner is to being allowed to finish
  r.get("/lesson/:lessonId", async (req, res) => {
    const lessonId = idParam(req, "lessonId", "Lesson");
    const ctx = await getLessonContext(lessonId);
    if (!ctx) throw notFound("Lesson");
    await getCourseAccess(req.user!, ctx.courseId, "content");
    const [row] = await db
      .select()
      .from(lessonProgress)
      .where(and(eq(lessonProgress.userId, req.user!.id), eq(lessonProgress.lessonId, lessonId)))
      .limit(1);
    res.json(toLessonProgressView(ctx.lesson, row ?? null));
  });

  // GET /progress/module/:moduleId
  r.get("/module/:moduleId", async (req, res) => {
    const user = req.user!;
    const moduleId = idParam(req, "moduleId", "Module");
    const mod = await getModuleContext(moduleId);
    if (!mod) throw notFound("Module");
    await getCourseAccess(user, mod.courseId, "content");

    const state = await getModuleState(db, user.id, moduleId);
    if (!state) throw notFound("Module");
    const evaluated = evaluateModule(state);
    const rows = await db
      .select({
        lessonId: lessonProgress.lessonId,
        completed: lessonProgress.completed,
        videoProgressSeconds: lessonProgress.videoProgressSeconds,
        watchedSeconds: lessonProgress.watchedSeconds,
        completedAt: lessonProgress.completedAt,
      })
      .from(lessonProgress)
      .innerJoin(lessons, eq(lessons.id, lessonProgress.lessonId))
      .where(and(eq(lessonProgress.userId, user.id), eq(lessons.moduleId, moduleId)));

    res.json({
      moduleId,
      totalLessons: state.totalLessons,
      requiredLessons: state.requiredLessons,
      requiredDone: state.requiredDone,
      lessonsDone: evaluated.lessonsDone,
      hasQuiz: state.hasQuiz,
      quizPassed: state.quizPassed,
      completed: !!state.completedAt || evaluated.satisfied,
      completedAt: state.completedAt,
      lessons: rows,
    });
  });

  // GET /progress/all-lessons — every lesson the user has touched (small: bounded by the catalogue size)
  r.get("/all-lessons", async (req, res) => {
    const rows = await db
      .select({
        lessonId: lessonProgress.lessonId,
        completed: lessonProgress.completed,
        videoProgressSeconds: lessonProgress.videoProgressSeconds,
        completedAt: lessonProgress.completedAt,
      })
      .from(lessonProgress)
      .where(eq(lessonProgress.userId, req.user!.id));
    res.json(rows);
  });

  // GET /progress/course/:courseId — progress inside ONE course (the old endpoint returned the user's progress in every course)
  r.get("/course/:courseId", async (req, res) => {
    const user = req.user!;
    const courseId = idParam(req, "courseId", "Course");
    const { enrollment } = await getCourseAccess(user, courseId, "content");
    if (!enrollment) throw err("NOT_ENROLLED");

    const [states, lessonRows] = await Promise.all([
      getCourseModuleStates(db, user.id, courseId),
      db
        .select({
          lessonId: lessonProgress.lessonId,
          completed: lessonProgress.completed,
          videoProgressSeconds: lessonProgress.videoProgressSeconds,
          watchedSeconds: lessonProgress.watchedSeconds,
          completedAt: lessonProgress.completedAt,
        })
        .from(lessonProgress)
        .innerJoin(lessons, eq(lessons.id, lessonProgress.lessonId))
        .innerJoin(modules, eq(modules.id, lessons.moduleId))
        .where(and(eq(lessonProgress.userId, user.id), eq(modules.courseId, courseId))),
    ]);

    res.json({
      enrollment: {
        id: enrollment.id,
        enrolledAt: enrollment.enrolledAt,
        completedAt: enrollment.completedAt,
        completionPercent: enrollment.completionPercent,
      },
      modules: states.map((s) => {
        const e = evaluateModule(s);
        return {
          moduleId: s.moduleId,
          requiredLessons: s.requiredLessons,
          requiredDone: s.requiredDone,
          lessonsDone: e.lessonsDone,
          hasQuiz: s.hasQuiz,
          quizPassed: s.quizPassed,
          completed: !!s.completedAt || e.satisfied,
          completedAt: s.completedAt,
        };
      }),
      lessons: lessonRows,
    });
  });

  /**
   * GET /progress/enrolled-courses — enrolled courses with their module/lesson tree and ticks (To-Do tab).
   * Four queries in total regardless of how many courses the learner is enrolled in.
   */
  r.get("/enrolled-courses", async (req, res) => {
    const userId = req.user!.id;

    const enrolled = await db
      .select({
        id: courses.id,
        title: courses.title,
        titleHi: courses.titleHi,
        category: courses.category,
        completionPercent: courseEnrollments.completionPercent,
        completedAt: courseEnrollments.completedAt,
      })
      .from(courseEnrollments)
      .innerJoin(courses, eq(courses.id, courseEnrollments.courseId))
      .where(and(eq(courseEnrollments.userId, userId), eq(courses.isPublished, true), isNull(courses.archivedAt)))
      .orderBy(asc(courses.sortOrder), asc(courses.title));
    if (enrolled.length === 0) {
      res.json([]);
      return;
    }

    const courseIds = enrolled.map((c) => c.id);
    const [moduleRows, lessonRows, doneRows] = await Promise.all([
      db
        .select({ id: modules.id, courseId: modules.courseId, title: modules.title, titleHi: modules.titleHi, sortOrder: modules.sortOrder })
        .from(modules)
        .where(inArray(modules.courseId, courseIds))
        .orderBy(asc(modules.sortOrder), asc(modules.createdAt)),
      db
        .select({
          id: lessons.id,
          moduleId: lessons.moduleId,
          title: lessons.title,
          titleHi: lessons.titleHi,
          contentType: lessons.contentType,
          sortOrder: lessons.sortOrder,
          isRequired: lessons.isRequired,
        })
        .from(lessons)
        .innerJoin(modules, eq(modules.id, lessons.moduleId))
        .where(inArray(modules.courseId, courseIds))
        .orderBy(asc(lessons.sortOrder), asc(lessons.createdAt)),
      db
        .select({ lessonId: lessonProgress.lessonId })
        .from(lessonProgress)
        .innerJoin(lessons, eq(lessons.id, lessonProgress.lessonId))
        .innerJoin(modules, eq(modules.id, lessons.moduleId))
        .where(and(eq(lessonProgress.userId, userId), eq(lessonProgress.completed, true), inArray(modules.courseId, courseIds))),
    ]);

    const done = new Set(doneRows.map((d) => d.lessonId));
    const lessonsByModule = new Map<string, typeof lessonRows>();
    for (const x of lessonRows) {
      const list = lessonsByModule.get(x.moduleId) ?? [];
      list.push(x);
      lessonsByModule.set(x.moduleId, list);
    }
    const modulesByCourse = new Map<string, typeof moduleRows>();
    for (const m of moduleRows) {
      const list = modulesByCourse.get(m.courseId) ?? [];
      list.push(m);
      modulesByCourse.set(m.courseId, list);
    }

    res.json(
      enrolled.map((c) => ({
        ...c,
        modules: (modulesByCourse.get(c.id) ?? []).map((m) => ({
          id: m.id,
          title: m.title,
          titleHi: m.titleHi,
          sortOrder: m.sortOrder,
          lessons: (lessonsByModule.get(m.id) ?? []).map((x) => ({ ...x, completed: done.has(x.id) })),
        })),
      }))
    );
  });

  // GET /progress/stats
  r.get("/stats", async (req, res) => {
    const userId = req.user!.id;
    const [[mods], [lessonStats], [certs], [enrollStats]] = await Promise.all([
      db
        .select({ n: count() })
        .from(moduleProgress)
        .where(and(eq(moduleProgress.userId, userId), isNotNull(moduleProgress.completedAt))),
      db
        .select({
          completed: sql<number>`count(*) FILTER (WHERE ${lessonProgress.completed})::int`,
          seconds: sql<number>`COALESCE(sum(${lessonProgress.watchedSeconds}), 0)::int`,
        })
        .from(lessonProgress)
        .where(eq(lessonProgress.userId, userId)),
      db
        .select({ n: count() })
        .from(certificates)
        .where(and(eq(certificates.userId, userId), isNull(certificates.revokedAt))),
      db
        .select({
          enrolled: count(),
          completed: sql<number>`count(${courseEnrollments.completedAt})::int`,
        })
        .from(courseEnrollments)
        .where(eq(courseEnrollments.userId, userId)),
    ]);

    res.json({
      modulesCompleted: mods.n,
      lessonsCompleted: lessonStats.completed,
      certificatesEarned: certs.n,
      coursesEnrolled: enrollStats.enrolled,
      coursesCompleted: enrollStats.completed,
      learningMinutes: Math.round(lessonStats.seconds / 60),
    });
  });

  return r;
}
