import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { certificates, courseEnrollments, courses, lessonProgress, quizAttempts } from "@shared/schema";
import { db, pool } from "../db";
import {
  Api,
  ageHeartbeat,
  completeLesson,
  createCourse,
  createUser,
  newSession,
  resetDatabase,
  shutdown,
  signIn,
  startServer,
  type CourseFixture,
  type Session,
  type TestServer,
} from "./helpers";

let server: TestServer;
let api: Api;

before(async () => {
  await resetDatabase();
  server = await startServer();
  api = server.api;
});
after(async () => {
  await server.close();
  await shutdown();
});

const enroll = (s: Session, courseId: string) => api.post(`/api/v1/courses/${courseId}/enroll`, {}, s.token);
const heartbeat = (s: Session, lessonId: string, extra: Record<string, unknown> = {}) => api.post("/api/v1/progress/lesson", { lessonId, ...extra }, s.token);
const submit = (s: Session, quizId: string, answers: number[]) => api.post(`/api/v1/quiz/${quizId}/submit`, { answers }, s.token);

async function enrolled(fixture: CourseFixture): Promise<Session> {
  const s = await newSession(api);
  assert.ok([200, 201].includes((await enroll(s, fixture.courseId)).status));
  return s;
}

/** Finishes every lesson of a module and passes its quiz. */
async function finishModule(s: Session, fixture: CourseFixture, index: number) {
  const m = fixture.modules[index];
  for (const lessonId of m.lessonIds) {
    const res = await completeLesson(api, s, lessonId);
    assert.equal(res.status, 200, res.text);
  }
  return submit(s, m.quizId!, m.answers);
}

describe("catalogue and access", () => {
  it("lists only published, non-archived courses, with filters and a total count", async () => {
    const worker = await newSession(api);
    const published = await createCourse();
    const draft = await createCourse({ published: false });
    const archived = await createCourse();
    await db.update(courses).set({ archivedAt: new Date() }).where(eq(courses.id, archived.courseId));

    const res = await api.get("/api/v1/courses?limit=100", worker.token);
    assert.equal(res.status, 200);
    const ids = res.body.map((c: { id: string }) => c.id);
    assert.ok(ids.includes(published.courseId));
    assert.ok(!ids.includes(draft.courseId));
    assert.ok(!ids.includes(archived.courseId));
    assert.equal(Number(res.headers.get("x-total-count")), res.body.length);
    assert.equal(res.body.find((c: { id: string }) => c.id === published.courseId).enrolled, false);

    const search = await api.get(`/api/v1/courses?q=${encodeURIComponent(published.slug)}`, worker.token);
    assert.deepEqual(search.body.map((c: { id: string }) => c.id), [published.courseId]);
    assert.equal((await api.get("/api/v1/courses?category=nonsense", worker.token)).status, 400);
    assert.equal((await api.get("/api/v1/courses")).status, 401);
    const wild = await api.get(`/api/v1/courses?q=${encodeURIComponent("%")}`, worker.token);
    assert.equal(wild.body.length, 0, "a % typed in the search box is a literal character, not a wildcard");
  });

  it("shows the structure without lesson content, media links or quiz answers", async () => {
    const worker = await newSession(api);
    const fixture = await createCourse({ videoSeconds: 120 });
    const res = await api.get(`/api/v1/courses/${fixture.courseId}`, worker.token);
    assert.equal(res.status, 200);
    assert.equal(res.body.modules.length, 1);
    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes("youtube"), "no media URL before enrolling");
    assert.ok(!raw.includes("Some text to read"), "no lesson text before enrolling");
    assert.ok(!raw.includes("correctIndex"));
  });

  it("hides drafts and archived courses from learners but lets staff preview them", async () => {
    const draft = await createCourse({ published: false });
    const worker = await newSession(api);
    const trainer = await newSession(api, "trainer");
    assert.equal((await api.get(`/api/v1/courses/${draft.courseId}`, worker.token)).body.code, "COURSE_NOT_AVAILABLE");
    const preview = await api.get(`/api/v1/courses/${draft.courseId}`, trainer.token);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.preview, true);
    assert.equal((await enroll(worker, draft.courseId)).body.code, "COURSE_NOT_AVAILABLE");
    assert.equal((await api.get("/api/v1/courses/00000000-0000-0000-0000-000000000000", worker.token)).status, 404);
    assert.equal((await api.get("/api/v1/courses/not-a-uuid", worker.token)).status, 404, "an id that cannot exist is answered without touching the database");
  });

  it("needs an enrolment to read lessons or open a quiz, and enrolling twice is harmless", async () => {
    const fixture = await createCourse();
    const worker = await newSession(api);
    const lessonId = fixture.modules[0].lessonIds[0];
    assert.equal((await api.get(`/api/v1/courses/lesson/${lessonId}`, worker.token)).body.code, "NOT_ENROLLED");
    assert.equal((await api.get(`/api/v1/courses/module/${fixture.modules[0].id}`, worker.token)).body.code, "NOT_ENROLLED");
    assert.equal((await heartbeat(worker, lessonId)).body.code, "NOT_ENROLLED");
    assert.equal((await api.get(`/api/v1/quiz/module/${fixture.modules[0].id}`, worker.token)).body.code, "NOT_ENROLLED");

    const first = await enroll(worker, fixture.courseId);
    const second = await enroll(worker, fixture.courseId);
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(first.body.id, second.body.id);
    const lesson = await api.get(`/api/v1/courses/lesson/${lessonId}`, worker.token);
    assert.equal(lesson.status, 200);
    assert.equal(lesson.body.content, "Some text to read.");
  });

  it("creates exactly one enrolment when the app fires the request several times at once", async () => {
    const fixture = await createCourse();
    const worker = await newSession(api);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => enroll(worker, fixture.courseId)));
    assert.ok(results.every((r) => r.status === 200 || r.status === 201));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    const rows = await db.select().from(courseEnrollments).where(eq(courseEnrollments.userId, worker.user.id));
    assert.equal(rows.length, 1);
  });
});

