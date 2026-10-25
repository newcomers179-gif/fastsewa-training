/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { afterLesson, lessonsDoneIn, nextStep, resumePosition, secondsStillNeeded, watchPercent } from "../src/lib/learning";
import type { LessonOutline, ModuleOutline } from "../src/types";

function lesson(id: string, completed = false): LessonOutline {
  return { id, moduleId: "m", title: id, titleHi: null, contentType: "text", videoDurationSeconds: null, sortOrder: 0, isRequired: true, completed };
}
function module(id: string, lessons: LessonOutline[], extra: Partial<ModuleOutline> = {}): ModuleOutline {
  return {
    id,
    title: id,
    titleHi: null,
    description: null,
    descriptionHi: null,
    sortOrder: 0,
    hasQuiz: false,
    quizPassed: false,
    completed: lessons.length > 0 && lessons.every((l) => l.completed),
    lessons,
    ...extra,
  };
}

describe("Continue in a course", () => {
  it("goes to the first lesson not yet done", () => {
    const course = { modules: [module("m1", [lesson("a", true), lesson("b", true)]), module("m2", [lesson("c", true), lesson("d"), lesson("e")])] };
    assert.deepEqual(nextStep(course), { kind: "lesson", lessonId: "d", moduleId: "m2" });
  });

  it("leads to a quiz that is still to pass once the lessons are done", () => {
    const course = { modules: [module("m1", [lesson("a", true)], { hasQuiz: true, quizPassed: false, completed: false })] };
    assert.deepEqual(nextStep(course), { kind: "quiz", moduleId: "m1" });
  });

  it("looks past finished modules, and says 'done' when nothing is left", () => {
    const done = { modules: [module("m1", [lesson("a", true)], { hasQuiz: true, quizPassed: true, completed: true })] };
    assert.deepEqual(nextStep(done), { kind: "done" });
    assert.deepEqual(nextStep({ modules: [] }), { kind: "done" });
  });

  it("does not offer the lessons of a module the server already counts as complete", () => {
    const course = { modules: [module("m1", [lesson("a")], { completed: true }), module("m2", [lesson("b")])] };
    assert.deepEqual(nextStep(course), { kind: "lesson", lessonId: "b", moduleId: "m2" });
  });
});

describe("what to offer after a lesson", () => {
  const lessons = [lesson("a"), lesson("b"), lesson("c")];
  const quiz = (passed: boolean) => ({ id: "q", title: "Quiz", passingScore: 70, locked: false, passed, bestScore: null, attemptsToday: 0, maxAttempts: 10, nextAttemptAt: null });

  it("offers the next lesson", () => {
    assert.deepEqual(afterLesson({ id: "m", lessons, quiz: quiz(false) }, "a"), { kind: "lesson", lessonId: "b" });
  });
  it("offers the quiz after the last lesson when it is not passed yet", () => {
    assert.deepEqual(afterLesson({ id: "m", lessons, quiz: quiz(false) }, "c"), { kind: "quiz", moduleId: "m" });
  });
  it("goes back to the module when there is no quiz or it is passed", () => {
    assert.deepEqual(afterLesson({ id: "m", lessons, quiz: null }, "c"), { kind: "module" });
    assert.deepEqual(afterLesson({ id: "m", lessons, quiz: quiz(true) }, "c"), { kind: "module" });
  });
  it("copes with a lesson that is not in the module", () => {
    assert.deepEqual(afterLesson({ id: "m", lessons, quiz: null }, "zzz"), { kind: "module" });
  });
});

describe("time on a lesson", () => {
  const progress = (watchedSeconds: number, requiredSeconds: number, completed = false) => ({ completed, watchedSeconds, requiredSeconds });

  it("counts down what the server still wants to see", () => {
    assert.equal(secondsStillNeeded(progress(30, 120)), 90);
    assert.equal(secondsStillNeeded(progress(200, 120)), 0);
    assert.equal(secondsStillNeeded(progress(0, 120, true)), 0);
  });

  it("fills the bar from 0 to 100 and never beyond", () => {
    assert.equal(watchPercent(progress(0, 120)), 0);
    assert.equal(watchPercent(progress(60, 120)), 50);
    assert.equal(watchPercent(progress(500, 120)), 100);
    assert.equal(watchPercent(progress(0, 0)), 100, "nothing required: nothing to wait for");
    assert.equal(watchPercent(progress(1, 120, true)), 100);
  });

  it("resumes a video where it was left, unless that is the very start or the very end", () => {
    const at = (videoProgressSeconds: number) => ({ videoProgressSeconds, completed: false });
    assert.equal(resumePosition(at(95.7), 300), 95);
    assert.equal(resumePosition(at(3), 300), 0);
    assert.equal(resumePosition(at(298), 300), 0);
    assert.equal(resumePosition(at(250), null), 250);
    assert.equal(resumePosition(at(-20), 300), 0);
  });

  it("counts finished lessons in a module", () => {
    assert.deepEqual(lessonsDoneIn({ lessons: [lesson("a", true), lesson("b"), lesson("c", true)] }), { done: 2, total: 3 });
    assert.deepEqual(lessonsDoneIn({ lessons: [] }), { done: 0, total: 0 });
  });
});
