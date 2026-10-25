import { Router } from "express";
import { notFound } from "../../errors";
import { requireRole } from "../../middleware/auth";
import { audit } from "../../services/audit";
import {
  courseIdOfModule,
  createCourse,
  createLesson,
  createModule,
  deleteCourse,
  deleteLesson,
  deleteModule,
  getCourseTreeAdmin,
  getLessonAdmin,
  listCoursesAdmin,
  reorderLessons,
  reorderModules,
  scheduleCourseRecompute,
  setArchived,
  setPublished,
  updateCourse,
  updateLesson,
  updateModule,
} from "../../services/content";
import { deleteQuiz, getQuizForAdmin, upsertQuiz } from "../../services/quiz";
import { idParam } from "../../utils/params";
import { parse } from "../../utils/validate";
import {
  courseCreateBody,
  courseUpdateBody,
  lessonCreateBody,
  lessonUpdateBody,
  moduleCreateBody,
  moduleUpdateBody,
  publishBody,
  quizInput,
  reorderBody,
} from "../../validators";

const adminOnly = requireRole("admin");

/** Courses, modules, lessons and quizzes. */
export function contentRoutes(): Router {
  const r = Router();

  // ─── Courses ───────────────────────────────────────────────────────────────
  r.get("/courses", async (_req, res) => {
    res.json(await listCoursesAdmin());
  });

  r.get("/courses/:id", async (req, res) => {
    res.json(await getCourseTreeAdmin(idParam(req, "id", "Course")));
  });

  r.post("/courses", adminOnly, async (req, res) => {
    const course = await createCourse(req.user!.id, parse(courseCreateBody, req.body));
    await audit(req, "course.created", { type: "course", id: course.id }, { slug: course.slug });
    res.status(201).json(course);
  });

  r.put("/courses/:id", adminOnly, async (req, res) => {
    const id = idParam(req, "id", "Course");
    const patch = parse(courseUpdateBody, req.body);
    const course = await updateCourse(id, patch);
    await audit(req, "course.updated", { type: "course", id }, { fields: Object.keys(patch) });
    res.json(course);
  });

  r.patch("/courses/:id/publish", adminOnly, async (req, res) => {
    const id = idParam(req, "id", "Course");
    const { published } = parse(publishBody, req.body);
    const course = await setPublished(id, published);
    await audit(req, published ? "course.published" : "course.unpublished", { type: "course", id });
    res.json(course);
  });

  r.patch("/courses/:id/archive", adminOnly, async (req, res) => {
    const id = idParam(req, "id", "Course");
    const course = await setArchived(id, true);
    await audit(req, "course.archived", { type: "course", id });
    res.json(course);
  });

  r.patch("/courses/:id/unarchive", adminOnly, async (req, res) => {
    const id = idParam(req, "id", "Course");
    const course = await setArchived(id, false);
    await audit(req, "course.unarchived", { type: "course", id });
    res.json(course);
  });

  r.delete("/courses/:id", adminOnly, async (req, res) => {
    const id = idParam(req, "id", "Course");
    await deleteCourse(id);
    await audit(req, "course.deleted", { type: "course", id });
    res.json({ message: "Course deleted" });
  });

  // ─── Modules ───────────────────────────────────────────────────────────────
  r.post("/courses/:courseId/modules", adminOnly, async (req, res) => {
    const courseId = idParam(req, "courseId", "Course");
    const mod = await createModule(courseId, parse(moduleCreateBody, req.body));
    await audit(req, "module.created", { type: "module", id: mod.id }, { courseId });
    res.status(201).json(mod);
  });

  r.post("/courses/:courseId/modules/reorder", adminOnly, async (req, res) => {
    const courseId = idParam(req, "courseId", "Course");
    await reorderModules(courseId, parse(reorderBody, req.body).ids);
    await audit(req, "module.reordered", { type: "course", id: courseId });
    res.json({ message: "Modules reordered" });
  });

  r.put("/modules/:id", adminOnly, async (req, res) => {
    const id = idParam(req, "id", "Module");
    const mod = await updateModule(id, parse(moduleUpdateBody, req.body));
    await audit(req, "module.updated", { type: "module", id });
    res.json(mod);
  });

  r.delete("/modules/:id", adminOnly, async (req, res) => {
    const id = idParam(req, "id", "Module");
    await deleteModule(id);
    await audit(req, "module.deleted", { type: "module", id });
    res.json({ message: "Module deleted" });
  });

  // ─── Lessons ───────────────────────────────────────────────────────────────
  r.post("/modules/:moduleId/lessons", adminOnly, async (req, res) => {
    const moduleId = idParam(req, "moduleId", "Module");
    const lesson = await createLesson(moduleId, parse(lessonCreateBody, req.body));
    await audit(req, "lesson.created", { type: "lesson", id: lesson.id }, { moduleId });
    res.status(201).json(lesson);
  });

  r.post("/modules/:moduleId/lessons/reorder", adminOnly, async (req, res) => {
    const moduleId = idParam(req, "moduleId", "Module");
    await reorderLessons(moduleId, parse(reorderBody, req.body).ids);
    await audit(req, "lesson.reordered", { type: "module", id: moduleId });
    res.json({ message: "Lessons reordered" });
  });

  r.get("/lessons/:id", async (req, res) => {
    res.json(await getLessonAdmin(idParam(req, "id", "Lesson")));
  });

  r.put("/lessons/:id", adminOnly, async (req, res) => {
    const id = idParam(req, "id", "Lesson");
    const patch = parse(lessonUpdateBody, req.body);
    const lesson = await updateLesson(id, patch);
    await audit(req, "lesson.updated", { type: "lesson", id }, { fields: Object.keys(patch) });
    res.json(lesson);
  });

  r.delete("/lessons/:id", adminOnly, async (req, res) => {
    const id = idParam(req, "id", "Lesson");
    await deleteLesson(id);
    await audit(req, "lesson.deleted", { type: "lesson", id });
    res.json({ message: "Lesson deleted" });
  });

  // ─── Quizzes (one per module) ──────────────────────────────────────────────
  r.get("/modules/:moduleId/quiz", async (req, res) => {
    const quiz = await getQuizForAdmin(idParam(req, "moduleId", "Module"));
    if (!quiz) throw notFound("Quiz");
    res.json(quiz);
  });

  /** Creates the quiz or replaces its title, pass mark and questions. */
  r.put("/modules/:moduleId/quiz", adminOnly, async (req, res) => {
    const moduleId = idParam(req, "moduleId", "Module");
    const quiz = await upsertQuiz(moduleId, parse(quizInput, req.body));
    await audit(req, "quiz.saved", { type: "module", id: moduleId }, { questions: quiz?.questions.length ?? 0 });
    scheduleCourseRecompute(await courseIdOfModule(moduleId));
    res.json(quiz);
  });

  r.delete("/modules/:moduleId/quiz", adminOnly, async (req, res) => {
    const moduleId = idParam(req, "moduleId", "Module");
    const removed = await deleteQuiz(moduleId);
    if (!removed) throw notFound("Quiz");
    await audit(req, "quiz.deleted", { type: "module", id: moduleId });
    scheduleCourseRecompute(await courseIdOfModule(moduleId));
    res.json({ message: "Quiz deleted" });
  });

  return r;
}
