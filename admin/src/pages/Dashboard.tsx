import { useState } from "react";
import { TrendChart } from "../charts";
import { formatDay, formatNumber, plural } from "../format";
import { useApi, useDocumentTitle } from "../hooks";
import type { ActivityPoint, CourseAnalyticsRow, Dashboard as DashboardData } from "../types";
import { Badge, EmptyState, ErrorNotice, Loading, PageHeader, Panel, ProgressBar } from "../ui";

const RANGES = [14, 30, 90] as const;

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>
        {value}
        {note ? <span className="stat-note">{note}</span> : null}
      </dd>
    </div>
  );
}

export function Dashboard() {
  useDocumentTitle("Dashboard");
  const [days, setDays] = useState<number>(30);
  const stats = useApi<DashboardData>("/admin/dashboard");
  const activity = useApi<{ days: number; series: ActivityPoint[] }>("/admin/analytics/activity", { days });
  const courses = useApi<CourseAnalyticsRow[]>("/admin/analytics/courses");

  const d = stats.data;
  const series = activity.data?.series ?? [];

  return (
    <>
      <PageHeader title="Dashboard" subtitle="How learning is going across all sites." />
      {stats.error ? <ErrorNotice error={stats.error} onRetry={stats.reload} /> : null}
      {!d && !stats.error ? <Loading /> : null}
      {d ? (
        <dl className="stats" aria-label="Key numbers">
          <Stat label="Learners" value={formatNumber(d.totalWorkers)} note={`${formatNumber(d.activeWorkers)} active accounts`} />
          <Stat label="Learned this week" value={formatNumber(d.activeLearners7d)} note={`${formatNumber(d.newWorkers7d)} joined in 7 days`} />
          <Stat label="Courses live" value={formatNumber(d.totalCourses)} note={`${plural(d.draftCourses, "draft")}`} />
          <Stat label="Enrolments" value={formatNumber(d.totalEnrollments)} note={`${formatNumber(d.completedEnrollments)} completed (${d.completionRate}%)`} />
          <Stat label="Certificates in force" value={formatNumber(d.certificatesIssued)} />
        </dl>
      ) : null}

      <Panel
        title="Daily activity"
        actions={
          <div className="segmented" role="group" aria-label="Period">
            {RANGES.map((r) => (
              <button key={r} type="button" aria-pressed={days === r} onClick={() => setDays(r)}>
                {r} days
              </button>
            ))}
          </div>
        }
      >
        {activity.error ? <ErrorNotice error={activity.error} onRetry={activity.reload} /> : null}
        {!activity.data && !activity.error ? <Loading /> : null}
        {activity.data ? (
          <div className="stack">
            <div className={`trends${activity.loading ? " refreshing" : ""}`}>
              <TrendChart points={series.map((p) => ({ day: p.day, value: p.signups }))} noun={{ one: "new learner", many: "new learners" }} />
              <TrendChart points={series.map((p) => ({ day: p.day, value: p.enrolments }))} noun={{ one: "enrolment", many: "enrolments" }} />
              <TrendChart points={series.map((p) => ({ day: p.day, value: p.certificates }))} noun={{ one: "certificate", many: "certificates" }} />
            </div>
            <details>
              <summary>Show the numbers</summary>
              <div className="table-wrap">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th className="num">New learners</th>
                      <th className="num">Enrolments</th>
                      <th className="num">Certificates</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...series].reverse().map((p) => (
                      <tr key={p.day}>
                        <td>{formatDay(p.day)}</td>
                        <td className="num">{p.signups}</td>
                        <td className="num">{p.enrolments}</td>
                        <td className="num">{p.certificates}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        ) : null}
      </Panel>

      <Panel title="Courses" flush>
        {courses.error ? <ErrorNotice error={courses.error} onRetry={courses.reload} /> : null}
        {!courses.data && !courses.error ? <Loading /> : null}
        {courses.data && courses.data.length === 0 ? (
          <EmptyState title="No courses yet" action={<a className="btn btn-primary" href="#/courses">Create the first course</a>}>
            Learners see a course here once you publish it.
          </EmptyState>
        ) : null}
        {courses.data && courses.data.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Status</th>
                  <th className="num">Enrolled</th>
                  <th className="num">Completed</th>
                  <th>Completion</th>
                  <th className="num">Avg. progress</th>
                  <th className="num">Certificates</th>
                </tr>
              </thead>
              <tbody>
                {courses.data.map((c) => (
                  <tr key={c.courseId}>
                    <td className="primary-cell">
                      <a href={`#/courses/${c.courseId}`}>{c.courseTitle}</a>
                    </td>
                    <td>{c.isArchived ? <Badge>Archived</Badge> : c.isPublished ? <Badge tone="good">Published</Badge> : <Badge tone="warn">Draft</Badge>}</td>
                    <td className="num">{formatNumber(c.enrolled)}</td>
                    <td className="num">{formatNumber(c.completed)}</td>
                    <td>
                      <div className="bar-cell">
                        <ProgressBar percent={c.completionRate} label={`${c.courseTitle} completion`} />
                        <span>{c.completionRate}%</span>
                      </div>
                    </td>
                    <td className="num">{c.averagePercent}%</td>
                    <td className="num">{formatNumber(c.certificates)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>
    </>
  );
}
