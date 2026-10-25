import { useEffect, useState } from "react";
import { download } from "../api";
import { formatNumber, timeAgo, formatDate } from "../format";
import { useAction, useDebounced, useApi, useDocumentTitle } from "../hooks";
import { useQueryState } from "../router";
import { useSession } from "../session";
import type { Page, WorkerRow } from "../types";
import { Badge, Button, EmptyState, ErrorNotice, Loading, PageHeader, Pagination, Panel, SelectField, TextField, useToast } from "../ui";

const STATUS = [
  { value: "all", label: "All learners" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Deactivated" },
] as const;
const SORT = [
  { value: "created", label: "Newest first" },
  { value: "name", label: "Name A–Z" },
  { value: "lastLogin", label: "Recently active" },
] as const;

export function Learners() {
  useDocumentTitle("Learners");
  const { isAdmin } = useSession();
  const toast = useToast();
  const [filters, setFilters] = useQueryState({ q: "", status: "all", sort: "created", page: "1" });
  const [search, setSearch] = useState(filters.q);
  const debounced = useDebounced(search.trim(), 350);

  // The search box is typed into freely; the address only follows once typing pauses.
  useEffect(() => {
    if (debounced !== filters.q) setFilters({ q: debounced, page: "1" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const page = Math.max(1, Number(filters.page) || 1);
  const list = useApi<Page<WorkerRow>>("/admin/workers", { q: filters.q, status: filters.status, sort: filters.sort, page, pageSize: 25 });

  const exportCsv = useAction(async () => {
    await download("/admin/workers/export.csv", { q: filters.q, status: filters.status === "all" ? undefined : filters.status }, "fastsewa-learners.csv");
    toast("Export downloaded");
  });

  const rows = list.data?.items ?? [];
  const filtered = filters.q !== "" || filters.status !== "all";

  return (
    <>
      <PageHeader
        title="Learners"
        subtitle="Everyone who has registered in the mobile app."
        actions={
          isAdmin ? (
            <Button icon="download" busy={exportCsv.busy} onClick={() => void exportCsv.run()}>
              Export CSV
            </Button>
          ) : null
        }
      />
      {exportCsv.error ? <ErrorNotice error={exportCsv.error} /> : null}
      <Panel flush>
        <div className="filters">
          <div className="grow">
            <TextField label="Search" type="search" value={search} onChange={setSearch} placeholder="Name, username, phone or e-mail" autoComplete="off" spellCheck={false} />
          </div>
          <SelectField label="Show" value={filters.status as "all"} onChange={(v) => setFilters({ status: v, page: "1" })} options={STATUS} />
          <SelectField label="Sort by" value={filters.sort as "created"} onChange={(v) => setFilters({ sort: v, page: "1" })} options={SORT} />
        </div>
        {list.error ? (
          <div className="panel-body">
            <ErrorNotice error={list.error} onRetry={list.reload} />
          </div>
        ) : null}
        {!list.data && !list.error ? <Loading /> : null}
        {list.data && rows.length === 0 ? (
          <EmptyState
            title={filtered ? "No learner matches" : "No learners yet"}
            action={
              filtered ? (
                <Button
                  onClick={() => {
                    setSearch("");
                    setFilters({ q: "", status: "all", page: "1" });
                  }}
                >
                  Clear the search
                </Button>
              ) : undefined
            }
          >
            {filtered ? "Try a different spelling, or search by phone number." : "Learners appear here after they register in the mobile app."}
          </EmptyState>
        ) : null}
        {rows.length > 0 ? (
          <div className="table-wrap" aria-busy={list.loading}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Status</th>
                  <th className="num">Courses</th>
                  <th className="num">Certificates</th>
                  <th>Last active</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id}>
                    <td className="primary-cell">
                      <a href={`#/learners/${w.id}`}>{w.displayName}</a>
                      <span className="sub">@{w.username}</span>
                    </td>
                    <td>
                      {w.phoneNumber ?? <span className="muted">—</span>}
                      {w.email ? <span className="sub">{w.email}</span> : null}
                    </td>
                    <td>
                      {w.isActive ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Deactivated</Badge>}
                      {w.mustChangePassword ? <span className="sub">Must change password</span> : null}
                    </td>
                    <td className="num">
                      {formatNumber(w.coursesCompleted)} / {formatNumber(w.coursesEnrolled)}
                    </td>
                    <td className="num">{formatNumber(w.certificates)}</td>
                    <td className="nowrap" title={w.lastLoginAt ?? undefined}>
                      {timeAgo(w.lastLoginAt)}
                    </td>
                    <td className="nowrap">{formatDate(w.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {list.data ? <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => setFilters({ page: String(p) })} /> : null}
      </Panel>
      <p className="muted small">“Courses” shows completed / enrolled. Deactivated learners cannot sign in and their sessions end immediately.</p>
    </>
  );
}
