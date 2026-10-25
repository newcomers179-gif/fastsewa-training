import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { auditLogs, certificates, lessons, users } from "@shared/schema";
import { db, pool } from "../db";
import { iterateWorkers } from "../services/people";
import { Api, createCourse, createUser, newSession, resetDatabase, shutdown, signIn, startServer, uniq, completeLesson, type Session, type TestServer } from "./helpers";

let server: TestServer;
let api: Api;
let admin: Session;
let trainer: Session;
let worker: Session;

before(async () => {
  await resetDatabase();
  server = await startServer();
  api = server.api;
  admin = await newSession(api, "admin");
  trainer = await newSession(api, "trainer");
  worker = await newSession(api, "worker");
});
after(async () => {
  await server.close();
  await shutdown();
});

const courseBody = (over: Record<string, unknown> = {}) => ({
  slug: uniq("c-"),
  title: "Scaffolding Basics",
  description: "Erecting and inspecting scaffolds safely.",
  category: "safety",
  difficulty: "intermediate",
  ...over,
});

async function newDraftCourse(over: Record<string, unknown> = {}) {
  const res = await api.post("/api/v1/admin/courses", courseBody(over), admin.token);
  assert.equal(res.status, 201, res.text);
  return res.body as { id: string; slug: string };
}
async function newModule(courseId: string, title = "Module") {
  const res = await api.post(`/api/v1/admin/courses/${courseId}/modules`, { title }, admin.token);
  assert.equal(res.status, 201, res.text);
  return res.body.id as string;
}
async function newTextLesson(moduleId: string, title = "A lesson") {
  const res = await api.post(`/api/v1/admin/modules/${moduleId}/lessons`, { title, contentType: "text", content: "Hello world" }, admin.token);
  assert.equal(res.status, 201, res.text);
  return res.body.id as string;
}
const auditActions = async () => (await db.select({ a: auditLogs.action }).from(auditLogs)).map((r) => r.a);

describe("who may do what", () => {
  const readOnly = ["/api/v1/admin/dashboard", "/api/v1/admin/workers", "/api/v1/admin/courses", "/api/v1/admin/analytics/courses", "/api/v1/admin/analytics/activity"];
  const adminOnlyGets = ["/api/v1/admin/staff", "/api/v1/admin/audit", "/api/v1/admin/workers/export.csv"];

  it("blocks anonymous callers and learners from every admin route", async () => {
    for (const path of [...readOnly, ...adminOnlyGets]) {
      assert.equal((await api.get(path)).status, 401, `anonymous ${path}`);
      assert.equal((await api.get(path, worker.token)).status, 403, `worker ${path}`);
    }
  });

  it("lets trainers read dashboards and lists but not change or export anything", async () => {
    for (const path of readOnly) assert.equal((await api.get(path, trainer.token)).status, 200, path);
    for (const path of adminOnlyGets) assert.equal((await api.get(path, trainer.token)).status, 403, path);
    assert.equal((await api.post("/api/v1/admin/courses", courseBody(), trainer.token)).status, 403);
    assert.equal((await api.post("/api/v1/admin/staff", { username: uniq("s"), displayName: "Nope", role: "trainer" }, trainer.token)).status, 403);
    assert.equal((await api.post("/api/v1/admin/notify/broadcast", { title: "t", body: "b" }, trainer.token)).status, 403);
    assert.equal((await api.patch(`/api/v1/admin/workers/${worker.user.id}/deactivate`, {}, trainer.token)).status, 403);
  });

  it("lets admins do all of it", async () => {
    for (const path of [...readOnly, ...adminOnlyGets]) assert.equal((await api.get(path, admin.token)).status, 200, path);
  });

  it("honours a role change immediately", async () => {
    const promoted = await newSession(api, "worker");
    assert.equal((await api.get("/api/v1/admin/dashboard", promoted.token)).status, 403);
    await db.update(users).set({ role: "admin", tokenVersion: 1 }).where(eq(users.id, promoted.user.id));
    assert.equal((await api.get("/api/v1/admin/dashboard", promoted.token)).status, 401, "the old token no longer matches the account");
    assert.equal((await api.get("/api/v1/admin/dashboard", (await signIn(api, { ...promoted.user, role: "admin" })).token)).status, 200);
  });
});

