-- Production hardening (expand step). Data is repaired BEFORE the new constraints are added,
-- so the migration also succeeds on a database that already holds real users.

-- Usernames become case-insensitive: rename accounts that differ only by case, then lower-case everything.
WITH ranked AS (
  SELECT id, username,
         row_number() OVER (PARTITION BY lower(username) ORDER BY created_at, id) AS rn
  FROM users
)
UPDATE users u
SET username = lower(r.username) || '_' || r.rn || substr(replace(u.id, '-', ''), 1, 4)
FROM ranked r
WHERE u.id = r.id AND r.rn > 1;--> statement-breakpoint
UPDATE users SET username = lower(username) WHERE username <> lower(username);--> statement-breakpoint

-- E-mail addresses: trim, lower-case; for duplicates keep the oldest account's address.
UPDATE users SET email = NULL WHERE email IS NOT NULL AND btrim(email) = '';--> statement-breakpoint
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY lower(btrim(email)) ORDER BY created_at, id) AS rn
  FROM users WHERE email IS NOT NULL
)
UPDATE users u SET email = NULL FROM ranked r WHERE u.id = r.id AND r.rn > 1;--> statement-breakpoint
UPDATE users SET email = lower(btrim(email)) WHERE email IS NOT NULL;--> statement-breakpoint

-- One quiz per module: re-point attempts to the oldest quiz, drop the extras.
UPDATE quiz_attempts a
SET quiz_id = s.keeper
FROM (
  SELECT id, first_value(id) OVER (PARTITION BY module_id ORDER BY created_at, id) AS keeper,
         row_number() OVER (PARTITION BY module_id ORDER BY created_at, id) AS rn
  FROM quizzes
) s
WHERE a.quiz_id = s.id AND s.rn > 1;--> statement-breakpoint
DELETE FROM quizzes
WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (PARTITION BY module_id ORDER BY created_at, id) AS rn FROM quizzes
  ) s WHERE rn > 1
);--> statement-breakpoint

-- One certificate per user and course: keep the earliest.
DELETE FROM certificates
WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (PARTITION BY user_id, course_id ORDER BY earned_at, id) AS rn FROM certificates
  ) s WHERE rn > 1
);--> statement-breakpoint

-- Refresh-token hashes must be unique.
DELETE FROM refresh_tokens a USING refresh_tokens b
WHERE a.token_hash = b.token_hash AND a.ctid > b.ctid;--> statement-breakpoint

-- Clamp values that the new CHECK constraints reject.
UPDATE course_enrollments SET completion_percent = LEAST(100, GREATEST(0, completion_percent));--> statement-breakpoint
UPDATE lesson_progress SET video_progress_seconds = GREATEST(0, video_progress_seconds);--> statement-breakpoint
UPDATE quizzes SET passing_score = LEAST(100, GREATEST(1, passing_score));--> statement-breakpoint
UPDATE quiz_questions SET correct_index = GREATEST(0, correct_index);--> statement-breakpoint
UPDATE quiz_attempts SET score = LEAST(100, GREATEST(0, score));--> statement-breakpoint
UPDATE lessons SET video_duration_seconds = NULL WHERE video_duration_seconds IS NOT NULL AND video_duration_seconds <= 0;--> statement-breakpoint
UPDATE courses SET duration_minutes = GREATEST(0, duration_minutes);--> statement-breakpoint

CREATE TABLE "audit_logs" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" varchar(36),
	"actor_username" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb,
	"ip" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_uploads" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"declared_bytes" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"url" text,
	"created_by" varchar(36),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "media_uploads_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "media_uploads_status_chk" CHECK ("media_uploads"."status" IN ('pending', 'ready'))
);
--> statement-breakpoint
CREATE TABLE "push_devices" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"token" text NOT NULL,
	"platform" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "push_devices_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "courses" DROP CONSTRAINT "courses_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "quiz_attempts" DROP CONSTRAINT "quiz_attempts_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "quiz_attempts" DROP CONSTRAINT "quiz_attempts_quiz_id_quizzes_id_fk";
