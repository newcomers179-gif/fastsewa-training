import { Router } from "express";
import { eq } from "drizzle-orm";
import { quizzes } from "@shared/schema";
import { db } from "../db";
import { notFound } from "../errors";
import { requireAuth } from "../middleware/auth";
import type { Limiters } from "../middleware/rateLimit";
import { getCourseAccess, getModuleContext } from "../services/access";
import { getQuizForLearner, listAttempts, submitQuiz } from "../services/quiz";
import { idParam } from "../utils/params";
import { parse } from "../utils/validate";
import { quizSubmitBody } from "../validators";

export function quizRoutes(l: Limiters): Router {
  const r = Router();
  r.use(requireAuth, l.authenticated);

  // GET /quiz/module/:moduleId — questions without the answers (locked until the module's lessons are done)
  r.get("/module/:moduleId", async (req, res) => {
    res.json(await getQuizForLearner(req.user!, idParam(req, "moduleId", "Module")));
  });

  // POST /quiz/:quizId/submit
  r.post("/:quizId/submit", l.quizSubmit, async (req, res) => {
    const body = parse(quizSubmitBody, req.body);
    res.json(await submitQuiz(req.user!, idParam(req, "quizId", "Quiz"), body.answers));
  });

  // GET /quiz/:quizId/attempts — the learner's own history
  r.get("/:quizId/attempts", async (req, res) => {
    const quizId = idParam(req, "quizId", "Quiz");
    const [quiz] = await db.select({ moduleId: quizzes.moduleId }).from(quizzes).where(eq(quizzes.id, quizId)).limit(1);
    if (!quiz) throw notFound("Quiz");
    const mod = await getModuleContext(quiz.moduleId);
    if (!mod) throw notFound("Quiz");
    await getCourseAccess(req.user!, mod.courseId, "content");
    res.json(await listAttempts(req.user!.id, quizId));
  });

  return r;
}