describe("courses", () => {
  it("are created as drafts, with a normalised slug, and the slug must stay unique", async () => {
    const created = await api.post("/api/v1/admin/courses", courseBody({ slug: "  My-Course-One  " }), admin.token);
    assert.equal(created.status, 201);
    assert.equal(created.body.slug, "my-course-one");
    assert.equal(created.body.isPublished, false);
    const dup = await api.post("/api/v1/admin/courses", courseBody({ slug: "my-course-one" }), admin.token);
    assert.equal(dup.status, 409);
    assert.deepEqual(dup.body.details.fields.slug, ["Already in use"]);
    for (const bad of [{ slug: "Bad Slug!" }, { category: "astrology" }, { title: "x" }, { description: "short" }]) {
      assert.equal((await api.post("/api/v1/admin/courses", courseBody(bad), admin.token)).status, 400, JSON.stringify(bad));
    }
  });

  it("can be edited; unknown ids are 404", async () => {
    const c = await newDraftCourse();
    const res = await api.put(`/api/v1/admin/courses/${c.id}`, { title: "Renamed", titleHi: "नया नाम", difficulty: "advanced" }, admin.token);
    assert.equal(res.status, 200);
    assert.equal(res.body.title, "Renamed");
    assert.equal(res.body.titleHi, "नया नाम");
    assert.equal((await api.put("/api/v1/admin/courses/00000000-0000-0000-0000-000000000000", { title: "x y" }, admin.token)).status, 404);
  });

  it("cannot be published while empty or incomplete, and become visible to learners once published", async () => {
    const c = await newDraftCourse();
    const publish = (published: boolean) => api.patch(`/api/v1/admin/courses/${c.id}/publish`, { published }, admin.token);
    assert.equal((await publish(true)).status, 400, "no modules");
    const moduleId = await newModule(c.id);
    assert.equal((await publish(true)).status, 400, "a module without lessons");

    const video = await api.post(`/api/v1/admin/modules/${moduleId}/lessons`, { title: "Video", contentType: "video", videoUrl: "https://youtu.be/dQw4w9WgXcQ", videoDurationSeconds: 120 }, admin.token);
    assert.equal(video.status, 201);
    assert.equal((await api.get(`/api/v1/courses/${c.id}`, worker.token)).body.code, "COURSE_NOT_AVAILABLE");
    assert.equal((await publish(true)).status, 200);
    assert.equal((await api.get(`/api/v1/courses/${c.id}`, worker.token)).status, 200);
    assert.equal((await publish(false)).body.isPublished, false);
    assert.equal((await api.get(`/api/v1/courses/${c.id}`, worker.token)).body.code, "COURSE_NOT_AVAILABLE");
  });

  it("are archived instead of deleted once learners have records; unused ones can be deleted", async () => {
    const fixture = await createCourse({ modules: 1 });
    const learner = await newSession(api);
    await api.post(`/api/v1/courses/${fixture.courseId}/enroll`, {}, learner.token);

    const blocked = await api.delete(`/api/v1/admin/courses/${fixture.courseId}`, undefined, admin.token);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, "COURSE_HAS_RECORDS");

    assert.equal((await api.patch(`/api/v1/admin/courses/${fixture.courseId}/archive`, {}, admin.token)).status, 200);
    const visible = await api.get("/api/v1/courses?limit=100", worker.token);
    assert.ok(!visible.body.some((c: { id: string }) => c.id === fixture.courseId), "archived courses leave the catalogue");
    const mine = await api.get("/api/v1/progress/enrolled-courses", learner.token);
    assert.ok(Array.isArray(mine.body));
    assert.equal((await api.patch(`/api/v1/admin/courses/${fixture.courseId}/unarchive`, {}, admin.token)).status, 200);

    const unused = await newDraftCourse();
    assert.equal((await api.delete(`/api/v1/admin/courses/${unused.id}`, undefined, admin.token)).status, 200);
    assert.equal((await api.get(`/api/v1/admin/courses/${unused.id}`, admin.token)).status, 404);
  });

  it("show staff the whole tree, including drafts and quizzes", async () => {
    const c = await newDraftCourse();
    const m = await newModule(c.id, "First");
    await newTextLesson(m);
    const tree = await api.get(`/api/v1/admin/courses/${c.id}`, trainer.token);
    assert.equal(tree.status, 200);
    assert.equal(tree.body.status, "draft");
    assert.equal(tree.body.modules[0].lessons.length, 1);
    const list = await api.get("/api/v1/admin/courses", admin.token);
    assert.ok(list.body.some((row: { id: string }) => row.id === c.id));
  });
});