describe("lesson progress cannot be faked", () => {
  it("refuses an instant completion and keeps the time that really passed", async () => {
    const fixture = await createCourse();
    const s = await enrolled(fixture);
    const lessonId = fixture.modules[0].lessonIds[0];

    const early = await heartbeat(s, lessonId, { completed: true });
    assert.equal(early.status, 409);
    assert.equal(early.body.code, "VIDEO_NOT_WATCHED");
    assert.equal(early.body.details.requiredSeconds, 5);

    await ageHeartbeat(s.user.id, lessonId, 4);
    const still = await heartbeat(s, lessonId, { completed: true });
    assert.equal(still.body.code, "VIDEO_NOT_WATCHED", "4 s of 5 s");
    assert.equal(still.body.details.watchedSeconds, 4);

    await ageHeartbeat(s.user.id, lessonId, 3);
    const done = await heartbeat(s, lessonId, { completed: true });
    assert.equal(done.status, 200);
    assert.equal(done.body.progress.completed, true);
    assert.ok(done.body.progress.completedAt);
  });

  it("ignores long silences (a paused or backgrounded app) instead of counting them as watching", async () => {
    const fixture = await createCourse();
    const s = await enrolled(fixture);
    const lessonId = fixture.modules[0].lessonIds[0];
    await heartbeat(s, lessonId);
    await ageHeartbeat(s.user.id, lessonId, 600);
    const res = await heartbeat(s, lessonId, { completed: true });
    assert.equal(res.status, 409);
    assert.equal(res.body.details.watchedSeconds, 0);
  });

  it("makes a video count only after 70% of its length, however the time is split into heartbeats", async () => {
    const fixture = await createCourse({ videoSeconds: 100 });
    const s = await enrolled(fixture);
    const video = fixture.modules[0].lessonIds[0];

    await heartbeat(s, video);
    for (let i = 0; i < 2; i++) {
      await ageHeartbeat(s.user.id, video, 20);
      await heartbeat(s, video);
    }
    const tooEarly = await heartbeat(s, video, { completed: true });
    assert.equal(tooEarly.status, 409, "40 s of 70 s");
    assert.equal(tooEarly.body.details.requiredSeconds, 70);
    assert.equal(tooEarly.body.details.remainingSeconds, 30);

    for (let i = 0; i < 2; i++) {
      await ageHeartbeat(s.user.id, video, 20);
      await heartbeat(s, video);
    }
    await ageHeartbeat(s.user.id, video, 10);
    const ok = await heartbeat(s, video, { completed: true });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.progress.watchedSeconds, 90);
  });

  it("never un-completes a lesson, and clamps the resume position to the video length", async () => {
    const fixture = await createCourse({ videoSeconds: 100 });
    const s = await enrolled(fixture);
    const video = fixture.modules[0].lessonIds[0];
    await heartbeat(s, video, { positionSeconds: 5000 });
    const saved = await api.get(`/api/v1/progress/lesson/${video}`, s.token);
    assert.equal(saved.body.videoProgressSeconds, 100);

    const other = fixture.modules[0].lessonIds[1];
    assert.equal((await completeLesson(api, s, other)).status, 200);
    const again = await heartbeat(s, other, { completed: false, positionSeconds: 0 });
    assert.equal(again.body.progress.completed, true);
    const [row] = await db.select().from(lessonProgress).where(and(eq(lessonProgress.userId, s.user.id), eq(lessonProgress.lessonId, other)));
    assert.equal(row.completed, true);
  });

  it("answers bad requests clearly", async () => {
    const fixture = await createCourse();
    const s = await enrolled(fixture);
    assert.equal((await heartbeat(s, "00000000-0000-0000-0000-000000000000")).status, 404);
    assert.equal((await heartbeat(s, "nope")).status, 400);
    assert.equal((await api.post("/api/v1/progress/lesson", {}, s.token)).status, 400);
    assert.equal((await heartbeat(s, fixture.modules[0].lessonIds[0], { positionSeconds: -1 })).status, 400);
    assert.equal((await api.post("/api/v1/progress/lesson", { lessonId: fixture.modules[0].lessonIds[0] })).status, 401);
  });

  it("does not record anything when staff look at a draft course", async () => {
    const draft = await createCourse({ published: false });
    const trainer = await newSession(api, "trainer");
    const res = await heartbeat(trainer, draft.modules[0].lessonIds[0]);
    assert.equal(res.body.code, "COURSE_NOT_AVAILABLE");
    assert.equal((await db.select().from(lessonProgress).where(eq(lessonProgress.userId, trainer.user.id))).length, 0);
  });

  it("keeps two learners' progress apart", async () => {
    const fixture = await createCourse();
    const a = await enrolled(fixture);
    const b = await enrolled(fixture);
    await completeLesson(api, a, fixture.modules[0].lessonIds[0]);
    const progressB = await api.get(`/api/v1/progress/module/${fixture.modules[0].id}`, b.token);
    assert.equal(progressB.body.requiredDone, 0);
    const progressA = await api.get(`/api/v1/progress/module/${fixture.modules[0].id}`, a.token);
    assert.equal(progressA.body.requiredDone, 1);
    const all = await api.get("/api/v1/progress/all-lessons", b.token);
    assert.deepEqual(all.body, []);
  });
});

