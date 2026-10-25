/**
 * Quiz rules.
 *
 *  - A quiz unlocks once the module's required lessons are done.
 *  - At most QUIZ_MAX_ATTEMPTS_PER_DAY attempts per quiz in any rolling 24 h.
 *  - Answers are validated against the real number of options of each question.
 *  - A failed attempt only reveals which answers were wrong; the correct
 *    answers and explanations are shown once the quiz is passed. (The old API
 *    returned every correct answer on every attempt, so a learner could pass
 *    by looking the answers up after one wrong try.)
 *  - Best score / passed never go backwards.
 */
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { moduleProgress, quizAttempts, quizQuestions, quizzes, modules, type Role } from "@shared/schema";
import { db, type DbOrTx } from "../db";
import { err, notFound } from "../errors";
import { getCourseAccess, getModuleContext } from "./access";
import { evaluateModule, getModuleState, recomputeCourseProgress, toIssuedCertificate, type IssuedCertificate } from "./progress";

export const QUIZ_MAX_ATTEMPTS_PER_DAY = 10;

export interface QuizStatus {
  locked: boolean;
  passed: boolean;
  bestScore: number | null;
  attemptsToday: number;
  maxAttempts: number;
  /** When the attempt allowance is used up: the moment the oldest attempt leaves the 24 h window. */
  nextAttemptAt: Date | null;
}

async function attemptWindow(dbc: DbOrTx, userId: string, quizId: string) {
  const [row] = await dbc
    .select({
      count: sql<number>`count(*)::int`,
      oldest: sql<Date | null>`min(${quizAttempts.attemptedAt})`,
    })
    .from(quizAttempts)
    .where(
      and(
        eq(quizAttempts.userId, userId),
        eq(quizAttempts.quizId, quizId),
        gt(quizAttempts.attemptedAt, sql`now() - interval '24 hours'`)
      )
    );
  return { count: row?.count ?? 0, oldest: row?.oldest ? new Date(row.oldest) : null };
}

export async function getQuizStatus(dbc: DbOrTx, userId: string, quizId: string, moduleId: string): Promise<QuizStatus> {
  const [state, window, [mp]] = await Promise.all([
    getModuleState(dbc, userId, moduleId),
    attemptWindow(dbc, userId, quizId),
    dbc
      .select({ quizScore: moduleProgress.quizScore, quizPassed: moduleProgress.quizPassed })
      .from(moduleProgress)
      .where(and(eq(moduleProgress.userId, userId), eq(moduleProgress.moduleId, moduleId)))
      .limit(1),
  ]);
  const exhausted = window.count >= QUIZ_MAX_ATTEMPTS_PER_DAY;
  return {
    locked: state ? !evaluateModule(state).lessonsDone : false,
    passed: mp?.quizPassed ?? false,
    bestScore: mp?.quizScore ?? null,
    attemptsToday: window.count,
    maxAttempts: QUIZ_MAX_ATTEMPTS_PER_DAY,
    nextAttemptAt: exhausted && window.oldest ? new Date(window.oldest.getTime() + 24 * 3600_000) : null,
  };
}

async function loadQuizByModule(moduleId: string, dbc: DbOrTx = db) {
  const [quiz] = await dbc.select().from(quizzes).where(eq(quizzes.moduleId, moduleId)).limit(1);
  return quiz ?? null;
}

// ─── Learner ─────────────────────────────────────────────────────────────────
export async function getQuizForLearner(user: { id: string; role: Role }, moduleId: string) {
  const mod = await getModuleContext(moduleId);
  if (!mod) throw notFound("Module");
  await getCourseAccess(user, mod.courseId, "content");
  const quiz = await loadQuizByModule(moduleId);
  if (!quiz) throw notFound("Quiz");

  const status = await getQuizStatus(db, user.id, quiz.id, moduleId);
  if (status.locked && user.role === "worker") {
    throw err("QUIZ_LOCKED");
  }

  const questions = await db
    .select({
      id: quizQuestions.id,
      question: quizQuestions.question,
      questionHi: quizQuestions.questionHi,
      options: quizQuestions.options,
      optionsHi: quizQuestions.optionsHi,
      sortOrder: quizQuestions.sortOrder,
      // correctIndex and explanations are never sent before the quiz is passed
    })
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quiz.id))
    .orderBy(asc(quizQuestions.sortOrder), asc(quizQuestions.id));

  return {
    quiz: { id: quiz.id, title: quiz.title, passingScore: quiz.passingScore, moduleId },
    questions,
    status,
  };
}