describe("lessons", () => {
  it("are validated by type, and media links must come from an allowed source", async () => {
    const c = await newDraftCourse();
    const m = await newModule(c.id);
    const post = (body: object) => api.post(`/api/v1/admin/modules/${m}/lessons`, { title: "Lesson", ...body }, admin.token);

    const noUrl = await post({ contentType: "video" });
    assert.equal(noUrl.status, 400);
    assert.ok(noUrl.body.details.fields.videoUrl && noUrl.body.details.fields.videoDurationSeconds, "both the link and the length are required");
    assert.equal((await post({ contentType: "video", videoUrl: "https://evil.example.com/v.mp4", videoDurationSeconds: 60 })).body.details.fields.videoUrl[0], "That media link is not from an allowed source");
    assert.equal((await post({ contentType: "text" })).status, 400);
    assert.equal((await post({ contentType: "image", imageUrl: "javascript:alert(1)" })).status, 400);
    assert.equal((await post({ contentType: "image" })).status, 400);

    const video = await post({ contentType: "video", videoUrl: "https://youtu.be/dQw4w9WgXcQ?t=9", videoDurationSeconds: 212 });
    assert.equal(video.status, 201);
    assert.equal(video.body.videoUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "links are normalised");
    assert.equal(video.body.videoProvider, "youtube");
    assert.equal((await post({ contentType: "text", content: "## Heading\n\nBody", contentHi: "## शीर्षक" })).status, 201);
  });

  it("keep an old link when only something else is edited (old data must stay editable)", async () => {
    const c = await newDraftCourse();
    const m = await newModule(c.id);
    const id = await newTextLesson(m);
    await db.update(lessons).set({ contentType: "video", videoUrl: "https://old-host.example.com/v.mp4", videoDurationSeconds: 90, content: null }).where(eq(lessons.id, id));

    const rename = await api.put(`/api/v1/admin/lessons/${id}`, { title: "Renamed lesson" }, admin.token);
    assert.equal(rename.status, 200, rename.text);
    assert.equal(rename.body.videoUrl, "https://old-host.example.com/v.mp4");
    const swap = await api.put(`/api/v1/admin/lessons/${id}`, { videoUrl: "https://another-bad.example.com/v.mp4" }, admin.token);
    assert.equal(swap.status, 400, "but a NEW disallowed link is refused");
  });

  it("can be reordered only with the exact set of ids", async () => {
    const c = await newDraftCourse();
    const m = await newModule(c.id);
    const [a, b, d] = [await newTextLesson(m, "Lesson A"), await newTextLesson(m, "Lesson B"), await newTextLesson(m, "Lesson D")];
    const reorder = (ids: string[]) => api.post(`/api/v1/admin/modules/${m}/lessons/reorder`, { ids }, admin.token);
    assert.equal((await reorder([d, a, b])).status, 200);
    const tree = await api.get(`/api/v1/admin/courses/${c.id}`, admin.token);
    assert.deepEqual(tree.body.modules[0].lessons.map((l: { id: string }) => l.id), [d, a, b]);
    assert.equal((await reorder([a, b])).status, 400, "missing one");
    assert.equal((await reorder([a, a, b])).status, 400, "duplicate");
    assert.equal((await reorder([a, b, d, "00000000-0000-0000-0000-000000000000"])).status, 400, "foreign id");
  });

  it("are protected from deletion once a learner has progress, and removed with their module otherwise", async () => {
    const fixture = await createCourse({ modules: 1 });
    const learner = await newSession(api);
    await api.post(`/api/v1/courses/${fixture.courseId}/enroll`, {}, learner.token);
    await completeLesson(api, learner, fixture.modules[0].lessonIds[0]);
    const blocked = await api.delete(`/api/v1/admin/lessons/${fixture.modules[0].lessonIds[0]}`, undefined, admin.token);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, "COURSE_HAS_RECORDS");
    const blockedModule = await api.delete(`/api/v1/admin/modules/${fixture.modules[0].id}`, undefined, admin.token);
    assert.equal(blockedModule.status, 409);
    assert.equal(blockedModule.body.code, "COURSE_HAS_RECORDS");

    const c = await newDraftCourse();
    const m = await newModule(c.id);
    const id = await newTextLesson(m);
    assert.equal((await api.delete(`/api/v1/admin/lessons/${id}`, undefined, admin.token)).status, 200);
    assert.equal((await api.delete(`/api/v1/admin/modules/${m}`, undefined, admin.token)).status, 200);
  });
});

