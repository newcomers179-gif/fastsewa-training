/**
 * The mobile app's idea of the API, held against the real server.
 *
 * client/src/types/api.ts says what the app expects every answer to look like. Here each answer is
 * produced by the real Express app on a real database and compared field by field, so the two sides
 * cannot drift apart unnoticed: a renamed field, a missing key or a leaked internal column fails this
 * test instead of showing up as a blank screen on a phone. The checks are written as
 * `Spec<TheClientType>`, so adding a field to a type without adding it here is a compile error.
 *
 * The last section runs the app's own HTTP client (token refresh included) against the server.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ACCESS_TOKEN_KEY, ApiError, REFRESH_TOKEN_KEY, createApiClient, createTokenStore } from "../../client/src/lib/apiClient";
import type {
  AppConfig,
  AuthResult,
  AuthUser,
  CertificateIssued,
  CertificateItem,
  CourseListItem,
  CourseOutline,
  DownloadLink,
  EnrolledCourse,
  EnrollmentView,
  LessonDetail,
  LessonOutline,
  LessonProgressView,
  ModuleDetail,
  ModuleOutline,
  QuizData,
  QuizFeedback,
  QuizQuestion,
  QuizResult,
  QuizStatus,
  RecordResult,
  Stats,
  TaskLesson,
  TaskModule,
} from "../../client/src/types/api";
import { CATEGORIES, CONTENT_TYPES, DIFFICULTIES, LANGS, ROLES } from "@shared/constants";
import { ERROR_CODES } from "@shared/errors";
import { Api, STRONG_PASSWORD, createCourse, createUser, completeLesson, newSession, resetDatabase, shutdown, signIn, startServer, uniq, type TestServer } from "./helpers";

// ─── a tiny runtime shape checker whose specs are tied to the TypeScript types ─────────────────
type Check = ((value: unknown, path: string, problems: string[]) => void) & { optional?: true };
type Spec<T> = { [K in keyof T]-?: Check };

const describeValue = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const str: Check = (v, p, e) => void (typeof v !== "string" && e.push(`${p}: expected string, got ${describeValue(v)}`));
const num: Check = (v, p, e) => void ((typeof v !== "number" || !Number.isFinite(v)) && e.push(`${p}: expected number, got ${describeValue(v)}`));
const int: Check = (v, p, e) => void (!Number.isInteger(v) && e.push(`${p}: expected integer, got ${JSON.stringify(v)}`));
const bool: Check = (v, p, e) => void (typeof v !== "boolean" && e.push(`${p}: expected boolean, got ${describeValue(v)}`));
const iso: Check = (v, p, e) => void ((typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(v) || Number.isNaN(Date.parse(v))) && e.push(`${p}: expected an ISO date, got ${JSON.stringify(v)}`));
const nullable = (inner: Check): Check => (v, p, e) => void (v !== null && inner(v, p, e));
const optional = (inner: Check): Check => Object.assign((v: unknown, p: string, e: string[]) => void (v !== undefined && inner(v, p, e)), { optional: true as const });
const oneOf =
  (...allowed: readonly (string | number)[]): Check =>
  (v, p, e) =>
    void (!allowed.includes(v as string) && e.push(`${p}: ${JSON.stringify(v)} is not one of ${allowed.join("|")}`));
const arrayOf =
  (inner: Check): Check =>
  (v, p, e) => {
    if (!Array.isArray(v)) return void e.push(`${p}: expected array, got ${describeValue(v)}`);
    v.forEach((item, i) => inner(item, `${p}[${i}]`, e));
  };
function obj<T>(spec: Spec<T>): Check {
  return (v, p, e) => {
    if (!isRecord(v)) return void e.push(`${p}: expected object, got ${describeValue(v)}`);
    for (const [key, check] of Object.entries<Check>(spec as Record<string, Check>)) {
      if (!(key in v) && !check.optional) e.push(`${p}.${key}: missing from the server's answer`);
      else check(v[key], `${p}.${key}`, e);
    }
    for (const key of Object.keys(v)) if (!(key in (spec as object))) e.push(`${p}.${key}: sent by the server but not in the app's type`);
  };
}
function expectShape(check: Check, value: unknown, label: string): void {
  const problems: string[] = [];
  check(value, label, problems);
  assert.deepEqual(problems, [], `${label} does not match what the app expects`);
}

// ─── the specs (one per type in client/src/types/api.ts) ──────────────────────────────────────
const authUser = obj<AuthUser>({
  id: str,
  username: str,
  displayName: str,
  role: oneOf(...ROLES),
  preferredLang: oneOf(...LANGS),
  avatarUrl: nullable(str),
  email: nullable(str),
  phoneNumber: nullable(str),
  mustChangePassword: bool,
  createdAt: iso,
});
const authResult = obj<AuthResult>({ user: authUser, accessToken: str, refreshToken: str, expiresIn: int });
const appConfig = obj<AppConfig>({
  apiVersion: int,
  registrationMode: oneOf("open", "code", "closed"),
  registrationCodeRequired: bool,
  passwordResetByEmail: bool,
  consentVersion: str,
  privacyPolicyUrl: nullable(str),
  termsUrl: nullable(str),
  supportEmail: nullable(str),
  supportPhone: nullable(str),
  serverTime: iso,
});
const courseBase = {
  id: str,
  slug: str,
  title: str,
  titleHi: nullable(str),
  description: str,
  descriptionHi: nullable(str),
  category: oneOf(...CATEGORIES),
  difficulty: oneOf(...DIFFICULTIES),
  thumbnailUrl: nullable(str),
  durationMinutes: int,
  isPublished: bool,
  archivedAt: nullable(iso),
};
const courseListItem = obj<CourseListItem>({ ...courseBase, moduleCount: int, lessonCount: int, enrolled: bool, completionPercent: num, completedAt: nullable(iso) });
const lessonOutline = obj<LessonOutline>({
  id: str,
  moduleId: str,
  title: str,
  titleHi: nullable(str),
  contentType: oneOf(...CONTENT_TYPES),
  videoDurationSeconds: nullable(int),
  sortOrder: int,
  isRequired: bool,
  completed: bool,
});
const moduleOutline = obj<ModuleOutline>({
  id: str,
  title: str,
  titleHi: nullable(str),
  description: nullable(str),
  descriptionHi: nullable(str),
  sortOrder: int,
  hasQuiz: bool,
  quizPassed: bool,
  completed: bool,
  lessons: arrayOf(lessonOutline),
});
const enrollmentView = obj<EnrollmentView>({ id: str, enrolledAt: iso, completedAt: nullable(iso), completionPercent: num });
const courseOutline = obj<CourseOutline>({ ...courseBase, preview: bool, enrollment: nullable(enrollmentView), modules: arrayOf(moduleOutline) });
const quizStatusFields = { locked: bool, passed: bool, bestScore: nullable(num), attemptsToday: int, maxAttempts: int, nextAttemptAt: nullable(iso) };
const quizStatus = obj<QuizStatus>(quizStatusFields);
const moduleDetail = obj<ModuleDetail>({
  id: str,
  courseId: str,
  title: str,
  titleHi: nullable(str),
  description: nullable(str),
  descriptionHi: nullable(str),
  sortOrder: int,
  lessons: arrayOf(lessonOutline),
  progress: nullable(obj<NonNullable<ModuleDetail["progress"]>>({ requiredLessons: int, requiredDone: int, lessonsDone: bool, completed: bool })),
  quiz: nullable(obj<NonNullable<ModuleDetail["quiz"]>>({ id: str, title: str, passingScore: int, ...quizStatusFields })),
});
const lessonProgress = obj<LessonProgressView>({
  lessonId: str,
  completed: bool,
  videoProgressSeconds: num,
  watchedSeconds: num,
  requiredSeconds: num,
  canComplete: bool,
  completedAt: nullable(iso),
});
const lessonDetail = obj<LessonDetail>({
  id: str,
  moduleId: str,
  courseId: str,
  title: str,
  titleHi: nullable(str),
  contentType: oneOf(...CONTENT_TYPES),
  videoUrl: nullable(str),
  videoProvider: nullable(oneOf("youtube", "cloudinary", "s3", "local", "external")),
  videoDurationSeconds: nullable(int),
  content: nullable(str),
  contentHi: nullable(str),
  imageUrl: nullable(str),
  sortOrder: int,
  isRequired: bool,
  progress: lessonProgress,
});
const certificateIssued = obj<CertificateIssued>({ id: str, certificateNumber: str, courseId: str, earnedAt: iso });
const courseProgress = nullable(obj<NonNullable<RecordResult["course"]>>({ percent: num, completed: bool }));
const recordResult = obj<RecordResult>({ progress: lessonProgress, course: courseProgress, newCertificate: nullable(certificateIssued) });
const taskLesson = obj<TaskLesson>({ id: str, moduleId: str, title: str, titleHi: nullable(str), contentType: oneOf(...CONTENT_TYPES), sortOrder: int, isRequired: bool, completed: bool });
const taskModule = obj<TaskModule>({ id: str, title: str, titleHi: nullable(str), sortOrder: int, lessons: arrayOf(taskLesson) });
const enrolledCourse = obj<EnrolledCourse>({ id: str, title: str, titleHi: nullable(str), category: oneOf(...CATEGORIES), completionPercent: num, completedAt: nullable(iso), modules: arrayOf(taskModule) });
const stats = obj<Stats>({ modulesCompleted: int, lessonsCompleted: int, certificatesEarned: int, coursesEnrolled: int, coursesCompleted: int, learningMinutes: num });
const quizQuestion = obj<QuizQuestion>({ id: str, question: str, questionHi: nullable(str), options: arrayOf(str), optionsHi: nullable(arrayOf(str)), sortOrder: int });
const quizData = obj<QuizData>({
  quiz: obj<QuizData["quiz"]>({ id: str, title: str, passingScore: int, moduleId: str }),
  questions: arrayOf(quizQuestion),
  status: quizStatus,
});
const quizFeedback = obj<QuizFeedback>({ questionId: str, yourAnswer: int, isCorrect: bool, correctAnswer: optional(int), explanation: optional(nullable(str)), explanationHi: optional(nullable(str)) });
const quizResult = obj<QuizResult>({
  score: num,
  passed: bool,
  passingScore: int,
  correctCount: int,
  totalQuestions: int,
  feedback: arrayOf(quizFeedback),
  attemptsToday: int,
  attemptsRemaining: int,
  course: courseProgress,
  newCertificate: nullable(certificateIssued),
});
const certificateItem = obj<CertificateItem>({
  id: str,
  certificateNumber: str,
  earnedAt: iso,
  revoked: bool,
  courseId: str,
  courseTitle: str,
  courseTitleHi: nullable(str),
  courseCategory: oneOf(...CATEGORIES),
});
const downloadLink = obj<DownloadLink>({ url: str, expiresAt: iso });

// ─── the flows ────────────────────────────────────────────────────────────────────────────────
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

const V1 = "/api/v1";

describe("the app's types match what the server sends", () => {
  it("GET /config (no sign-in needed)", async () => {
    const res = await api.get(`${V1}/config`);
    assert.equal(res.status, 200);
    expectShape(appConfig, res.body, "config");
  });

  it("registration, sign-in, profile and the refresh pair", async () => {
    const username = uniq("reg");
    const register = await api.post(`${V1}/auth/register`, {
      username,
      password: STRONG_PASSWORD,
      displayName: "Priya Sharma",
      acceptTerms: true,
      confirmAdult: true,
      preferredLang: "hi",
    });
    assert.equal(register.status, 201, register.text);
    expectShape(authResult, register.body, "register");
    assert.equal(register.body.user.preferredLang, "hi");

    const login = await api.post(`${V1}/auth/login`, { username, password: STRONG_PASSWORD });
    assert.equal(login.status, 200);
    expectShape(authResult, login.body, "login");

    const me = await api.get(`${V1}/auth/me`, login.body.accessToken);
    expectShape(authUser, me.body, "me");

    const patched = await api.patch(`${V1}/auth/me`, { displayName: "Priya Verma", phoneNumber: "98765 43210", email: `${username}@example.org`, preferredLang: "en" }, login.body.accessToken);
    assert.equal(patched.status, 200, patched.text);
    expectShape(authUser, patched.body, "PATCH me");
    assert.equal(patched.body.phoneNumber, "+919876543210");

    const refreshed = await api.post(`${V1}/auth/refresh`, { refreshToken: login.body.refreshToken });
    assert.equal(refreshed.status, 200);
    assert.equal(typeof refreshed.body.accessToken, "string");
    assert.equal(typeof refreshed.body.refreshToken, "string");

    const exported = await api.get(`${V1}/auth/me/export`, refreshed.body.accessToken);
    assert.equal(exported.status, 200);
    assert.ok(isRecord(exported.body), "the data export is a JSON object the app can show as text");
  });

  it("never leaks internals in the user object", async () => {
    const worker = await newSession(api);
    const me = await api.get(`${V1}/auth/me`, worker.token);
    for (const secret of ["passwordHash", "password_hash", "tokenVersion", "token_version", "consentVersion", "failedLoginCount"]) assert.ok(!(secret in me.body), secret);
  });

  it("the catalogue, a course outline and its modules and lessons", async () => {
    const worker = await newSession(api);
    const fixture = await createCourse({ modules: 2, videoSeconds: 120 });

    const list = await api.get(`${V1}/courses?limit=20&offset=0`, worker.token);
    assert.equal(list.status, 200);
    expectShape(arrayOf(courseListItem), list.body, "courses");
    assert.ok(Number.isInteger(Number(list.headers.get("x-total-count"))), "X-Total-Count is a whole number");
    assert.ok(list.body.some((c: { id: string }) => c.id === fixture.courseId));

    const before = await api.get(`${V1}/courses/${fixture.courseId}`, worker.token);
    expectShape(courseOutline, before.body, "course (not joined)");
    assert.equal(before.body.enrollment, null);
    assert.equal(before.body.preview, false);

    const enrol = await api.post(`${V1}/courses/${fixture.courseId}/enroll`, {}, worker.token);
    assert.ok([200, 201].includes(enrol.status), enrol.text);
    const again = await api.post(`${V1}/courses/${fixture.courseId}/enroll`, {}, worker.token);
    assert.ok([200, 201].includes(again.status), "joining twice is harmless");

    const outline = await api.get(`${V1}/courses/${fixture.courseId}`, worker.token);
    expectShape(courseOutline, outline.body, "course (joined)");
    assert.ok(outline.body.enrollment);
    assert.equal(outline.body.modules.length, 2);

    const mod = await api.get(`${V1}/courses/module/${fixture.modules[0]!.id}`, worker.token);
    expectShape(moduleDetail, mod.body, "module");
    assert.equal(mod.body.quiz.locked, true, "the quiz opens only after the lessons");

    const video = await api.get(`${V1}/courses/lesson/${fixture.modules[0]!.lessonIds[0]}`, worker.token);
    expectShape(lessonDetail, video.body, "video lesson");
    assert.equal(video.body.contentType, "video");
    assert.equal(video.body.videoProvider, "youtube");
    assert.ok(video.body.progress.requiredSeconds > 0);

    const text = await api.get(`${V1}/courses/lesson/${fixture.modules[0]!.lessonIds[1]}`, worker.token);
    expectShape(lessonDetail, text.body, "text lesson");
  });

  it("progress: heartbeat, completion, the task list and the stats", async () => {
    const worker = await newSession(api);
    const fixture = await createCourse({ modules: 1 });
    await api.post(`${V1}/courses/${fixture.courseId}/enroll`, {}, worker.token);
    const [first, second] = fixture.modules[0]!.lessonIds as [string, string];

    const beat = await api.post(`${V1}/progress/lesson`, { lessonId: first, positionSeconds: 4 }, worker.token);
    assert.equal(beat.status, 200, beat.text);
    expectShape(recordResult, beat.body, "heartbeat");
    assert.equal(beat.body.progress.completed, false);

    const done = await completeLesson(api, worker, first);
    assert.equal(done.status, 200, done.text);
    expectShape(recordResult, done.body, "completed lesson");
    assert.equal(done.body.progress.completed, true);

    const tooSoon = await api.post(`${V1}/progress/lesson`, { lessonId: second, completed: true }, worker.token);
    assert.equal(tooSoon.status, 409);
    assert.equal(tooSoon.body.code, "VIDEO_NOT_WATCHED");
    assert.equal(typeof tooSoon.body.details.remainingSeconds, "number", "the app prints how long is still needed");

    const enrolled = await api.get(`${V1}/progress/enrolled-courses`, worker.token);
    expectShape(arrayOf(enrolledCourse), enrolled.body, "enrolled-courses");
    assert.equal(enrolled.body.length, 1);

    const stat = await api.get(`${V1}/progress/stats`, worker.token);
    expectShape(stats, stat.body, "stats");
    assert.equal(stat.body.lessonsCompleted, 1);
  });

  it("quizzes: the questions, a failed attempt, a passed attempt and the certificate", async () => {
    const worker = await newSession(api);
    const fixture = await createCourse({ modules: 2 });
    await api.post(`${V1}/courses/${fixture.courseId}/enroll`, {}, worker.token);
    const [m1, m2] = fixture.modules as [(typeof fixture.modules)[number], (typeof fixture.modules)[number]];

    const locked = await api.get(`${V1}/quiz/module/${m1.id}`, worker.token);
    assert.equal(locked.status, 403);
    assert.equal(locked.body.code, "QUIZ_LOCKED");

    for (const id of m1.lessonIds) assert.equal((await completeLesson(api, worker, id)).status, 200);
    const quiz = await api.get(`${V1}/quiz/module/${m1.id}`, worker.token);
    assert.equal(quiz.status, 200, quiz.text);
    expectShape(quizData, quiz.body, "quiz");
    assert.ok(!JSON.stringify(quiz.body).includes("correctIndex"), "the questions never carry the answers");

    const wrong = await api.post(`${V1}/quiz/${m1.quizId}/submit`, { answers: m1.answers.map(() => 1) }, worker.token);
    assert.equal(wrong.status, 200, wrong.text);
    expectShape(quizResult, wrong.body, "failed attempt");
    assert.equal(wrong.body.passed, false);
    for (const item of wrong.body.feedback) assert.ok(!("correctAnswer" in item) && !("explanation" in item), "a failed attempt reveals no answers");

    const right = await api.post(`${V1}/quiz/${m1.quizId}/submit`, { answers: m1.answers }, worker.token);
    expectShape(quizResult, right.body, "passed attempt");
    assert.equal(right.body.passed, true);
    for (const item of right.body.feedback) assert.equal(typeof item.correctAnswer, "number", "after passing, the right answers are shown");

    for (const id of m2.lessonIds) assert.equal((await completeLesson(api, worker, id)).status, 200);
    const last = await api.post(`${V1}/quiz/${m2.quizId}/submit`, { answers: m2.answers }, worker.token);
    expectShape(quizResult, last.body, "last quiz");
    assert.equal(last.body.course?.completed, true);
    expectShape(certificateIssued, last.body.newCertificate, "new certificate");

    const certs = await api.get(`${V1}/certificates`, worker.token);
    expectShape(arrayOf(certificateItem), certs.body, "certificates");
    assert.equal(certs.body.length, 1);

    // the PDF can be fetched with the link alone, exactly like a phone's browser would
    const link = await api.get(`${V1}/certificates/${certs.body[0].id}/download-link`, worker.token);
    expectShape(downloadLink, link.body, "download link");
    assert.match(link.body.url, /^https?:\/\//, "an absolute address the phone can open");
    const pdf = await fetch(link.body.url.replace(/^https?:\/\/[^/]+/, server.api.base));
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");

    // and the page people open from a shared certificate
    const page = await api.get(`/verify/${encodeURIComponent(certs.body[0].certificateNumber)}`);
    assert.equal(page.status, 200);
  });

  it("staff can look at a course without joining, and their progress is not recorded", async () => {
    const trainer = await newSession(api, "trainer");

    // a published course: "preview" is about courses learners cannot see, so it is false here
    const published = await createCourse();
    const open = await api.get(`${V1}/courses/${published.courseId}`, trainer.token);
    expectShape(courseOutline, open.body, "published course seen by staff");
    assert.equal(open.body.preview, false);
    assert.equal(open.body.enrollment, null);
    const noCredit = await api.post(`${V1}/progress/lesson`, { lessonId: published.modules[0]!.lessonIds[0] }, trainer.token);
    assert.equal(noCredit.status, 403);
    assert.equal(noCredit.body.code, "NOT_ENROLLED", "the app turns this into 'your progress is not saved'");

    // a draft: only staff can open it, and it is flagged as a preview
    const draft = await createCourse({ published: false });
    const outline = await api.get(`${V1}/courses/${draft.courseId}`, trainer.token);
    expectShape(courseOutline, outline.body, "draft seen by staff");
    assert.equal(outline.body.preview, true);
    const lesson = await api.get(`${V1}/courses/lesson/${draft.modules[0]!.lessonIds[0]}`, trainer.token);
    expectShape(lessonDetail, lesson.body, "draft lesson seen by staff");
    const beat = await api.post(`${V1}/progress/lesson`, { lessonId: draft.modules[0]!.lessonIds[0] }, trainer.token);
    assert.ok(["NOT_ENROLLED", "COURSE_NOT_AVAILABLE"].includes(beat.body.code), beat.text);
    assert.ok([403, 404].includes(beat.status));

    // learners never see drafts
    const worker = await newSession(api);
    assert.equal((await api.get(`${V1}/courses/${draft.courseId}`, worker.token)).status, 404);
  });

  it("every error has the body the app parses: error, a known code and a request id", async () => {
    const worker = await newSession(api);
    const cases = [
      await api.get(`${V1}/courses/00000000-0000-4000-8000-000000000000`, worker.token),
      await api.get(`${V1}/courses`),
      await api.post(`${V1}/auth/login`, { username: "nobody_here", password: "wrong-password-1" }),
      await api.post(`${V1}/auth/register`, { username: "x" }),
    ];
    assert.deepEqual(
      cases.map((c) => c.status),
      [404, 401, 401, 400]
    );
    for (const res of cases) {
      assert.equal(typeof res.body.error, "string");
      assert.ok((ERROR_CODES as readonly string[]).includes(res.body.code), `unknown code ${res.body.code}`);
      assert.equal(typeof res.body.requestId, "string");
    }
    assert.ok(isRecord(cases[3]!.body.details.fields), "validation errors list the fields");
  });

  it("a one-time password forces a change before anything else works", async () => {
    const user = await createUser({ mustChangePassword: true });
    const session = await signIn(api, user);
    const me = await api.get(`${V1}/auth/me`, session.token);
    assert.equal(me.body.mustChangePassword, true);
    const blocked = await api.get(`${V1}/courses`, session.token);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, "PASSWORD_CHANGE_REQUIRED");
    const changed = await api.post(`${V1}/auth/change-password`, { currentPassword: user.password, newPassword: "Brand#New-Pass-2027" }, session.token);
    assert.equal(changed.status, 200, changed.text);
    expectShape(authResult, changed.body, "change-password");
    assert.equal(changed.body.user.mustChangePassword, false);
    assert.equal((await api.get(`${V1}/courses`, changed.body.accessToken)).status, 200, "the fresh session works at once");
    assert.equal((await api.get(`${V1}/auth/me`, session.token)).status, 401, "the old access token no longer works");
  });

  it("push addresses are registered and removed the way the app does it", async () => {
    const worker = await newSession(api);
    const token = "ExponentPushToken[contract-test-0001]";
    assert.equal((await api.post(`${V1}/auth/push-token`, { token, platform: "android" }, worker.token)).status, 200);
    assert.equal((await api.delete(`${V1}/auth/push-token`, { token }, worker.token)).status, 200);
  });

  it("erasing an account needs the password and signs everything out", async () => {
    const user = await createUser();
    const session = await signIn(api, user);
    const wrong = await api.delete(`${V1}/auth/me`, { password: "not-the-password-1" }, session.token);
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.code, "CURRENT_PASSWORD_INCORRECT", "a wrong password here must not look like an expired session");
    const gone = await api.delete(`${V1}/auth/me`, { password: user.password }, session.token);
    assert.equal(gone.status, 200, gone.text);
    assert.equal((await api.get(`${V1}/auth/me`, session.token)).status, 401);
    assert.equal((await api.post(`${V1}/auth/login`, { username: user.username, password: user.password })).status, 401);
  });
});

describe("the app's own HTTP client against the real server", () => {
  function clientFor(seed: Record<string, string> = {}) {
    const store = new Map(Object.entries(seed));
    const tokens = createTokenStore({
      getItem: async (key) => store.get(key) ?? null,
      setItem: async (key, value) => void store.set(key, value),
      removeItem: async (key) => void store.delete(key),
    });
    const calls: string[] = [];
    const events = { lost: 0 };
    const client = createApiClient({
      baseUrl: server.api.base,
      tokens,
      fetchImpl: (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        calls.push(`${init?.method ?? "GET"} ${new URL(String(input)).pathname}`);
        return fetch(input, init);
      }) as typeof fetch,
      onSessionLost: () => void (events.lost += 1),
    });
    return { client, tokens, store, calls, events };
  }

  it("signs in, reads a paged list with its total, and handles a wrong password", async () => {
    const user = await createUser();
    await createCourse();
    const { client, tokens } = clientFor();
    const result = await client.post<AuthResult>("/auth/login", { username: user.username, password: user.password }, { auth: false });
    await tokens.write({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    const page = await client.getWithMeta<CourseListItem[]>("/courses", { query: { limit: 1, offset: 0 } });
    assert.equal(page.data.length, 1);
    assert.ok(page.total !== undefined && page.total >= 1);

    await assert.rejects(client.post("/auth/login", { username: user.username, password: "wrong-password-9" }, { auth: false }), (e: unknown) => e instanceof ApiError && e.code === "INVALID_CREDENTIALS" && e.status === 401);
  });

  it("recovers from an expired access token with exactly one refresh, however many requests were waiting", async () => {
    const user = await createUser();
    const { client, tokens, calls, store, events } = clientFor();
    const result = await client.post<AuthResult>("/auth/login", { username: user.username, password: user.password }, { auth: false });
    await tokens.write({ accessToken: "this-is-not-a-valid-token", refreshToken: result.refreshToken });
    const answers = await Promise.all(Array.from({ length: 6 }, () => client.get<AuthUser>("/auth/me")));
    assert.ok(answers.every((a) => a.username === user.username));
    assert.equal(calls.filter((c) => c === "POST /api/v1/auth/refresh").length, 1);
    assert.notEqual(store.get(REFRESH_TOKEN_KEY), result.refreshToken, "the rotated refresh token was stored");
    assert.notEqual(store.get(ACCESS_TOKEN_KEY), "this-is-not-a-valid-token");
    assert.equal(events.lost, 0);
    // and the new pair keeps working
    assert.equal((await client.get<AuthUser>("/auth/me")).id, user.id);
  });

  it("ends the session when the server refuses the refresh token (signed out elsewhere)", async () => {
    const user = await createUser();
    const { client, tokens, store, events } = clientFor();
    const result = await client.post<AuthResult>("/auth/login", { username: user.username, password: user.password }, { auth: false });
    await tokens.write({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    await api.post(`${V1}/auth/logout-all`, {}, result.accessToken);
    await assert.rejects(client.get("/auth/me"), (e: unknown) => e instanceof ApiError && e.code === "SESSION_EXPIRED");
    assert.equal(events.lost, 1);
    assert.equal(store.size, 0, "the stored tokens are wiped");
  });

  it("opens the 'choose a new password' gate and then works normally", async () => {
    const user = await createUser({ mustChangePassword: true });
    const { client, tokens } = clientFor();
    const gate = { opened: 0 };
    const gated = createApiClient({ baseUrl: server.api.base, tokens, onPasswordChangeRequired: () => void (gate.opened += 1) });
    const result = await client.post<AuthResult>("/auth/login", { username: user.username, password: user.password }, { auth: false });
    await tokens.write({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    await assert.rejects(gated.get("/courses"), (e: unknown) => e instanceof ApiError && e.code === "PASSWORD_CHANGE_REQUIRED");
    assert.equal(gate.opened, 1);
    const fresh = await gated.post<AuthResult>("/auth/change-password", { currentPassword: user.password, newPassword: "Another#Strong-2027" });
    await tokens.write({ accessToken: fresh.accessToken, refreshToken: fresh.refreshToken });
    assert.ok(Array.isArray(await gated.get("/courses")));
  });
});
