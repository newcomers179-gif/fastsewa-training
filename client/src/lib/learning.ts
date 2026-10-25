/**
 * Small decisions about "what comes next" in a course, kept free of React so they can be tested.
 * The server decides what counts as finished (a module is complete when its required lessons are done
 * and its quiz passed); these functions only read the flags it sends.
 */
import type { CourseOutline, LessonOutline, LessonProgressView, ModuleDetail } from "@/types";

export type NextStep =
  | { kind: "lesson"; lessonId: string; moduleId: string }
  | { kind: "quiz"; moduleId: string }
  | { kind: "done" };

/** Where "Continue" in a course should lead: the first unfinished lesson, else a quiz still to pass, else nowhere (all done). */
export function nextStep(course: Pick<CourseOutline, "modules">): NextStep {
  for (const module of course.modules) {
    if (module.completed) continue;
    const lesson = module.lessons.find((l) => !l.completed);
    if (lesson) return { kind: "lesson", lessonId: lesson.id, moduleId: module.id };
    if (module.hasQuiz && !module.quizPassed) return { kind: "quiz", moduleId: module.id };
  }
  return { kind: "done" };
}

export type AfterLesson = { kind: "lesson"; lessonId: string } | { kind: "quiz"; moduleId: string } | { kind: "module" };

/** What to offer once a lesson is finished: the lesson after it, else the module's quiz when still to pass, else back to the module. */
export function afterLesson(module: Pick<ModuleDetail, "id" | "lessons" | "quiz">, lessonId: string): AfterLesson {
  const index = module.lessons.findIndex((l) => l.id === lessonId);
  const following: LessonOutline | undefined = index >= 0 ? module.lessons[index + 1] : undefined;
  if (following) return { kind: "lesson", lessonId: following.id };
  if (module.quiz && !module.quiz.passed) return { kind: "quiz", moduleId: module.id };
  return { kind: "module" };
}

/** Seconds the server still wants to see on this lesson before it accepts "mark as complete". */
export function secondsStillNeeded(progress: Pick<LessonProgressView, "completed" | "watchedSeconds" | "requiredSeconds">): number {
  if (progress.completed) return 0;
  return Math.max(0, progress.requiredSeconds - progress.watchedSeconds);
}

/** 0–100, for the "time on this lesson" bar. */
export function watchPercent(progress: Pick<LessonProgressView, "completed" | "watchedSeconds" | "requiredSeconds">): number {
  if (progress.completed || progress.requiredSeconds <= 0) return 100;
  return Math.min(100, Math.round((progress.watchedSeconds / progress.requiredSeconds) * 100));
}

/** Where a video should start: the saved spot, unless it is at (or almost at) the end. */
export function resumePosition(progress: Pick<LessonProgressView, "videoProgressSeconds" | "completed">, durationSeconds: number | null): number {
  const saved = Math.max(0, Math.floor(progress.videoProgressSeconds));
  if (saved < 5) return 0;
  if (durationSeconds && saved >= durationSeconds - 5) return 0;
  return saved;
}

export function lessonsDoneIn(module: { lessons: readonly { completed: boolean }[] }): { done: number; total: number } {
  return { done: module.lessons.filter((l) => l.completed).length, total: module.lessons.length };
}