describe("quizzes", () => {
  const quiz = (over: Record<string, unknown> = {}) => ({
    title: "Scaffold quiz",
    passingScore: 60,
    questions: [
      { question: "Base plates are used to…", options: ["spread the load", "look nice"], correctIndex: 0, explanation: "They spread the load." },
      { question: "Ties connect…", questionHi: "टाई जोड़ती हैं…", options: ["scaffold to structure", "nothing"], optionsHi: ["मचान को ढांचे से", "कुछ नहीं"], correctIndex: 0 },
    ],
    ...over,
  });

  it("are created, read back (with answers, for staff), replaced and deleted", async () => {
    const c = await newDraftCourse();
    const m = await newModule(c.id);
    assert.equal((await api.get(`/api/v1/admin/modules/${m}/quiz`, admin.token)).status, 404);
    const saved = await api.put(`/api/v1/admin/modules/${m}/quiz`, quiz(), admin.token);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.questions.length, 2);
    assert.equal(saved.body.questions[0].correctIndex, 0);

    const replaced = await api.put(`/api/v1/admin/modules/${m}/quiz`, quiz({ questions: [quiz().questions[0]] }), admin.token);
    assert.equal(replaced.body.questions.length, 1);
    assert.equal(replaced.body.id, saved.body.id, "same quiz, new questions");
    assert.equal((await api.get(`/api/v1/admin/modules/${m}/quiz`, trainer.token)).body.questions.length, 1);
    assert.equal((await api.delete(`/api/v1/admin/modules/${m}/quiz`, undefined, admin.token)).status, 200);
    assert.equal((await api.get(`/api/v1/admin/modules/${m}/quiz`, admin.token)).status, 404);
  });

  it("are checked for sanity", async () => {
    const c = await newDraftCourse();
    const m = await newModule(c.id);
    const put = (body: object) => api.put(`/api/v1/admin/modules/${m}/quiz`, body, admin.token);
    assert.equal((await put(quiz({ questions: [] }))).status, 400);
    assert.equal((await put(quiz({ passingScore: 0 }))).status, 400);
    assert.equal((await put(quiz({ passingScore: 101 }))).status, 400);
    assert.equal((await put(quiz({ questions: [{ question: "Only one option?", options: ["a"], correctIndex: 0 }] }))).status, 400);
    const badIndex = await put(quiz({ questions: [{ question: "Which one?", options: ["a", "b"], correctIndex: 5 }] }));
    assert.equal(badIndex.status, 400);
    assert.ok(badIndex.body.details.fields["questions.0.correctIndex"]);
    assert.equal((await put(quiz({ questions: [{ question: "Which one?", options: ["a", "b"], optionsHi: ["अ"], correctIndex: 0 }] }))).status, 400, "Hindi options must match");
  });
});

