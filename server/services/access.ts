import { and, eq } from "drizzle-orm";
import { courseEnrollments, courses, lessons, modules, type Role } from "@shared/schema";
import { db, type DbOrTx } from "../db";
import { err, notFound } from "../errors";

export const isStaffRole = (role: Role) => role === "admin" || role === "trainer";

export type Course = typeof courses.$inferSelect;
export type Enrollment = typeof courseEnrollments.$inferSelect;

export interface CourseAccess {
  course: Course;
  enrollment: Enrollment | null;
  /** A trainer/admin looking at a course that learners cannot see (draft or archived). */
  preview: boolean;
}

/**
 * How much of a course a user may touch:
 *  - "outline": see title/structure (any signed-in user, published courses only; staff may also preview drafts);
 *  - "content": read lesson content (enrolled learners; staff may preview);
 *  - "learn":   record progress / take quizzes (enrolled learners of an available course — staff included).
 * This is the single place that decides it, so no endpoint can forget the check
 * (the old API returned lesson content and accepted progress for any course id).
 */
export async function getCourseAccess(
  user: { id: string; role: Role },
  courseId: string,
  mode: "outline" | "content" | "learn",
  dbc: DbOrTx = db
): Promise<CourseAccess> {
  const [course] = await dbc.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  if (!course) throw notFound("Course");

  const available = course.isPublished && !course.archivedAt;
  const staff = isStaffRole(user.role);
  if (!available && !(staff && mode !== "learn")) throw err("COURSE_NOT_AVAILABLE");

  const [enrollment] = await dbc
    .select()
    .from(courseEnrollments)
    .where(and(eq(courseEnrollments.userId, user.id), eq(courseEnrollments.courseId, courseId)))
    .limit(1);

  if (mode === "learn" && !enrollment) throw err("NOT_ENROLLED");
  if (mode === "content" && !enrollment && !staff) throw err("NOT_ENROLLED");

  return { course, enrollment: enrollment ?? null, preview: !available };
}

export type Lesson = typeof lessons.$inferSelect;

export interface LessonContext {
  lesson: Lesson;
  moduleId: string;
  courseId: string;
}

export async function getLessonContext(lessonId: string, dbc: DbOrTx = db): Promise<LessonContext | null> {
  const [row] = await dbc
    .select({ lesson: lessons, courseId: modules.courseId })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .where(eq(lessons.id, lessonId))
    .limit(1);
  return row ? { lesson: row.lesson, moduleId: row.lesson.moduleId, courseId: row.courseId } : null;
}

export async function getModuleContext(moduleId: string, dbc: DbOrTx = db) {
  const [row] = await dbc.select().from(modules).where(eq(modules.id, moduleId)).limit(1);
  return row ?? null;
}