describe("quizzes", () => {
  it("stay locked until the required lessons are done", async () => {
    const fixture = await createCourse();
    const s = await enrolled(fixture);
    const m = fixture.modules[0];
    assert.equal((await api.get(`/api/v1/quiz/module/${m.id}`, s.token)).body.code, "QUIZ_LOCKED");
    assert.equal((await submit(s, m.quizId!, m.answers)).body.code, "QUIZ_LOCKED");

    await completeLesson(api, s, m.lessonIds[0]);
    assert.equal((await api.get(`/api/v1/quiz/module/${m.id}`, s.token)).body.code, "QUIZ_LOCKED", "one lesson of two");
    await completeLesson(api, s, m.lessonIds[1]);
    const open = await api.get(`/api/v1/quiz/module/${m.id}`, s.token);
    assert.equal(open.status, 200);
    assert.equal(open.body.questions.length, 2);
    assert.ok(!JSON.stringify(open.body).includes("correctIndex"));
    assert.ok(!JSON.stringify(open.body).includes("Because."), "explanations are not sent before the quiz is passed");
  });

  it("show only right/wrong after a failed attempt, and the answers once passed", async () => {
    const fixture = await createCourse();
    const s = await enrolled(fixture);
    const m = fixture.modules[0];
    for (const id of m.lessonIds) await completeLesson(api, s, id);

    const fail = await submit(s, m.quizId!, [1, 1]);
    assert.equal(fail.status, 200);
    assert.equal(fail.body.passed, false);
    assert.equal(fail.body.score, 0);
    assert.ok(fail.body.feedback.every((f: { isCorrect: boolean; correctAnswer?: number; explanation?: string }) => !f.isCorrect && f.correctAnswer === undefined && f.explanation === undefined));
    assert.equal(fail.body.newCertificate, null);

    const half = await submit(s, m.quizId!, [0, 1]);
    assert.equal(half.body.score, 50);
    assert.equal(half.body.passed, false, "pass mark is 70");

    const pass = await submit(s, m.quizId!, [0, 0]);
    assert.equal(pass.body.passed, true);
    assert.equal(pass.body.feedback[0].correctAnswer, 0);
    assert.equal(pass.body.feedback[0].explanation, "Because.");
    assert.equal(pass.body.attemptsToday, 3);
    assert.equal(pass.body.attemptsRemaining, 7);
  });

  it("validate the answers against the real questions", async () => {
    const fixture = await createCourse();
    const s = await enrolled(fixture);
    const m = fixture.modules[0];
    for (const id of m.lessonIds) await completeLesson(api, s, id);
    assert.equal((await submit(s, m.quizId!, [0])).body.code, "QUIZ_ANSWERS_INVALID");
    assert.equal((await submit(s, m.quizId!, [0, 0, 0])).body.code, "QUIZ_ANSWERS_INVALID");
    assert.equal((await submit(s, m.quizId!, [0, 3])).body.code, "QUIZ_ANSWERS_INVALID", "option 3 does not exist (3 options: 0..2)");
    assert.equal((await submit(s, m.quizId!, [])).status, 400);
    assert.equal((await submit(s, m.quizId!, [-1, 0])).status, 400);
    assert.equal((await api.post(`/api/v1/quiz/${m.quizId}/submit`, { answers: "0,0" }, s.token)).status, 400);
    assert.equal((await db.select().from(quizAttempts).where(eq(quizAttempts.userId, s.user.id))).length, 0, "invalid submissions do not use up attempts");
  });

  it("never lose a pass: a later bad attempt does not lower the best score or un-pass the module", async () => {
    const fixture = await createCourse();
    const s = await enrolled(fixture);
    const m = fixture.modules[0];
    for (const id of m.lessonIds) await completeLesson(api, s, id);
    assert.equal((await submit(s, m.quizId!, m.answers)).body.passed, true);
    assert.equal((await submit(s, m.quizId!, [1, 1])).body.passed, false);
    const progress = await api.get(`/api/v1/progress/module/${m.id}`, s.token);
    assert.equal(progress.body.quizPassed, true);
    assert.equal(progress.body.completed, true);
    const attempts = await api.get(`/api/v1/quiz/${m.quizId}/attempts`, s.token);
    assert.equal(attempts.body.length, 2);
  });

  it("allow ten attempts in 24 hours, then say when to come back", async () => {
    const fixture = await createCourse();
    const s = await enrolled(fixture);
    const m = fixture.modules[0];
    for (const id of m.lessonIds) await completeLesson(api, s, id);
    for (let i = 0; i < 10; i++) assert.equal((await submit(s, m.quizId!, [1, 1])).status, 200, `attempt ${i + 1}`);
    const blocked = await submit(s, m.quizId!, m.answers);
    assert.equal(blocked.body.code, "QUIZ_ATTEMPTS_EXCEEDED");
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.ok(blocked.body.details.retryAt);
    const status = (await api.get(`/api/v1/quiz/module/${m.id}`, s.token)).body.status;
    assert.equal(status.attemptsToday, 10);
    assert.ok(status.nextAttemptAt);

    await pool.query(`UPDATE quiz_attempts SET attempted_at = now() - interval '25 hours' WHERE user_id = $1`, [s.user.id]);
    assert.equal((await submit(s, m.quizId!, m.answers)).status, 200, "the window is rolling");
  });

  it("cannot be raced past the attempt limit", async () => {
    const fixture = await createCourse();
    const s = await enrolled(fixture);
    const m = fixture.modules[0];
    for (const id of m.lessonIds) await completeLesson(api, s, id);
    const results = await Promise.all(Array.from({ length: 16 }, () => submit(s, m.quizId!, [1, 1])));
    assert.equal(results.filter((r) => r.status === 200).length, 10);
    assert.equal(results.filter((r) => r.body.code === "QUIZ_ATTEMPTS_EXCEEDED").length, 6);
  });
});