describe("learners", () => {
  it("are listed with their real course and certificate counts, search, filters and paging", async () => {
    const fixture = await createCourse({ modules: 1 });
    const star = await createUser({ displayName: "Zed Starlearner" });
    const starSession = await signIn(api, star);
    await api.post(`/api/v1/courses/${fixture.courseId}/enroll`, {}, starSession.token);
    for (const id of fixture.modules[0].lessonIds) await completeLesson(api, starSession, id);
    await api.post(`/api/v1/quiz/${fixture.modules[0].quizId}/submit`, { answers: fixture.modules[0].answers }, starSession.token);

    const res = await api.get(`/api/v1/admin/workers?q=${encodeURIComponent("Starlearner")}`, admin.token);
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    const row = res.body.items[0];
    assert.equal(row.username, star.username);
    assert.equal(row.coursesEnrolled, 1);
    assert.equal(row.coursesCompleted, 1);
    assert.equal(row.certificates, 1);
    assert.ok(!("passwordHash" in row));

    assert.equal((await api.get(`/api/v1/admin/workers?q=${encodeURIComponent("%")}`, admin.token)).body.total, 0, "% is not a wildcard");
    assert.ok((await api.get("/api/v1/admin/workers?pageSize=2&page=1", admin.token)).body.items.length <= 2);
    assert.equal((await api.get("/api/v1/admin/workers?pageSize=1000", admin.token)).status, 400);
    assert.ok((await api.get("/api/v1/admin/workers?sort=name&status=active", admin.token)).body.items.every((w: { isActive: boolean }) => w.isActive));
    assert.ok(!(await api.get("/api/v1/admin/workers?pageSize=100", admin.token)).body.items.some((w: { username: string }) => w.username === admin.user.username), "staff are not listed as learners");
  });

  it("have a detail page with enrolments and certificates", async () => {
    const detail = await api.get(`/api/v1/admin/workers/${worker.user.id}`, trainer.token);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.user.username, worker.user.username);
    assert.ok(Array.isArray(detail.body.enrollments));
    assert.equal((await api.get(`/api/v1/admin/workers/${admin.user.id}`, admin.token)).status, 404, "an admin account is not a worker record");
  });

  it("export to CSV with formulas defused, Hindi names intact and every row exactly once", async () => {
    const evil = await createUser({ displayName: "Formula Fan", email: "=cmd|calc@evil.example.com", phoneNumber: "+919876500077" });
    const hindi = await createUser({ displayName: "रमेश कुमार" });
    const res = await api.get("/api/v1/admin/workers/export.csv", admin.token);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(res.headers.get("content-disposition") ?? "", /attachment; filename="fastsewa-workers-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = res.text.replace(/^﻿/, "").trim().split("\r\n");
    assert.equal(lines[0], "Username,Name,Phone,Email,Language,Status,Joined,Last login,Courses enrolled,Courses completed,Certificates");
    const evilLine = lines.find((l) => l.startsWith(evil.username))!;
    assert.ok(evilLine.includes(",'=cmd|calc@evil.example.com,"), evilLine);
    assert.ok(evilLine.includes(",+919876500077,"), "phone numbers stay readable");
    assert.ok(lines.find((l) => l.startsWith(hindi.username))!.includes("रमेश कुमार"));
    const usernames = lines.slice(1).map((l) => l.split(",")[0]);
    assert.equal(new Set(usernames).size, usernames.length);
    assert.ok(!usernames.includes(admin.user.username));
    assert.ok((await auditActions()).includes("workers.export"), "exports are audited");
  });

  it("stream in stable pages even when many rows share a timestamp", async () => {
    const batch = await Promise.all(Array.from({ length: 7 }, () => createUser()));
    await pool.query(`UPDATE users SET created_at = '2026-01-01T00:00:00Z' WHERE id = ANY($1)`, [batch.map((u) => u.id)]);
    const seen: string[] = [];
    for await (const page of iterateWorkers({ status: "all" }, 3)) for (const w of page) seen.push(w.id);
    assert.equal(new Set(seen).size, seen.length, "no row twice");
    for (const u of batch) assert.ok(seen.includes(u.id), `missing ${u.username}`);
  });

  it("can be edited, deactivated (instantly locked out) and reactivated by an admin", async () => {
    const victim = await createUser();
    const session = await signIn(api, victim);
    const edit = await api.patch(`/api/v1/admin/workers/${victim.id}`, { displayName: "New Name", phoneNumber: "98765 11111" }, admin.token);
    assert.equal(edit.status, 200);
    assert.equal(edit.body.phoneNumber, "+919876511111");
    assert.equal((await api.patch(`/api/v1/admin/workers/${victim.id}`, { role: "admin" }, admin.token)).status, 400);
    assert.equal((await api.patch(`/api/v1/admin/workers/${victim.id}`, { phoneNumber: "1" }, admin.token)).body.code, "PHONE_INVALID");

    assert.equal((await api.patch(`/api/v1/admin/workers/${victim.id}/deactivate`, {}, admin.token)).status, 200);
    assert.equal((await api.get("/api/v1/auth/me", session.token)).status, 401, "the live access token stops working at once");
    assert.equal((await api.post("/api/v1/auth/refresh", { refreshToken: session.refreshToken })).status, 401);
    assert.equal((await api.post("/api/v1/auth/login", { username: victim.username, password: victim.password })).body.code, "ACCOUNT_DISABLED");
    assert.equal((await api.patch(`/api/v1/admin/workers/${victim.id}/activate`, {}, admin.token)).status, 200);
    assert.equal((await api.post("/api/v1/auth/login", { username: victim.username, password: victim.password })).status, 200);
    const actions = await auditActions();
    for (const a of ["worker.updated", "worker.deactivated", "worker.activated"]) assert.ok(actions.includes(a), a);
  });

  it("get a one-time password from an admin, and must replace it", async () => {
    const victim = await createUser();
    const session = await signIn(api, victim);
    const res = await api.post(`/api/v1/admin/workers/${victim.id}/reset-password`, {}, admin.token);
    assert.equal(res.status, 200);
    assert.match(res.body.temporaryPassword, /^[A-Za-z0-9]{10}$/);
    assert.equal(res.body.mustChangePassword, true);
    assert.equal((await api.get("/api/v1/auth/me", session.token)).status, 401, "existing sessions end");
    const login = await api.post("/api/v1/auth/login", { username: victim.username, password: res.body.temporaryPassword });
    assert.equal(login.body.user.mustChangePassword, true);
    assert.equal((await api.get("/api/v1/courses", login.body.accessToken)).body.code, "PASSWORD_CHANGE_REQUIRED");
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, "worker.password_reset"));
    assert.ok(!JSON.stringify(audit).includes(res.body.temporaryPassword), "the temporary password is never logged");
  });

  it("can be erased by an admin who types the username, leaving no personal data behind", async () => {
    const victim = await createUser({ email: `${uniq("gone")}@example.com`, phoneNumber: "+919876500055" });
    assert.equal((await api.delete(`/api/v1/admin/workers/${victim.id}`, {}, admin.token)).status, 400);
    assert.equal((await api.delete(`/api/v1/admin/workers/${victim.id}`, { confirmUsername: "someone-else" }, admin.token)).body.code, "CONFIRMATION_MISMATCH");
    assert.equal((await api.delete(`/api/v1/admin/workers/${victim.id}`, { confirmUsername: victim.username.toUpperCase() }, admin.token)).status, 200);
    const [row] = await db.select().from(users).where(eq(users.id, victim.id));
    assert.ok(row.deletedAt);
    assert.equal(row.email, null);
    assert.equal(row.phoneNumber, null);
    assert.equal(row.displayName, "Deleted user");
    assert.equal((await api.get(`/api/v1/admin/workers/${victim.id}`, admin.token)).status, 404);
  });
});