--> statement-breakpoint
DROP INDEX "courses_published_idx";--> statement-breakpoint
DROP INDEX "lesson_progress_user_idx";--> statement-breakpoint
DROP INDEX "refresh_tokens_hash_idx";--> statement-breakpoint
DROP INDEX "users_username_idx";--> statement-breakpoint
DROP INDEX "users_email_idx";--> statement-breakpoint
DROP INDEX "lessons_module_idx";--> statement-breakpoint
DROP INDEX "modules_course_idx";--> statement-breakpoint
ALTER TABLE "certificates" ALTER COLUMN "earned_at" SET DATA TYPE timestamp with time zone USING "earned_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "certificates" ALTER COLUMN "earned_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "course_enrollments" ALTER COLUMN "enrolled_at" SET DATA TYPE timestamp with time zone USING "enrolled_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "course_enrollments" ALTER COLUMN "enrolled_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "course_enrollments" ALTER COLUMN "completed_at" SET DATA TYPE timestamp with time zone USING "completed_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "lesson_progress" ALTER COLUMN "completed_at" SET DATA TYPE timestamp with time zone USING "completed_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "lesson_progress" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "lesson_progress" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "lesson_progress" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "lesson_progress" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "lessons" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "lessons" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "module_progress" ALTER COLUMN "started_at" SET DATA TYPE timestamp with time zone USING "started_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "module_progress" ALTER COLUMN "started_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "module_progress" ALTER COLUMN "completed_at" SET DATA TYPE timestamp with time zone USING "completed_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "modules" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "modules" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "quiz_attempts" ALTER COLUMN "attempted_at" SET DATA TYPE timestamp with time zone USING "attempted_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "quiz_attempts" ALTER COLUMN "attempted_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "quizzes" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "quizzes" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "refresh_tokens" ALTER COLUMN "expires_at" SET DATA TYPE timestamp with time zone USING "expires_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "refresh_tokens" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "refresh_tokens" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_reset_expires_at" SET DATA TYPE timestamp with time zone USING "password_reset_expires_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "last_login_at" SET DATA TYPE timestamp with time zone USING "last_login_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN "issued_name" text;--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN "issued_course_title" text;--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "certificates" ADD COLUMN "revoked_reason" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD COLUMN "watched_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD COLUMN "last_heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "family_id" varchar(36) DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "session_started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "rotated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "replaced_by_id" varchar(36);--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "token_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_reset_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "consent_version" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "consent_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "media_uploads_status_idx" ON "media_uploads" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "push_devices_user_idx" ON "push_devices" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_user_course_key" ON "certificates" USING btree ("user_id","course_id");--> statement-breakpoint
CREATE INDEX "enrollment_course_idx" ON "course_enrollments" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "courses_listing_idx" ON "courses" USING btree ("is_published","sort_order");--> statement-breakpoint
CREATE INDEX "lesson_progress_lesson_idx" ON "lesson_progress" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "module_progress_module_idx" ON "module_progress" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX "quiz_attempts_user_quiz_idx" ON "quiz_attempts" USING btree ("user_id","quiz_id","attempted_at");--> statement-breakpoint
CREATE INDEX "quiz_questions_quiz_idx" ON "quiz_questions" USING btree ("quiz_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "quizzes_module_key" ON "quizzes" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_expires_idx" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "users_role_active_idx" ON "users" USING btree ("role","is_active");--> statement-breakpoint
CREATE INDEX "lessons_module_idx" ON "lessons" USING btree ("module_id","sort_order");--> statement-breakpoint
CREATE INDEX "modules_course_idx" ON "modules" USING btree ("course_id","sort_order");--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash");--> statement-breakpoint
ALTER TABLE "course_enrollments" ADD CONSTRAINT "enrollment_percent_chk" CHECK ("course_enrollments"."completion_percent" BETWEEN 0 AND 100);--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_duration_chk" CHECK ("courses"."duration_minutes" >= 0);--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_nonneg_chk" CHECK ("lesson_progress"."video_progress_seconds" >= 0 AND "lesson_progress"."watched_seconds" >= 0);--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_duration_chk" CHECK ("lessons"."video_duration_seconds" IS NULL OR "lessons"."video_duration_seconds" > 0);--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_score_chk" CHECK ("quiz_attempts"."score" BETWEEN 0 AND 100);--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_correct_idx_chk" CHECK ("quiz_questions"."correct_index" >= 0);--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_passing_score_chk" CHECK ("quizzes"."passing_score" BETWEEN 1 AND 100);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_lowercase_chk" CHECK ("users"."username" = lower("users"."username"));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("users"."email" IS NULL OR "users"."email" = lower("users"."email"));
--> statement-breakpoint

-- Backfill: certificates remember the holder's name and the course title as issued.
UPDATE certificates c
SET issued_name = u.display_name, issued_course_title = co.title
FROM users u, courses co
WHERE u.id = c.user_id AND co.id = c.course_id AND c.issued_name IS NULL;--> statement-breakpoint

-- Backfill: move the single per-user push token into push_devices (users.expo_push_token is now deprecated).
INSERT INTO push_devices (user_id, token)
SELECT id, expo_push_token FROM users
WHERE expo_push_token IS NOT NULL AND btrim(expo_push_token) <> ''
ON CONFLICT (token) DO NOTHING;
