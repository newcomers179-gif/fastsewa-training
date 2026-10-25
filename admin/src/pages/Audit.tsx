import { formatDateTime, humanizeAction } from "../format";
import { useApi, useDocumentTitle } from "../hooks";
import { useQueryState } from "../router";
import type { AuditEntry, Page } from "../types";
import { Badge, EmptyState, ErrorNotice, Loading, PageHeader, Pagination, Panel, SelectField } from "../ui";

/** Every action the server records, grouped the way people think about them. */
const ACTIONS: readonly { group: string; actions: readonly string[] }[] = [
  { group: "Learners", actions: ["worker.updated", "worker.activated", "worker.deactivated", "worker.password_reset", "worker.erased", "workers.export", "account.erased"] },
  { group: "Staff", actions: ["staff.created", "staff.updated", "staff.password_reset"] },
  { group: "Courses", actions: ["course.created", "course.updated", "course.published", "course.unpublished", "course.archived", "course.unarchived", "course.deleted"] },
  { group: "Modules, lessons and quizzes", actions: ["module.created", "module.updated", "module.reordered", "module.deleted", "lesson.created", "lesson.updated", "lesson.reordered", "lesson.deleted", "quiz.saved", "quiz.deleted"] },
  { group: "Certificates and messages", actions: ["certificate.revoked", "certificate.reinstated", "notify.broadcast"] },
  { group: "Uploads", actions: ["media.upload_started", "media.uploaded"] },
];

const OPTIONS = [{ value: "all", label: "All actions" }, ...ACTIONS.flatMap((g) => g.actions.map((a) => ({ value: a, label: `${g.group}: ${humanizeAction(a)}` })))];

/** Where to look at the thing the action was about, when the console has a page for it. */
function targetHref(entry: AuditEntry): string | null {
  if (!entry.targetId) return null;
  if (entry.targetType === "course" && entry.action !== "course.deleted") return `#/courses/${entry.targetId}`;
  if (entry.action.startsWith("worker.") && entry.action !== "worker.erased") return `#/learners/${entry.targetId}`;
  return null;
}

function summarise(metadata: Record<string, unknown> | null): string {
  if (!metadata) return "";
  return Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join(" · ");
}

export function Audit() {
  useDocumentTitle("Audit log");
  const [filters, setFilters] = useQueryState({ action: "all", page: "1" });
  const page = Math.max(1, Number(filters.page) || 1);
  const list = useApi<Page<AuditEntry>>("/admin/audit", { page, pageSize: 50, action: filters.action === "all" ? undefined : filters.action });
  const rows = list.data?.items ?? [];

  return (
    <>
      <PageHeader title="Audit log" subtitle="Who changed what, newest first. Entries cannot be edited or deleted from the console." />
      <Panel flush>
        <div className="filters">
          <SelectField label="Show" value={filters.action} onChange={(action) => setFilters({ action, page: "1" })} options={OPTIONS} />
        </div>
        {list.error ? (
          <div className="panel-body">
            <ErrorNotice error={list.error} onRetry={list.reload} />
          </div>
        ) : null}
        {!list.data && !list.error ? <Loading /> : null}
        {list.data && rows.length === 0 ? <EmptyState title="Nothing recorded">{filters.action === "all" ? "Actions appear here as staff use the console." : "No entries for this action."}</EmptyState> : null}
        {rows.length > 0 ? (
          <div className="table-wrap" aria-busy={list.loading}>
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => {
                  const link = targetHref(entry);
                  const details = summarise(entry.metadata);
                  return (
                    <tr key={entry.id}>
                      <td className="nowrap">{formatDateTime(entry.createdAt)}</td>
                      <td>{entry.actorUsername ? <>@{entry.actorUsername}</> : <span className="muted">The learner themselves</span>}</td>
                      <td>
                        {link ? <a href={link}>{humanizeAction(entry.action)}</a> : humanizeAction(entry.action)}
                        <span className="sub mono">{entry.action}</span>
                      </td>
                      <td>
                        {details ? <span className="small">{details}</span> : <span className="muted">—</span>}
                        <span className="sub">
                          {entry.ip ? <>IP {entry.ip}</> : null}
                          {entry.requestId ? <> · ref {entry.requestId}</> : null}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {list.data ? <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => setFilters({ page: String(p) })} /> : null}
      </Panel>
      <p className="muted small">
        <Badge tone="info">Tip</Badge> Quote the “ref” number when asking a developer to look up a request in the server logs.
      </p>
    </>
  );
}