describe("staff accounts", () => {
  it("are created with a one-time password and a forced change", async () => {
    const username = uniq("staff");
    const res = await api.post("/api/v1/admin/staff", { username: username.toUpperCase(), displayName: "Trainer Two", role: "trainer", email: `${username}@example.com` }, admin.token);
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, "trainer");
    assert.equal(res.body.user.username, username);
    assert.equal(res.body.mustChangePassword, true);
    assert.match(res.body.temporaryPassword, /^[A-Za-z0-9]{16}$/, "staff one-time passwords are longer than learners'");
    assert.equal((await api.post("/api/v1/admin/staff", { username, displayName: "Dup", role: "trainer" }, admin.token)).body.code, "USERNAME_TAKEN");
    assert.equal((await api.post("/api/v1/admin/staff", { username: uniq("x"), displayName: "Bad", role: "worker" }, admin.token)).status, 400);
    const login = await api.post("/api/v1/auth/login", { username, password: res.body.temporaryPassword });
    assert.equal(login.body.user.mustChangePassword, true);

    const again = await api.post(`/api/v1/admin/staff/${res.body.user.id}/reset-password`, {}, admin.token);
    assert.equal(again.status, 200);
    assert.match(again.body.temporaryPassword, /^[A-Za-z0-9]{16}$/);
    assert.equal((await api.post("/api/v1/auth/login", { username, password: res.body.temporaryPassword })).status, 401, "the earlier one-time password no longer works");
  });

  it("cannot be used by an admin against their own account", async () => {
    assert.equal((await api.patch(`/api/v1/admin/staff/${admin.user.id}`, { role: "trainer" }, admin.token)).body.code, "SELF_ACTION_FORBIDDEN");
    assert.equal((await api.patch(`/api/v1/admin/staff/${admin.user.id}`, { isActive: false }, admin.token)).body.code, "SELF_ACTION_FORBIDDEN");
    assert.equal((await api.post(`/api/v1/admin/staff/${admin.user.id}/reset-password`, {}, admin.token)).body.code, "SELF_ACTION_FORBIDDEN");
  });

  it("can never leave the system without an active admin, even when two admins act at the same moment", async () => {
    const a = await newSession(api, "admin");
    const b = await newSession(api, "admin");
    // Everyone else who is an admin is demoted for the duration of this test.
    const others = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
    const keep = new Set([a.user.id, b.user.id]);
    const demoted = others.filter((o) => !keep.has(o.id)).map((o) => o.id);
    if (demoted.length) await db.update(users).set({ role: "trainer" }).where(inArray(users.id, demoted));
    try {
      const [first, second] = await Promise.all([
        api.patch(`/api/v1/admin/staff/${b.user.id}`, { isActive: false }, a.token),
        api.patch(`/api/v1/admin/staff/${a.user.id}`, { isActive: false }, b.token),
      ]);
      const statuses = [first.status, second.status].sort();
      assert.deepEqual(statuses, [200, 409], "exactly one of them wins");
      const loser = first.status === 409 ? first : second;
      assert.equal(loser.body.code, "LAST_ADMIN");
      const active = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
      assert.ok(active.length >= 2);
      const [{ n }] = (await pool.query(`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND is_active AND deleted_at IS NULL`)).rows;
      assert.equal(n, 1, "one active admin remains");
    } finally {
      if (demoted.length) await db.update(users).set({ role: "admin" }).where(inArray(users.id, demoted));
      await db.update(users).set({ isActive: true }).where(inArray(users.id, [a.user.id, b.user.id]));
    }
  });

  it("lose access at once when demoted or deactivated by another admin", async () => {
    const other = await newSession(api, "admin");
    const target = await newSession(api, "trainer");
    assert.equal((await api.get("/api/v1/admin/dashboard", target.token)).status, 200);
    assert.equal((await api.patch(`/api/v1/admin/staff/${target.user.id}`, { isActive: false }, other.token)).status, 200);
    assert.equal((await api.get("/api/v1/admin/dashboard", target.token)).status, 401);
    assert.equal((await api.post(`/api/v1/admin/staff/${target.user.id}/reset-password`, {}, other.token)).status, 200);
  });
});