describe("course completion and certificates", () => {
  it("completes a course only when every module is done, issuing exactly one certificate", async () => {
    const fixture = await createCourse({ modules: 2 });
    const s = await enrolled(fixture);

    const first = await finishModule(s, fixture, 0);
    assert.equal(first.body.passed, true);
    assert.deepEqual(first.body.course, { percent: 50, completed: false });
    assert.equal(first.body.newCertificate, null);

    const second = await finishModule(s, fixture, 1);
    assert.deepEqual(second.body.course, { percent: 100, completed: true });
    assert.match(second.body.newCertificate.certificateNumber, /^FSWA-/);

    const retry = await submit(s, fixture.modules[1].quizId!, fixture.modules[1].answers);
    assert.equal(retry.body.newCertificate, null, "a second pass does not issue a second certificate");
    const rows = await db.select().from(certificates).where(and(eq(certificates.userId, s.user.id), eq(certificates.courseId, fixture.courseId)));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].issuedCourseTitle, `Course ${fixture.slug}`);

    const [enrollment] = await db.select().from(courseEnrollments).where(eq(courseEnrollments.userId, s.user.id));
    assert.equal(enrollment.completionPercent, 100);
    assert.ok(enrollment.completedAt);
  });

  it("issues one certificate even when completion requests arrive together", async () => {
    const fixture = await createCourse({ modules: 1 });
    const s = await enrolled(fixture);
    const m = fixture.modules[0];
    for (const id of m.lessonIds) await completeLesson(api, s, id);
    const results = await Promise.all(Array.from({ length: 6 }, () => submit(s, m.quizId!, m.answers)));
    assert.ok(results.every((r) => r.status === 200));
    assert.equal(results.filter((r) => r.body.newCertificate).length, 1);
    assert.equal((await db.select().from(certificates).where(eq(certificates.userId, s.user.id))).length, 1);
  });

  it("freezes the learner's name and the course title on the certificate", async () => {
    const fixture = await createCourse({ modules: 1 });
    const user = await createUser({ displayName: "Ramesh Kumar" });
    const s = await signIn(api, user);
    await enroll(s, fixture.courseId);
    const res = await finishModule(s, fixture, 0);
    await db.update(courses).set({ title: "Renamed later" }).where(eq(courses.id, fixture.courseId));
    await api.patch("/api/v1/auth/me", { displayName: "Someone Else" }, s.token);
    const verify = await api.get(`/api/v1/verify/${res.body.newCertificate.certificateNumber}`);
    assert.equal(verify.body.holderName, "Ramesh Kumar");
    assert.equal(verify.body.courseTitle, `Course ${fixture.slug}`);
  });

  it("is listed, downloadable as a PDF by its owner only, and can be shared through a short-lived signed link", async () => {
    const fixture = await createCourse({ modules: 1 });
    const owner = await enrolled(fixture);
    const outsider = await newSession(api);
    const { newCertificate } = (await finishModule(owner, fixture, 0)).body;

    const list = await api.get("/api/v1/certificates", owner.token);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].certificateNumber, newCertificate.certificateNumber);
    assert.equal((await api.get("/api/v1/certificates", outsider.token)).body.length, 0);

    const pdf = await api.download(`/api/v1/certificates/${newCertificate.id}/pdf`, owner.token);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.match(pdf.headers.get("content-disposition") ?? "", /attachment; filename="certificate-FSWA-/);
    assert.equal(pdf.bytes.subarray(0, 5).toString(), "%PDF-");

    assert.equal((await api.download(`/api/v1/certificates/${newCertificate.id}/pdf`, outsider.token)).status, 404, "someone else's certificate does not exist for you");
    assert.equal((await api.download(`/api/v1/certificates/${newCertificate.id}/pdf`)).status, 401);

    const link = await api.get(`/api/v1/certificates/${newCertificate.id}/download-link`, owner.token);
    assert.equal(link.status, 200);
    const path = new URL(link.body.url).pathname + new URL(link.body.url).search;
    assert.equal((await api.download(path)).status, 200, "the signed link works without a token");
    assert.equal((await api.download(path.replace(/sig=[0-9a-f]/, "sig=0"))).status, 401, "a tampered signature is refused");
    assert.equal((await api.get(`/api/v1/certificates/${newCertificate.id}/download-link`, outsider.token)).status, 404);
  });

  it("is verifiable by anyone with the number, and stops verifying once revoked", async () => {
    const fixture = await createCourse({ modules: 1 });
    const s = await enrolled(fixture);
    const { newCertificate } = (await finishModule(s, fixture, 0)).body;
    const number = newCertificate.certificateNumber as string;

    const ok = await api.get(`/api/v1/verify/${number.toLowerCase()}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.valid, true);
    assert.equal(ok.body.status, "valid");
    assert.ok(!JSON.stringify(ok.body).includes(s.user.username), "the public answer carries the name, never the username or contact details");

    const page = await api.get(`/verify/${number}`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    assert.match(page.text, /Valid certificate/);
    assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'none'/);

    await db.update(certificates).set({ revokedAt: new Date(), revokedReason: "issued in error" }).where(eq(certificates.id, newCertificate.id));
    const revoked = await api.get(`/api/v1/verify/${number}`);
    assert.equal(revoked.body.valid, false);
    assert.equal(revoked.body.status, "revoked");
    assert.ok(!JSON.stringify(revoked.body).includes("issued in error"), "the reason stays private");
    assert.equal((await api.get("/api/v1/certificates", s.token)).body.every((c: { revoked: boolean }) => c.revoked), true);
    assert.equal((await api.download(`/api/v1/certificates/${newCertificate.id}/pdf`, s.token)).status, 404);

    assert.equal((await api.get("/api/v1/verify/FSWA-AAAA-BBBB-CCCC")).status, 404);
    assert.equal((await api.get("/api/v1/verify/not-a-number")).status, 404);
    assert.equal((await api.get("/verify/not-a-number")).status, 404);
  });

  it("is escaped on the verification page (a name is untrusted text)", async () => {
    const fixture = await createCourse({ modules: 1 });
    const user = await createUser({ displayName: "Mallory" });
    const s = await signIn(api, user);
    await enroll(s, fixture.courseId);
    const { newCertificate } = (await finishModule(s, fixture, 0)).body;
    await db.update(certificates).set({ issuedName: '<img src=x onerror=alert(1)>"' }).where(eq(certificates.id, newCertificate.id));
    const page = await api.get(`/verify/${newCertificate.certificateNumber}`);
    assert.ok(!page.text.includes("<img src=x"), "HTML in a name must be escaped");
    assert.match(page.text, /&lt;img/);
  });
});

describe("progress summaries", () => {
  it("add up across the app screens", async () => {
    const fixture = await createCourse({ modules: 2 });
    const s = await enrolled(fixture);
    await finishModule(s, fixture, 0);

    const stats = await api.get("/api/v1/progress/stats", s.token);
    assert.equal(stats.body.coursesEnrolled, 1);
    assert.equal(stats.body.modulesCompleted, 1);
    assert.equal(stats.body.lessonsCompleted, 2);
    assert.equal(stats.body.coursesCompleted, 0);

    const list = await api.get("/api/v1/progress/enrolled-courses", s.token);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].completionPercent, 50);
    assert.equal(list.body[0].modules.length, 2);
    assert.equal(list.body[0].modules[0].lessons.every((l: { completed: boolean }) => l.completed), true);
    assert.ok(!JSON.stringify(list.body).includes("Some text to read"), "ticks only, no lesson bodies");

    const course = await api.get(`/api/v1/progress/course/${fixture.courseId}`, s.token);
    assert.equal(course.body.enrollment.completionPercent, 50);
    assert.equal(course.body.modules.filter((m: { completed: boolean }) => m.completed).length, 1);
    const stranger = await newSession(api);
    assert.equal((await api.get(`/api/v1/progress/course/${fixture.courseId}`, stranger.token)).body.code, "NOT_ENROLLED");
  });
});

describe("a course whose content changes after someone finished it", () => {
  it("does not take a completed module or certificate away", async () => {
    const fixture = await createCourse({ modules: 1 });
    const s = await enrolled(fixture);
    await finishModule(s, fixture, 0);
    const admin = await newSession(api, "admin");
    const created = await api.post(`/api/v1/admin/modules/${fixture.modules[0].id}/lessons`, { title: "A new lesson", contentType: "text", content: "Added later." }, admin.token);
    assert.equal(created.status, 201);
    await new Promise((r) => setTimeout(r, 300)); // the recompute runs in the background

    const progress = await api.get(`/api/v1/progress/module/${fixture.modules[0].id}`, s.token);
    assert.equal(progress.body.completed, true, "monotonic: a finished module stays finished");
    const list = await api.get("/api/v1/progress/enrolled-courses", s.token);
    assert.equal(list.body[0].completionPercent, 100);
    assert.equal((await api.get("/api/v1/certificates", s.token)).body.length, 1);
  });
});
