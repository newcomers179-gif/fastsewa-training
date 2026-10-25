/**
 * Shared test plumbing: a real Postgres (TEST_DATABASE_URL), the real Express app on a random
 * port, a tiny JSON client and factories. Nothing is mocked — the point of these tests is that
 * the SQL, the constraints and the HTTP layer work together.
 *
 *   createdb fastsewa_test
 *   TEST_DATABASE_URL=postgresql://localhost/fastsewa_test npm test
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { courses, lessons, modules, quizQuestions, quizzes, users } from "@shared/schema";
import { createApp } from "../app";
import { hashPassword } from "../auth/password";
import { config } from "../config";
import { closeDatabase, db, pool } from "../db";
import type { Limiters } from "../middleware/rateLimit";
import { MIGRATIONS_DIR } from "../paths";

export const STRONG_PASSWORD = "Test#Pass-2026!";

let counter = 0;
/** A short unique token for usernames and slugs, stable within one process. */
export const uniq = (prefix = "t") => `${prefix}${Date.now().toString(36).slice(-4)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// ─── database ────────────────────────────────────────────────────────────────
export function assertTestDatabase(): void {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Create a throw-away database whose name contains \"test\" and run:\n" +
        "  TEST_DATABASE_URL=postgresql://localhost/fastsewa_test npm test"
    );
  }
  const name = decodeURIComponent(new URL(config.db.url).pathname.replace(/^\//, ""));
  if (!/test/i.test(name)) {
    throw new Error(`Refusing to run tests against database "${name}": tests wipe every table, so its name must contain "test".`);
  }
}

/** Applies the migrations and empties every table. Call once per test file, before the first test. */
export async function resetDatabase(): Promise<void> {
  assertTestDatabase();
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  const { rows } = await pool.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
  if (rows.length > 0) {
    await pool.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
}

export async function shutdown(): Promise<void> {
  await closeDatabase();
}

// ─── HTTP ────────────────────────────────────────────────────────────────────
export interface Res {
  status: number;
   
  body: any;
  headers: Headers;
  text: string;
}

export class Api {
  constructor(public readonly base: string) {}

  async request(method: string, path: string, opts: { body?: unknown; token?: string; headers?: Record<string, string>; raw?: boolean } = {}): Promise<Res> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["content-type"] ??= "application/json";
      body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
    }
    const res = await fetch(this.base + path, { method, headers, body, redirect: "manual" });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON (HTML, CSV, PDF) */
    }
    return { status: res.status, body: parsed, headers: res.headers, text };
  }

  get = (path: string, token?: string) => this.request("GET", path, { token });
  post = (path: string, body?: unknown, token?: string) => this.request("POST", path, { body: body ?? {}, token });
  put = (path: string, body: unknown, token?: string) => this.request("PUT", path, { body, token });
  patch = (path: string, body: unknown, token?: string) => this.request("PATCH", path, { body, token });
  delete = (path: string, body?: unknown, token?: string) => this.request("DELETE", path, { body, token });

  /** Binary download (certificate PDF). */
  async download(path: string, token?: string): Promise<{ status: number; bytes: Buffer; headers: Headers }> {
    const res = await fetch(this.base + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  }
}

export interface TestServer {
  api: Api;
  close(): Promise<void>;
}

export async function startServer(limiters?: Limiters): Promise<TestServer> {
  const server = createServer(createApp(limiters));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    api: new Api(`http://127.0.0.1:${port}`),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

// ─── factories ───────────────────────────────────────────────────────────────
export interface TestUser {
  id: string;
  username: string;
  password: string;
  role: "worker" | "trainer" | "admin";
  displayName: string;
}

export async function createUser(
  input: Partial<Pick<TestUser, "username" | "password" | "role" | "displayName">> & {
    mustChangePassword?: boolean;
    isActive?: boolean;
    email?: string | null;
    phoneNumber?: string | null;
  } = {}
): Promise<TestUser> {
  const username = input.username ?? uniq("u");
  const password = input.password ?? STRONG_PASSWORD;
  const role = input.role ?? "worker";
  const displayName = input.displayName ?? `Test ${username}`.replace(/[0-9_]/g, "x");
  const [row] = await db
    .insert(users)
    .values({
      username,
      passwordHash: await hashPassword(password),
      displayName,
      role,
      email: input.email ?? null,
      phoneNumber: input.phoneNumber ?? null,
      mustChangePassword: input.mustChangePassword ?? false,
      isActive: input.isActive ?? true,
      consentVersion: config.legal.consentVersion,
      consentAcceptedAt: new Date(),
    })
    .returning({ id: users.id });
  return { id: row.id, username, password, role, displayName };
}

