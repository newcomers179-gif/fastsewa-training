/** Read-only numbers for the admin console: dashboard, per-course analytics, activity over time, audit log. */
import { count, desc, eq, sql } from "drizzle-orm";
import { auditLogs } from "@shared/schema";
import { db } from "../db";

// ─── CSV ─────────────────────────────────────────────────────────────────────
/**
 * One CSV cell. Cells that start with = + - @ (or a tab/CR) are executed as
 * formulas by Excel and Google Sheets, so a worker who registers as
 * `=HYPERLINK(...)` could attack whoever opens the export; those get a leading
 * apostrophe. Plain numbers and phone numbers (`+9198...`) are left alone.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  const harmless = /^\+?\d[\d.]*$/.test(s) || /^-\d[\d.]*$/.test(s);
  if (!harmless && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const csvLine = (cells: unknown[]): string => `${cells.map(csvCell).join(",")}\r\n`;

// ─── Dashboard ───────────────────────────────────────────────────────────────
export interface DashboardStats {
  totalWorkers: number;
  activeWorkers: number;
  newWorkers7d: number;
  activeLearners7d: number;
  totalCourses: number;
  draftCourses: number;
  totalEnrollments: number;
  completedEnrollments: number;
  completionRate: number;
  certificatesIssued: number;
}

export async function dashboardStats(): Promise<DashboardStats> {
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM users WHERE role = 'worker' AND deleted_at IS NULL)::int AS "totalWorkers",
      (SELECT count(*) FROM users WHERE role = 'worker' AND deleted_at IS NULL AND is_active)::int AS "activeWorkers",
      (SELECT count(*) FROM users WHERE role = 'worker' AND deleted_at IS NULL AND created_at > now() - interval '7 days')::int AS "newWorkers7d",
      (SELECT count(DISTINCT user_id) FROM lesson_progress WHERE updated_at > now() - interval '7 days')::int AS "activeLearners7d",
      (SELECT count(*) FROM courses WHERE is_published AND archived_at IS NULL)::int AS "totalCourses",
      (SELECT count(*) FROM courses WHERE NOT is_published AND archived_at IS NULL)::int AS "draftCourses",
      (SELECT count(*) FROM course_enrollments)::int AS "totalEnrollments",
      (SELECT count(*) FROM course_enrollments WHERE completed_at IS NOT NULL)::int AS "completedEnrollments",
      (SELECT count(*) FROM certificates WHERE revoked_at IS NULL)::int AS "certificatesIssued"
  `);
  const row = result.rows[0] as unknown as Omit<DashboardStats, "completionRate">;
  return {
    ...row,
    completionRate: row.totalEnrollments > 0 ? Math.round((row.completedEnrollments / row.totalEnrollments) * 100) : 0,
  };
}

// ─── Analytics ───────────────────────────────────────────────────────────────
export async function courseAnalytics() {
  const result = await db.execute(sql`
    SELECT c.id AS "courseId",
           c.title AS "courseTitle",
           c.is_published AS "isPublished",
           (c.archived_at IS NOT NULL) AS "isArchived",
           count(e.id)::int AS "enrolled",
           count(e.completed_at)::int AS "completed",
           COALESCE(round(avg(e.completion_percent))::int, 0) AS "averagePercent",
           (SELECT count(*) FROM certificates ce WHERE ce.course_id = c.id AND ce.revoked_at IS NULL)::int AS "certificates"
    FROM courses c
    LEFT JOIN course_enrollments e ON e.course_id = c.id
    GROUP BY c.id
    ORDER BY count(e.id) DESC, c.title
  `);
  return (
    result.rows as unknown as {
      courseId: string;
      courseTitle: string;
      isPublished: boolean;
      isArchived: boolean;
      enrolled: number;
      completed: number;
      averagePercent: number;
      certificates: number;
    }[]
  ).map((r) => ({ ...r, completionRate: r.enrolled > 0 ? Math.round((r.completed / r.enrolled) * 100) : 0 }));
}

/** New learners, enrolments and certificates per calendar day (India time), zero-filled. */
export async function activityByDay(days: number) {
  const result = await db.execute(sql`
    WITH days AS (
      SELECT d::date AS day
      FROM generate_series(
        (now() AT TIME ZONE 'Asia/Kolkata')::date - ${days - 1}::int,
        (now() AT TIME ZONE 'Asia/Kolkata')::date,
        interval '1 day'
      ) AS d
    ),
    signups AS (
      SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day, count(*)::int AS n
      FROM users
      WHERE role = 'worker' AND deleted_at IS NULL AND created_at > now() - (${days + 1}::int * interval '1 day')
      GROUP BY 1
    ),
    enrolments AS (
      SELECT (enrolled_at AT TIME ZONE 'Asia/Kolkata')::date AS day, count(*)::int AS n
      FROM course_enrollments
      WHERE enrolled_at > now() - (${days + 1}::int * interval '1 day')
      GROUP BY 1
    ),
    certs AS (
      SELECT (earned_at AT TIME ZONE 'Asia/Kolkata')::date AS day, count(*)::int AS n
      FROM certificates
      WHERE earned_at > now() - (${days + 1}::int * interval '1 day')
      GROUP BY 1
    )
    SELECT days.day::text AS day,
           COALESCE(signups.n, 0) AS "signups",
           COALESCE(enrolments.n, 0) AS "enrolments",
           COALESCE(certs.n, 0) AS "certificates"
    FROM days
    LEFT JOIN signups ON signups.day = days.day
    LEFT JOIN enrolments ON enrolments.day = days.day
    LEFT JOIN certs ON certs.day = days.day
    ORDER BY days.day
  `);
  return result.rows as unknown as { day: string; signups: number; enrolments: number; certificates: number }[];
}

// ─── Audit log ───────────────────────────────────────────────────────────────
export async function listAudit(q: { page: number; pageSize: number; action?: string }) {
  const where = q.action ? eq(auditLogs.action, q.action) : undefined;
  const [items, [total]] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: count() }).from(auditLogs).where(where),
  ]);
  return { items, total: total.n, page: q.page, pageSize: q.pageSize };
}