describe("certificates (admin)", () => {
  it("can be looked up, revoked with a reason, and reinstated — all audited", async () => {
    const fixture = await createCourse({ modules: 1 });
    const learner = await newSession(api);
    await api.post(`/api/v1/courses/${fixture.courseId}/enroll`, {}, learner.token);
    for (const id of fixture.modules[0].lessonIds) await completeLesson(api, learner, id);
    const passed = await api.post(`/api/v1/quiz/${fixture.modules[0].quizId}/submit`, { answers: fixture.modules[0].answers }, learner.token);
    const number = passed.body.newCertificate.certificateNumber as string;

    const found = await api.get(`/api/v1/admin/certificates/lookup?number=${number.toLowerCase()}`, trainer.token);
    assert.equal(found.status, 200);
    assert.equal(found.body.username, learner.user.username);
    assert.equal((await api.get("/api/v1/admin/certificates/lookup?number=FSWA-NOPE-NOPE-NOPE", admin.token)).status, 404);

    const id = found.body.id as string;
    assert.equal((await api.post(`/api/v1/admin/certificates/${id}/revoke`, {}, admin.token)).status, 400, "a reason is required");
    assert.equal((await api.post(`/api/v1/admin/certificates/${id}/revoke`, { reason: "Issued in error" }, trainer.token)).status, 403);
    const revoked = await api.post(`/api/v1/admin/certificates/${id}/revoke`, { reason: "Issued in error" }, admin.token);
    assert.equal(revoked.body.revoked, true);
    assert.equal((await api.get(`/api/v1/verify/${number}`)).body.status, "revoked");
    const reinstated = await api.post(`/api/v1/admin/certificates/${id}/reinstate`, {}, admin.token);
    assert.equal(reinstated.body.revoked, false);
    assert.equal((await api.get(`/api/v1/verify/${number}`)).body.status, "valid");

    const actions = await auditActions();
    assert.ok(actions.includes("certificate.revoked") && actions.includes("certificate.reinstated"));
    const [cert] = await db.select().from(certificates).where(eq(certificates.id, id));
    assert.equal(cert.revokedAt, null);
  });
});

describe("insights", () => {
  it("report the dashboard, per-course analytics and a daily activity series", async () => {
    const dash = await api.get("/api/v1/admin/dashboard", admin.token);
    for (const key of ["totalWorkers", "activeWorkers", "newWorkers7d", "totalCourses", "draftCourses", "totalEnrollments", "completedEnrollments", "certificatesIssued", "completionRate"]) {
      assert.equal(typeof dash.body[key], "number", key);
    }
    assert.ok(dash.body.totalWorkers >= 1);
    const analytics = await api.get("/api/v1/admin/analytics/courses", admin.token);
    assert.ok(Array.isArray(analytics.body) && analytics.body.length > 0);
    const activity = await api.get("/api/v1/admin/analytics/activity?days=14", admin.token);
    assert.equal(activity.body.series.length, 14);
    assert.equal((await api.get("/api/v1/admin/analytics/activity?days=9999", admin.token)).status, 400);
  });

  it("keep an audit trail that only admins can read", async () => {
    const trail = await api.get("/api/v1/admin/audit?pageSize=5", admin.token);
    assert.equal(trail.status, 200);
    assert.ok(trail.body.items.length > 0);
    assert.ok(trail.body.items.every((e: { action: string; requestId: string | null }) => e.action && "requestId" in e));
    const actions = await auditActions();
    for (const a of ["course.created", "lesson.created", "quiz.saved", "staff.created"]) assert.ok(actions.includes(a), `${a} was audited`);
  });
});