export interface SubmitResult {
  score: number;
  passed: boolean;
  passingScore: number;
  correctCount: number;
  totalQuestions: number;
  feedback: {
    questionId: string;
    yourAnswer: number;
    isCorrect: boolean;
    correctAnswer?: number;
    explanation?: string | null;
    explanationHi?: string | null;
  }[];
  attemptsToday: number;
  attemptsRemaining: number;
  course: { percent: number; completed: boolean } | null;
  newCertificate: IssuedCertificate | null;
}

export async function submitQuiz(user: { id: string; role: Role }, quizId: string, answers: number[]): Promise<SubmitResult> {
  const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, quizId)).limit(1);
  if (!quiz) throw notFound("Quiz");
  const mod = await getModuleContext(quiz.moduleId);
  if (!mod) throw notFound("Module");
  await getCourseAccess(user, mod.courseId, "learn");

  const state = await getModuleState(db, user.id, mod.id);
  if (state && !evaluateModule(state).lessonsDone) throw err("QUIZ_LOCKED");

  const questions = await db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quiz.id))
    .orderBy(asc(quizQuestions.sortOrder), asc(quizQuestions.id));
  if (questions.length === 0) throw err("QUIZ_ANSWERS_INVALID", { message: "This quiz has no questions yet" });
  if (answers.length !== questions.length) {
    throw err("QUIZ_ANSWERS_INVALID", { details: { expected: questions.length, received: answers.length } });
  }
  answers.forEach((a, i) => {
    if (a >= questions[i].options.length) {
      throw err("QUIZ_ANSWERS_INVALID", { details: { question: i, optionCount: questions[i].options.length } });
    }
  });

  let correctCount = 0;
  questions.forEach((q, i) => {
    if (answers[i] === q.correctIndex) correctCount++;
  });
  const score = Math.round((correctCount / questions.length) * 100);
  const passed = score >= quiz.passingScore;

  const outcome = await db.transaction(async (tx) => {
    // One submission at a time per learner+quiz, so the attempt limit cannot be raced.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${user.id}:${quiz.id}`}, 0))`);
    const window = await attemptWindow(tx, user.id, quiz.id);
    if (window.count >= QUIZ_MAX_ATTEMPTS_PER_DAY) {
      const retryAt = window.oldest ? new Date(window.oldest.getTime() + 24 * 3600_000) : null;
      const secs = retryAt ? Math.max(1, Math.ceil((retryAt.getTime() - Date.now()) / 1000)) : 3600;
      throw err("QUIZ_ATTEMPTS_EXCEEDED", {
        details: { retryAt: retryAt?.toISOString() ?? null, retryAfterSeconds: secs },
        headers: { "Retry-After": String(secs) },
      });
    }

    await tx.insert(quizAttempts).values({ userId: user.id, quizId: quiz.id, answers, score, passed });
    await tx
      .insert(moduleProgress)
      .values({ userId: user.id, moduleId: mod.id, quizScore: score, quizPassed: passed })
      .onConflictDoUpdate({
        target: [moduleProgress.userId, moduleProgress.moduleId],
        set: {
          quizScore: sql`GREATEST(COALESCE(${moduleProgress.quizScore}, 0), ${score})`,
          quizPassed: sql`COALESCE(${moduleProgress.quizPassed}, false) OR ${passed}`,
        },
      });

    const course = passed ? await recomputeCourseProgress(tx, user.id, mod.courseId) : null;
    return { course, attemptsToday: window.count + 1 };
  });

  return {
    score,
    passed,
    passingScore: quiz.passingScore,
    correctCount,
    totalQuestions: questions.length,
    feedback: questions.map((q, i) => {
      const isCorrect = answers[i] === q.correctIndex;
      return passed
        ? {
            questionId: q.id,
            yourAnswer: answers[i],
            isCorrect,
            correctAnswer: q.correctIndex,
            explanation: q.explanation,
            explanationHi: q.explanationHi,
          }
        : { questionId: q.id, yourAnswer: answers[i], isCorrect };
    }),
    attemptsToday: outcome.attemptsToday,
    attemptsRemaining: Math.max(0, QUIZ_MAX_ATTEMPTS_PER_DAY - outcome.attemptsToday),
    course: outcome.course ? { percent: outcome.course.percent, completed: outcome.course.completed } : null,
    newCertificate: toIssuedCertificate(outcome.course?.newCertificate),
  };
}

