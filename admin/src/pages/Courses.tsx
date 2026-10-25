import { useMemo, useState } from "react";
import { CATEGORIES, DIFFICULTIES, type Category, type Difficulty } from "@shared/constants";
import { api } from "../api";
import { formatDate, formatNumber, plural, slugify, titleCase } from "../format";
import { useAction, useApi, useDocumentTitle } from "../hooks";
import { navigate, useQueryState } from "../router";
import { useSession } from "../session";
import type { CourseRow, CourseStatus } from "../types";
import { Badge, Button, EmptyState, ErrorNotice, Loading, Modal, PageHeader, Panel, SelectField, TextField, fieldError, useToast } from "../ui";

export const categoryOptions = CATEGORIES.map((value) => ({ value, label: titleCase(value) }));
export const difficultyOptions = DIFFICULTIES.map((value) => ({ value, label: titleCase(value) }));

export function StatusBadge({ status }: { status: CourseStatus }) {
  return status === "published" ? <Badge tone="good">Published</Badge> : status === "archived" ? <Badge>Archived</Badge> : <Badge tone="warn">Draft</Badge>;
}

function NewCourseDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [category, setCategory] = useState<Category>("safety");
  const [difficulty, setDifficulty] = useState<Difficulty>("beginner");
  const [description, setDescription] = useState("");
  const [problems, setProblems] = useState<Record<string, string>>({});

  const create = useAction(() => api.post<CourseRow>("/admin/courses", { title: title.trim(), slug: slug.trim(), category, difficulty, description: description.trim() }));
  const err = create.error;

  const submit = async () => {
    const found: Record<string, string> = {};
    if (title.trim().length < 2) found.title = "Give the course a title (at least 2 letters)";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim()) || slug.trim().length < 2) found.slug = "Use lowercase letters, numbers and single hyphens, like “working-at-height”";
    if (description.trim().length < 10) found.description = "Describe the course in at least a sentence (10 characters)";
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    const result = await create.run();
    if (result.ok) {
      toast("Course created — now add its modules and lessons");
      navigate(`/courses/${result.value.id}`);
    }
  };

  return (
    <Modal
      title="New course"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" busy={create.busy} onClick={() => void submit()}>
            Create course
          </Button>
        </>
      }
    >
      <form
        className="form-grid"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {err && Object.keys(err.fields).length === 0 ? (
          <div className="wide">
            <ErrorNotice error={err} />
          </div>
        ) : null}
        <TextField
          className="wide"
          label="Title"
          required
          value={title}
          maxLength={160}
          autoFocus
          onChange={(value) => {
            setTitle(value);
            if (!slugEdited) setSlug(slugify(value));
          }}
          error={problems.title ?? fieldError(err, "title")}
        />
        <TextField
          className="wide"
          label="Address (slug)"
          required
          value={slug}
          maxLength={80}
          spellCheck={false}
          autoComplete="off"
          onChange={(value) => {
            setSlug(value.toLowerCase());
            setSlugEdited(true);
          }}
          error={problems.slug ?? fieldError(err, "slug")}
          hint="Used in links to the course. It is filled in from the title; change it only if you need to."
        />
        <SelectField label="Trade" value={category} onChange={setCategory} options={categoryOptions} error={fieldError(err, "category")} />
        <SelectField label="Level" value={difficulty} onChange={setDifficulty} options={difficultyOptions} error={fieldError(err, "difficulty")} />
        <TextField
          className="wide"
          label="Description"
          required
          multiline
          rows={4}
          value={description}
          maxLength={4000}
          onChange={setDescription}
          error={problems.description ?? fieldError(err, "description")}
          hint="What a learner will be able to do after this course. You can add the Hindi version on the next screen."
        />
        <button type="submit" className="sr-only" tabIndex={-1}>
          Create
        </button>
      </form>
    </Modal>
  );
}

const STATUS_TABS: readonly { value: "all" | CourseStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "published", label: "Published" },
  { value: "draft", label: "Drafts" },
  { value: "archived", label: "Archived" },
];

export function Courses() {
  useDocumentTitle("Courses");
  const { isAdmin } = useSession();
  const list = useApi<CourseRow[]>("/admin/courses");
  const [filters, setFilters] = useQueryState({ status: "all" });
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const all = useMemo(() => list.data ?? [], [list.data]);
  const counts = useMemo(() => {
    const result: Record<string, number> = { all: all.length, published: 0, draft: 0, archived: 0 };
    for (const c of all) result[c.status] += 1;
    return result;
  }, [all]);

  const needle = search.trim().toLowerCase();
  const rows = all.filter((c) => (filters.status === "all" || c.status === filters.status) && (needle === "" || `${c.title} ${c.titleHi ?? ""} ${c.slug}`.toLowerCase().includes(needle)));

  return (
    <>
      <PageHeader
        title="Courses"
        subtitle="What learners can study in the app. Only published courses are visible to them."
        actions={
          isAdmin ? (
            <Button tone="primary" icon="plus" onClick={() => setCreating(true)}>
              New course
            </Button>
          ) : null
        }
      />
      <Panel flush>
        <div className="filters">
          <div className="segmented" role="group" aria-label="Show courses">
            {STATUS_TABS.map((tab) => (
              <button key={tab.value} type="button" aria-pressed={filters.status === tab.value} onClick={() => setFilters({ status: tab.value })}>
                {tab.label} ({counts[tab.value] ?? 0})
              </button>
            ))}
          </div>
          <div className="grow">
            <TextField label="Search" type="search" value={search} onChange={setSearch} placeholder="Title or address" autoComplete="off" spellCheck={false} />
          </div>
        </div>
        {list.error ? (
          <div className="panel-body">
            <ErrorNotice error={list.error} onRetry={list.reload} />
          </div>
        ) : null}
        {!list.data && !list.error ? <Loading /> : null}
        {list.data && all.length === 0 ? (
          <EmptyState
            title="No courses yet"
            action={
              isAdmin ? (
                <Button tone="primary" icon="plus" onClick={() => setCreating(true)}>
                  Create the first course
                </Button>
              ) : undefined
            }
          >
            Create a course, add modules and lessons, then publish it for learners.
          </EmptyState>
        ) : null}
        {list.data && all.length > 0 && rows.length === 0 ? <EmptyState title="No course matches">Try another status or search.</EmptyState> : null}
        {rows.length > 0 ? (
          <div className="table-wrap" aria-busy={list.loading}>
            <table className="table">
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Status</th>
                  <th>Content</th>
                  <th className="num">Enrolled</th>
                  <th className="num">Completed</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="primary-cell">
                      <a href={`#/courses/${c.id}`}>{c.title}</a>
                      <span className="sub">
                        {titleCase(c.category)} · {titleCase(c.difficulty)}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td>
                      {plural(c.moduleCount, "module")}
                      <span className="sub">{plural(c.lessonCount, "lesson")}</span>
                    </td>
                    <td className="num">{formatNumber(c.enrolled)}</td>
                    <td className="num">{formatNumber(c.completed)}</td>
                    <td className="nowrap">{formatDate(c.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>
      {creating ? <NewCourseDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}