describe("media uploads (local provider)", () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

  async function upload(session: Session, buffer: Buffer, opts: { kind?: "image" | "video"; contentType?: string; name?: string } = {}) {
    const kind = opts.kind ?? "image";
    const contentType = opts.contentType ?? "image/png";
    const ticket = await api.post("/api/v1/admin/media/sign", { kind, filename: opts.name ?? "x.png", contentType, bytes: buffer.length }, session.token);
    if (ticket.status !== 200) return { ticket, sent: null };
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)], { type: contentType }), opts.name ?? "x.png");
    const res = await fetch(api.base + ticket.body.url, { method: "POST", headers: { authorization: `Bearer ${session.token}` }, body: form });
    return { ticket, sent: { status: res.status, body: (await res.json()) as { url?: string; code?: string } } };
  }

  it("accept a real image, serve it with defensive headers, and let a lesson use it", async () => {
    const { sent } = await upload(admin, png);
    assert.equal(sent?.status, 200);
    const url = sent!.body.url!;
    assert.match(url, /\/uploads\/images\/\d{4}\/[0-9a-f]+\.png$/);
    const file = await fetch(url.replace(/^https?:\/\/[^/]+/, api.base));
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("content-type"), "image/png");
    assert.equal(file.headers.get("x-content-type-options"), "nosniff");
    assert.match(file.headers.get("content-security-policy") ?? "", /sandbox/);
    assert.match(file.headers.get("cache-control") ?? "", /immutable/);

    const c = await newDraftCourse();
    const m = await newModule(c.id);
    const lesson = await api.post(`/api/v1/admin/modules/${m}/lessons`, { title: "Diagram", contentType: "image", imageUrl: url }, admin.token);
    assert.equal(lesson.status, 201, lesson.text);
  });

  it("refuse files whose content is not what they claim (HTML dressed up as a PNG)", async () => {
    const { sent } = await upload(admin, Buffer.from("<html><script>alert(1)</script></html>"));
    assert.equal(sent?.status, 415);
    assert.equal(sent?.body.code, "MEDIA_TYPE_NOT_ALLOWED");
  });

  it("refuse disallowed types and sizes before any bytes are sent", async () => {
    assert.equal((await upload(admin, png, { contentType: "image/svg+xml", name: "a.svg" })).ticket.status, 415);
    assert.equal((await upload(admin, png, { contentType: "text/html", name: "a.html" })).ticket.status, 415);
    const huge = await api.post("/api/v1/admin/media/sign", { kind: "image", filename: "a.png", contentType: "image/png", bytes: 50 * 1024 * 1024 }, admin.token);
    assert.equal(huge.status, 413);
    assert.equal((await api.post("/api/v1/admin/media/sign", { kind: "image", filename: "a.png", contentType: "image/png", bytes: 0 }, admin.token)).status, 400);
  });

  it("do not expose the temp area or let a different trainer finish someone's upload", async () => {
    assert.equal((await fetch(`${api.base}/uploads/_tmp/anything`)).status, 404);
    assert.equal((await fetch(`${api.base}/uploads/..%2f..%2fetc%2fpasswd`)).status, 404);
    const ticket = await api.post("/api/v1/admin/media/sign", { kind: "image", filename: "x.png", contentType: "image/png", bytes: png.length }, admin.token);
    assert.equal(ticket.status, 200, ticket.text);
    const stranger = await api.post(ticket.body.url, {}, trainer.token);
    assert.equal(stranger.status, 403);
    assert.equal((await api.post("/api/v1/admin/media/upload/00000000-0000-0000-0000-000000000000", {}, admin.token)).status, 404);
    assert.equal((await api.post("/api/v1/admin/media/sign", { kind: "image", filename: "x.png", contentType: "image/png", bytes: 10 }, worker.token)).status, 403);
  });
});

describe("broadcast", () => {
  it("validates the message and reports delivery counts", async () => {
    assert.equal((await api.post("/api/v1/admin/notify/broadcast", { title: "", body: "x" }, admin.token)).status, 400);
    assert.equal((await api.post("/api/v1/admin/notify/broadcast", { title: "x".repeat(66), body: "x" }, admin.token)).status, 400);
    const res = await api.post("/api/v1/admin/notify/broadcast", { title: "Safety week", body: "Please finish the PPE course." }, admin.token);
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body).sort(), ["devices", "disabled", "failed", "sent"]);
    assert.ok((await auditActions()).includes("notify.broadcast"));
  });
});
