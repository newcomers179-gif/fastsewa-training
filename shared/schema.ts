/**
 * Database schema (drizzle-orm / PostgreSQL). Server-only: the mobile app never
 * imports this file (it shares `validation.ts` and `errors.ts` instead).
 *
 * Conventions
 *  - every timestamp is `timestamptz` (the old `timestamp without time zone`
 *    columns silently shifted by the server's UTC offset);
 *  - usernames and e-mail addresses are stored lower-case (CHECK constraints
 *    enforce it) so "Ramesh" and "ramesh" can never be two different accounts;
 *  - business invariants that used to live only in application code
 *    (one certificate per user and course, one quiz per module, score ranges)
 *    are also enforced by the database.
 */
import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  real,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { CATEGORIES, CONTENT_TYPES, DIFFICULTIES, LANGS, ROLES } from "./constants";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().default(sql`now()`);
const pk = () =>
  varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`);

// ─── Enums ────────────────────────────────────────────────────────────────────
// The value lists live in ./constants (no database code there) so the mobile app and the admin
// console can use them without bundling drizzle-orm.
export const roleEnum = pgEnum("role", ROLES);
export const categoryEnum = pgEnum("category", CATEGORIES);
export const difficultyEnum = pgEnum("difficulty", DIFFICULTIES);
export const contentTypeEnum = pgEnum("content_type", CONTENT_TYPES);
export const langEnum = pgEnum("lang", LANGS);

export { CATEGORIES, CONTENT_TYPES, DIFFICULTIES, LANGS, ROLES };

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = pgTable(
  "users",
  {
    id: pk(),
    username: text("username").notNull().unique(),
    email: text("email").unique(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull().default("Worker"),
    role: roleEnum("role").notNull().default("worker"),
    avatarUrl: text("avatar_url"),
    phoneNumber: text("phone_number"),
    preferredLang: langEnum("preferred_lang").notNull().default("en"),
    /** @deprecated superseded by `push_devices`; kept one release for rollback, then dropped. */
    expoPushToken: text("expo_push_token"),
    isActive: boolean("is_active").notNull().default(true),
    /** Set after an admin-issued temporary password; blocks the API until the user picks their own. */
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    /** Bumped on password change/reset, deactivation, role change: invalidates every access token at once. */
    tokenVersion: integer("token_version").notNull().default(0),
    passwordResetTokenHash: text("password_reset_token_hash"),
    passwordResetExpiresAt: ts("password_reset_expires_at"),
    passwordResetAttempts: integer("password_reset_attempts").notNull().default(0),
    /** DPDP: which privacy-policy version the user accepted, and when. */
    consentVersion: text("consent_version"),
    consentAcceptedAt: ts("consent_accepted_at"),
    /** Set when the account was erased/anonymised (the row is kept so audit logs stay consistent). */
    deletedAt: ts("deleted_at"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().default(sql`now()`),
    lastLoginAt: ts("last_login_at"),
  },
  (t) => [
    index("users_role_active_idx").on(t.role, t.isActive),
    check("users_username_lowercase_chk", sql`${t.username} = lower(${t.username})`),
    check("users_email_lowercase_chk", sql`${t.email} IS NULL OR ${t.email} = lower(${t.email})`),
  ]
);

// ─── Courses ──────────────────────────────────────────────────────────────────
export const courses = pgTable(
  "courses",
  {
    id: pk(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    titleHi: text("title_hi"),
    description: text("description").notNull(),
    descriptionHi: text("description_hi"),
    category: categoryEnum("category").notNull(),
    difficulty: difficultyEnum("difficulty").notNull().default("beginner"),
    thumbnailUrl: text("thumbnail_url"),
    durationMinutes: integer("duration_minutes").notNull().default(0),
    isPublished: boolean("is_published").notNull().default(false),
    /** Archived courses disappear for learners but keep their history and certificates. */
    archivedAt: ts("archived_at"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: varchar("created_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    index("courses_listing_idx").on(t.isPublished, t.sortOrder),
    index("courses_category_idx").on(t.category),
    check("courses_duration_chk", sql`${t.durationMinutes} >= 0`),
  ]
);

// ─── Modules ──────────────────────────────────────────────────────────────────
export const modules = pgTable(
  "modules",
  {
    id: pk(),
    courseId: varchar("course_id", { length: 36 })
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    titleHi: text("title_hi"),
    description: text("description"),
    descriptionHi: text("description_hi"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("modules_course_idx").on(t.courseId, t.sortOrder)]
);

// ─── Lessons ──────────────────────────────────────────────────────────────────
export const lessons = pgTable(
  "lessons",
  {
    id: pk(),
    moduleId: varchar("module_id", { length: 36 })
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    titleHi: text("title_hi"),
    contentType: contentTypeEnum("content_type").notNull(),
    videoUrl: text("video_url"),
    /** "youtube" | "cloudinary" | "s3" | "local" | "external" — derived server-side from the URL. */
    videoProvider: text("video_provider"),
    videoDurationSeconds: integer("video_duration_seconds"),
    content: text("content"), // Markdown
    contentHi: text("content_hi"),
    imageUrl: text("image_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    isRequired: boolean("is_required").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    index("lessons_module_idx").on(t.moduleId, t.sortOrder),
    check("lessons_duration_chk", sql`${t.videoDurationSeconds} IS NULL OR ${t.videoDurationSeconds} > 0`),
  ]
);

// ─── Quizzes ──────────────────────────────────────────────────────────────────
export const quizzes = pgTable(
  "quizzes",
  {
    id: pk(),
    moduleId: varchar("module_id", { length: 36 })
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    passingScore: integer("passing_score").notNull().default(70),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("quizzes_module_key").on(t.moduleId),
    check("quizzes_passing_score_chk", sql`${t.passingScore} BETWEEN 1 AND 100`),
  ]
);

export const quizQuestions = pgTable(
  "quiz_questions",
  {
    id: pk(),
    quizId: varchar("quiz_id", { length: 36 })
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    questionHi: text("question_hi"),
    options: jsonb("options").notNull().$type<string[]>(),
    optionsHi: jsonb("options_hi").$type<string[]>(),
    correctIndex: integer("correct_index").notNull(),
    explanation: text("explanation"),
    explanationHi: text("explanation_hi"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("quiz_questions_quiz_idx").on(t.quizId, t.sortOrder),
    check("quiz_questions_correct_idx_chk", sql`${t.correctIndex} >= 0`),
  ]
);

// ─── Progress tracking ────────────────────────────────────────────────────────
export const lessonProgress = pgTable(
  "lesson_progress",
  {
    id: pk(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lessonId: varchar("lesson_id", { length: 36 })
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    completed: boolean("completed").notNull().default(false),
    /** Resume position. Never moves a completed lesson back to "not completed". */
    videoProgressSeconds: integer("video_progress_seconds").notNull().default(0),
    /** Seconds actually spent on the lesson, accumulated from server-timed heartbeats (anti-skip). */
    watchedSeconds: integer("watched_seconds").notNull().default(0),
    lastHeartbeatAt: ts("last_heartbeat_at"),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("lesson_progress_user_lesson_idx").on(t.userId, t.lessonId),
    index("lesson_progress_lesson_idx").on(t.lessonId),
    // "active learners in the last 7 days" on the dashboard
    index("lesson_progress_updated_idx").on(t.updatedAt),
    check("lesson_progress_nonneg_chk", sql`${t.videoProgressSeconds} >= 0 AND ${t.watchedSeconds} >= 0`),
  ]
);

export const moduleProgress = pgTable(
  "module_progress",
  {
    id: pk(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    moduleId: varchar("module_id", { length: 36 })
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    startedAt: ts("started_at").notNull().default(sql`now()`),
    completedAt: ts("completed_at"),
    quizScore: integer("quiz_score"),
    quizPassed: boolean("quiz_passed"),
  },
  (t) => [
    uniqueIndex("module_progress_user_module_idx").on(t.userId, t.moduleId),
    index("module_progress_module_idx").on(t.moduleId),
  ]
);

export const courseEnrollments = pgTable(
  "course_enrollments",
  {
    id: pk(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: varchar("course_id", { length: 36 })
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    enrolledAt: ts("enrolled_at").notNull().default(sql`now()`),
    completedAt: ts("completed_at"),
    completionPercent: real("completion_percent").notNull().default(0),
  },
  (t) => [
    uniqueIndex("enrollment_user_course_idx").on(t.userId, t.courseId),
    index("enrollment_course_idx").on(t.courseId),
    check("enrollment_percent_chk", sql`${t.completionPercent} BETWEEN 0 AND 100`),
  ]
);

// ─── Certificates ─────────────────────────────────────────────────────────────
export const certificates = pgTable(
  "certificates",
  {
    id: pk(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: varchar("course_id", { length: 36 })
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    certificateNumber: text("certificate_number").notNull().unique(),
    /** Name and course title as they were on the day of issue — later renames must not rewrite history. */
    issuedName: text("issued_name"),
    issuedCourseTitle: text("issued_course_title"),
    earnedAt: ts("earned_at").notNull().default(sql`now()`),
    revokedAt: ts("revoked_at"),
    revokedReason: text("revoked_reason"),
    pdfUrl: text("pdf_url"),
  },
  (t) => [
    uniqueIndex("certificates_user_course_key").on(t.userId, t.courseId),
    index("certificates_user_idx").on(t.userId),
  ]
);

// ─── Quiz attempts ────────────────────────────────────────────────────────────
export const quizAttempts = pgTable(
  "quiz_attempts",
  {
    id: pk(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    quizId: varchar("quiz_id", { length: 36 })
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    answers: jsonb("answers").notNull().$type<number[]>(),
    score: integer("score").notNull(),
    passed: boolean("passed").notNull(),
    attemptedAt: ts("attempted_at").notNull().default(sql`now()`),
  },
  (t) => [
    index("quiz_attempts_user_quiz_idx").on(t.userId, t.quizId, t.attemptedAt),
    check("quiz_attempts_score_chk", sql`${t.score} BETWEEN 0 AND 100`),
  ]
);

// ─── Sessions (refresh tokens) ────────────────────────────────────────────────
/**
 * Refresh tokens are opaque random strings; only their SHA-256 is stored.
 * Each login starts a "family"; every refresh rotates the token inside the
 * family. Presenting an already-rotated token (outside a short network-retry
 * grace window) revokes the whole family — the signature of a stolen token.
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: pk(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    familyId: varchar("family_id", { length: 36 })
      .notNull()
      .default(sql`gen_random_uuid()`),
    sessionStartedAt: ts("session_started_at").notNull().default(sql`now()`),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    lastUsedAt: ts("last_used_at"),
    rotatedAt: ts("rotated_at"),
    revokedAt: ts("revoked_at"),
    replacedById: varchar("replaced_by_id", { length: 36 }),
    userAgent: text("user_agent"),
  },
  (t) => [
    index("refresh_tokens_user_idx").on(t.userId),
    index("refresh_tokens_family_idx").on(t.familyId),
    index("refresh_tokens_expires_idx").on(t.expiresAt),
    // the janitor deletes by these three columns; partial indexes keep it cheap on a large table
    index("refresh_tokens_rotated_idx").on(t.rotatedAt).where(sql`${t.rotatedAt} IS NOT NULL`),
    index("refresh_tokens_revoked_idx").on(t.revokedAt).where(sql`${t.revokedAt} IS NOT NULL`),
  ]
);

// ─── Push devices ─────────────────────────────────────────────────────────────
export const pushDevices = pgTable(
  "push_devices",
  {
    id: pk(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    platform: text("platform"),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().default(sql`now()`),
    /** Set when Expo reports DeviceNotRegistered; such tokens are never used again. */
    disabledAt: ts("disabled_at"),
  },
  (t) => [index("push_devices_user_idx").on(t.userId)]
);

// ─── Media uploads ────────────────────────────────────────────────────────────
export const mediaUploads = pgTable(
  "media_uploads",
  {
    id: pk(),
    provider: text("provider").notNull(),
    kind: text("kind").notNull(), // "image" | "video"
    objectKey: text("object_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    declaredBytes: integer("declared_bytes"),
    status: text("status").notNull().default("pending"), // "pending" | "ready"
    url: text("url"),
    createdBy: varchar("created_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    completedAt: ts("completed_at"),
  },
  (t) => [
    index("media_uploads_status_idx").on(t.status, t.createdAt),
    check("media_uploads_status_chk", sql`${t.status} IN ('pending', 'ready')`),
  ]
);

// ─── Audit log ────────────────────────────────────────────────────────────────
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: pk(),
    actorId: varchar("actor_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    actorUsername: text("actor_username"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ip: text("ip"),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_created_idx").on(t.createdAt),
    index("audit_logs_target_idx").on(t.targetType, t.targetId),
    index("audit_logs_actor_idx").on(t.actorId),
  ]
);

// ─── Relations ────────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  enrollments: many(courseEnrollments),
  lessonProgress: many(lessonProgress),
  moduleProgress: many(moduleProgress),
  certificates: many(certificates),
  quizAttempts: many(quizAttempts),
  pushDevices: many(pushDevices),
}));

export const coursesRelations = relations(courses, ({ many }) => ({
  modules: many(modules),
  enrollments: many(courseEnrollments),
  certificates: many(certificates),
}));

export const modulesRelations = relations(modules, ({ one, many }) => ({
  course: one(courses, { fields: [modules.courseId], references: [courses.id] }),
  lessons: many(lessons),
  quizzes: many(quizzes),
  progress: many(moduleProgress),
}));

export const lessonsRelations = relations(lessons, ({ one, many }) => ({
  module: one(modules, { fields: [lessons.moduleId], references: [modules.id] }),
  progress: many(lessonProgress),
}));

export const quizzesRelations = relations(quizzes, ({ one, many }) => ({
  module: one(modules, { fields: [quizzes.moduleId], references: [modules.id] }),
  questions: many(quizQuestions),
  attempts: many(quizAttempts),
}));

// ─── Types ────────────────────────────────────────────────────────────────────
export type Role = (typeof ROLES)[number];
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Course = typeof courses.$inferSelect;
export type InsertCourse = typeof courses.$inferInsert;
export type Module = typeof modules.$inferSelect;
export type Lesson = typeof lessons.$inferSelect;
export type Quiz = typeof quizzes.$inferSelect;
export type QuizQuestion = typeof quizQuestions.$inferSelect;
export type Certificate = typeof certificates.$inferSelect;
export type LessonProgress = typeof lessonProgress.$inferSelect;
export type ModuleProgress = typeof moduleProgress.$inferSelect;
export type CourseEnrollment = typeof courseEnrollments.$inferSelect;
export type QuizAttempt = typeof quizAttempts.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type PushDevice = typeof pushDevices.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