export interface Session {
  token: string;
  refreshToken: string;
  user: TestUser;
}

export async function signIn(api: Api, user: TestUser): Promise<Session> {
  const res = await api.post("/api/v1/auth/login", { username: user.username, password: user.password });
  if (res.status !== 200) throw new Error(`login failed for ${user.username}: ${res.status} ${res.text}`);
  return { token: res.body.accessToken, refreshToken: res.body.refreshToken, user };
}

/** Creates a user with the given role and signs them in. */
export async function newSession(api: Api, role: TestUser["role"] = "worker"): Promise<Session> {
  return signIn(api, await createUser({ role }));
}

export interface CourseFixture {
  courseId: string;
  slug: string;
  modules: {
    id: string;
    lessonIds: string[];
    quizId: string | null;
    /** Index of the right option for every question, in order. */
    answers: number[];
  }[];
}

/**
 * A published course written straight to the database:
 *   module 1 — two required text lessons + a 2-question quiz (pass mark 70)
 *   module 2 — one required text lesson + a 1-question quiz        (when `modules` is 2)
 */
export async function createCourse(opts: { modules?: 1 | 2; published?: boolean; videoSeconds?: number } = {}): Promise<CourseFixture> {
  const slug = uniq("course-");
  const [course] = await db
    .insert(courses)
    .values({
      slug,
      title: `Course ${slug}`,
      description: "A course used by the automated tests.",
      category: "safety",
      difficulty: "beginner",
      isPublished: opts.published ?? true,
    })
    .returning({ id: courses.id });

  const layouts = opts.modules === 2 ? [2, 1] : [2];
  const fixtureModules: CourseFixture["modules"] = [];
  for (const [index, lessonCount] of layouts.entries()) {
    const [mod] = await db.insert(modules).values({ courseId: course.id, title: `Module ${index + 1}`, sortOrder: index }).returning({ id: modules.id });
    const lessonIds: string[] = [];
    for (let i = 0; i < lessonCount; i++) {
      const video = opts.videoSeconds && index === 0 && i === 0;
      const [lesson] = await db
        .insert(lessons)
        .values(
          video
            ? {
                moduleId: mod.id,
                title: `Video ${i + 1}`,
                contentType: "video" as const,
                videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                videoProvider: "youtube" as const,
                videoDurationSeconds: opts.videoSeconds,
                sortOrder: i,
              }
            : { moduleId: mod.id, title: `Lesson ${index + 1}.${i + 1}`, contentType: "text" as const, content: "Some text to read.", sortOrder: i }
        )
        .returning({ id: lessons.id });
      lessonIds.push(lesson.id);
    }
    const questionCount = index === 0 ? 2 : 1;
    const [quiz] = await db.insert(quizzes).values({ moduleId: mod.id, title: `Quiz ${index + 1}`, passingScore: 70 }).returning({ id: quizzes.id });
    await db.insert(quizQuestions).values(
      Array.from({ length: questionCount }, (_, q) => ({
        quizId: quiz.id,
        question: `Question ${q + 1}?`,
        options: ["right", "wrong", "also wrong"],
        correctIndex: 0,
        explanation: "Because.",
        sortOrder: q,
      }))
    );
    fixtureModules.push({ id: mod.id, lessonIds, quizId: quiz.id, answers: Array.from({ length: questionCount }, () => 0) });
  }
  return { courseId: course.id, slug, modules: fixtureModules };
}

/** Pretends `seconds` have passed since the learner's last heartbeat on a lesson (tests cannot wait for real time). */
export async function ageHeartbeat(userId: string, lessonId: string, seconds: number): Promise<void> {
  await pool.query(
    `UPDATE lesson_progress SET last_heartbeat_at = last_heartbeat_at - ($3 || ' seconds')::interval WHERE user_id = $1 AND lesson_id = $2`,
    [userId, lessonId, String(seconds)]
  );
}

/** Sends a first heartbeat, lets `seconds` "pass", then completes the lesson. */
export async function completeLesson(api: Api, session: Session, lessonId: string, seconds = 10): Promise<Res> {
  await api.post("/api/v1/progress/lesson", { lessonId }, session.token);
  await ageHeartbeat(session.user.id, lessonId, seconds);
  return api.post("/api/v1/progress/lesson", { lessonId, completed: true }, session.token);
}