export async function listAttempts(userId: string, quizId: string) {
  return db
    .select({
      id: quizAttempts.id,
      score: quizAttempts.score,
      passed: quizAttempts.passed,
      attemptedAt: quizAttempts.attemptedAt,
    })
    .from(quizAttempts)
    .where(and(eq(quizAttempts.userId, userId), eq(quizAttempts.quizId, quizId)))
    .orderBy(desc(quizAttempts.attemptedAt))
    .limit(50);
}

// ─── Admin ───────────────────────────────────────────────────────────────────
export interface QuizInput {
  title: string;
  passingScore: number;
  questions: {
    question: string;
    questionHi?: string | null;
    options: string[];
    optionsHi?: string[] | null;
    correctIndex: number;
    explanation?: string | null;
    explanationHi?: string | null;
  }[];
}

export async function getQuizForAdmin(moduleId: string) {
  const quiz = await loadQuizByModule(moduleId);
  if (!quiz) return null;
  const questions = await db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quiz.id))
    .orderBy(asc(quizQuestions.sortOrder), asc(quizQuestions.id));
  return { ...quiz, questions };
}

/** Creates the module's quiz or replaces its title, pass mark and questions. */
export async function upsertQuiz(moduleId: string, input: QuizInput) {
  const [mod] = await db.select({ id: modules.id }).from(modules).where(eq(modules.id, moduleId)).limit(1);
  if (!mod) throw notFound("Module");

  await db.transaction(async (tx) => {
    let [quiz] = await tx.select().from(quizzes).where(eq(quizzes.moduleId, moduleId)).for("update").limit(1);
    if (quiz) {
      [quiz] = await tx
        .update(quizzes)
        .set({ title: input.title, passingScore: input.passingScore })
        .where(eq(quizzes.id, quiz.id))
        .returning();
      await tx.delete(quizQuestions).where(eq(quizQuestions.quizId, quiz.id));
    } else {
      [quiz] = await tx
        .insert(quizzes)
        .values({ moduleId, title: input.title, passingScore: input.passingScore })
        .returning();
    }
    await tx.insert(quizQuestions).values(
      input.questions.map((q, i) => ({
        quizId: quiz.id,
        question: q.question,
        questionHi: q.questionHi ?? null,
        options: q.options,
        optionsHi: q.optionsHi ?? null,
        correctIndex: q.correctIndex,
        explanation: q.explanation ?? null,
        explanationHi: q.explanationHi ?? null,
        sortOrder: i,
      }))
    );
  });
  return getQuizForAdmin(moduleId);
}

export async function deleteQuiz(moduleId: string): Promise<boolean> {
  const quiz = await loadQuizByModule(moduleId);
  if (!quiz) return false;
  const [attempt] = await db.select({ id: quizAttempts.id }).from(quizAttempts).where(eq(quizAttempts.quizId, quiz.id)).limit(1);
  if (attempt) throw err("COURSE_HAS_RECORDS", { message: "Learners have already taken this quiz. Edit it instead of deleting it." });
  await db.delete(quizzes).where(eq(quizzes.id, quiz.id));
  return true;
}
