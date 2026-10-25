import { useState } from "react";
import type { Category, Difficulty } from "@shared/constants";
import { api, ApiError } from "../api";
import { formatDuration, plural, timeAgo, titleCase } from "../format";
import { useAction, useApi, useDocumentTitle } from "../hooks";
import { MediaField } from "../media";
import { navigate } from "../router";
import { useSession } from "../session";
import type { CourseTree, LessonSummary, MediaConfig, ModuleNode } from "../types";
import { Badge, Button, EmptyState, ErrorNotice, Icon, IconButton, Loading, Notice, PageHeader, Panel, SelectField, TextField, describeError, fieldError, useConfirm, useToast, type IconName } from "../ui";
import { categoryOptions, difficultyOptions, StatusBadge } from "./Courses";
import { LessonDialog } from "./course/LessonDialog";
import { ModuleDialog } from "./course/ModuleDialog";
import { QuizDialog } from "./course/QuizDialog";

// ─── course details ──────────────────────────────────────────────────────────
interface DetailsDraft {
  title: string;
  titleHi: string;
  slug: string;
  category: Category;
  difficulty: Difficulty;
  description: string;
  descriptionHi: string;
  thumbnailUrl: string;
  durationMinutes: string;
  sortOrder: string;
}

const detailsOf = (c: CourseTree): DetailsDraft => ({
  title: c.title,
  titleHi: c.titleHi ?? "",
  slug: c.slug,
  category: c.category,
  difficulty: c.difficulty,
  description: c.description,
  descriptionHi: c.descriptionHi ?? "",
  thumbnailUrl: c.thumbnailUrl ?? "",
  durationMinutes: String(c.durationMinutes),
  sortOrder: String(c.sortOrder),
});

const wholeNumber = (text: string, max: number): number | null => {
  const n = Number(text);
  return text.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};

const bodyOf = (d: DetailsDraft) => ({
  title: d.title.trim(),
  titleHi: d.titleHi.trim() || null,
  slug: d.slug.trim(),
  category: d.category,
  difficulty: d.difficulty,
  description: d.description.trim(),
  descriptionHi: d.descriptionHi.trim() || null,
  thumbnailUrl: d.thumbnailUrl.trim() || null,
  durationMinutes: wholeNumber(d.durationMinutes, 100_000) ?? 0,
  sortOrder: wholeNumber(d.sortOrder, 100_000) ?? 0,
});

function CourseDetails({ course, media, onSaved }: { course: CourseTree; media: MediaConfig | undefined; onSaved: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<DetailsDraft>(() => detailsOf(course));
  const [problems, setProblems] = useState<Record<string, string>>({});
  const set = <K extends keyof DetailsDraft>(key: K, value: DetailsDraft[K]) => setD((current) => ({ ...current, [key]: value }));

  const save = useAction(() => api.put(`/admin/courses/${course.id}`, bodyOf(d)));
  const dirty = JSON.stringify(bodyOf(d)) !== JSON.stringify(bodyOf(detailsOf(course)));
  const err = save.error;
  const shown = (field: string) => problems[field] ?? fieldError(err, field);

  const submit = async () => {
    const found: Record<string, string> = {};
    if (d.title.trim().length < 2) found.title = "Give the course a title (at least 2 letters)";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.slug.trim()) || d.slug.trim().length < 2) found.slug = "Use lowercase letters, numbers and single hyphens";
    if (d.description.trim().length < 10) found.description = "Describe the course in at least a sentence (10 characters)";
    if (wholeNumber(d.durationMinutes, 100_000) === null) found.durationMinutes = "Enter a whole number of minutes";
    if (wholeNumber(d.sortOrder, 100_000) === null) found.sortOrder = "Enter a whole number";
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    if ((await save.run()).ok) {
      toast("Course details saved");
      onSaved();
    }
  };

  return (
    <Panel
      title="Course details"
      actions={
        <Button tone="primary" busy={save.busy} disabled={!dirty} onClick={() => void submit()}>
          Save details
        </Button>
      }
    >
      {err && Object.keys(err.fields).length === 0 ? <ErrorNotice error={err} /> : null}
      <form
        className="form-grid cols-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <TextField className="span-2" label="Title" required maxLength={160} value={d.title} onChange={(v) => set("title", v)} error={shown("title")} />
        <SelectField label="Trade" value={d.category} onChange={(v) => set("category", v)} options={categoryOptions} error={shown("category")} />
        <TextField className="span-2" label="Title in Hindi" lang="hi" maxLength={160} value={d.titleHi} onChange={(v) => set("titleHi", v)} error={shown("titleHi")} />
        <SelectField label="Level" value={d.difficulty} onChange={(v) => set("difficulty", v)} options={difficultyOptions} error={shown("difficulty")} />
        <TextField className="wide" label="Description" required multiline rows={4} maxLength={4000} value={d.description} onChange={(v) => set("description", v)} error={shown("description")} />
        <TextField className="wide" label="Description in Hindi" lang="hi" multiline rows={4} maxLength={4000} value={d.descriptionHi} onChange={(v) => set("descriptionHi", v)} error={shown("descriptionHi")} />
        <div className="wide">
          <MediaField kind="image" label="Course picture" value={d.thumbnailUrl} trustedUrl={course.thumbnailUrl ?? ""} onChange={(v) => set("thumbnailUrl", v)} config={media} folder="thumbnails" error={shown("thumbnailUrl")} hint="Shown on the course card in the app. Optional." />
        </div>
        <TextField label="Estimated time (minutes)" type="number" inputMode="numeric" value={d.durationMinutes} onChange={(v) => set("durationMinutes", v)} error={shown("durationMinutes")} hint="Shown to learners on the course card." />
        <TextField label="Display order" type="number" inputMode="numeric" value={d.sortOrder} onChange={(v) => set("sortOrder", v)} error={shown("sortOrder")} hint="Lower numbers are listed first." />
        <TextField className="wide" label="Address (slug)" required maxLength={80} spellCheck={false} autoComplete="off" value={d.slug} onChange={(v) => set("slug", v.toLowerCase())} error={shown("slug")} hint="Used in links to the course. Change it only if you must." />
        <button type="submit" className="sr-only" tabIndex={-1}>
          Save
        </button>
      </form>
    </Panel>
  );
}

function CourseFacts({ course }: { course: CourseTree }) {
  return (
    <Panel title="Course details">
      <dl className="facts">
        <div>
          <dt>Trade · level</dt>
          <dd>
            {titleCase(course.category)} · {titleCase(course.difficulty)}
          </dd>
        </div>
        <div>
          <dt>Description</dt>
          <dd className="pre-line">{course.description}</dd>
        </div>
        {course.titleHi || course.descriptionHi ? (
          <div>
            <dt>In Hindi</dt>
            <dd lang="hi" className="pre-line">
              {[course.titleHi, course.descriptionHi].filter(Boolean).join("\n")}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Estimated time</dt>
          <dd>{course.durationMinutes} minutes</dd>
        </div>
      </dl>
    </Panel>
  );
}

// ─── structure ───────────────────────────────────────────────────────────────
const LESSON_ICON: Record<LessonSummary["contentType"], IconName> = { video: "video", text: "text", image: "image", quiz: "quiz" };
const LESSON_NAME: Record<LessonSummary["contentType"], string> = { video: "Video", text: "Reading", image: "Picture", quiz: "Quiz (older format)" };

function lessonMeta(l: LessonSummary): string {
  const parts: string[] = [LESSON_NAME[l.contentType]];
  if (l.contentType === "video") {
    if (l.videoDurationSeconds) parts.push(formatDuration(l.videoDurationSeconds));
    if (l.videoProvider) parts.push(l.videoProvider === "youtube" ? "YouTube" : "Uploaded");
  }
  if (!l.isRequired) parts.push("optional");
  return parts.join(" · ");
}

const lessonIncomplete = (l: LessonSummary): string | null => {
  if (l.contentType === "video" && (!l.videoUrl || !l.videoDurationSeconds)) return "Needs a video link and length";
  if (l.contentType === "text" && !l.hasText) return "No text yet";
  if (l.contentType === "image" && !l.imageUrl) return "No picture yet";
  return null;
};

type DialogState = null | { kind: "module"; module?: ModuleNode } | { kind: "lesson"; module: ModuleNode; lessonId?: string } | { kind: "quiz"; module: ModuleNode };

export function CourseEditor({ id }: { id: string }) {
  const { isAdmin } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const tree = useApi<CourseTree>(`/admin/courses/${id}`);
  const media = useApi<MediaConfig>("/admin/media/config");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  const course = tree.data;
  useDocumentTitle(course?.title ?? "Course");

  const publish = useAction(async (published: boolean) => {
    await api.patch(`/admin/courses/${id}/publish`, { published });
    toast(published ? "Course published — learners can see it now" : "Course unpublished — hidden from new learners");
    tree.reload();
  });

  /** Runs one change, refreshes the course, and reports a failure in a toast. */
  const act = async (work: () => Promise<unknown>, success?: string): Promise<boolean> => {
    setBusy(true);
    try {
      await work();
      if (success) toast(success);
      tree.reload();
      return true;
    } catch (failure) {
      toast(describeError(failure), "bad");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (tree.error instanceof ApiError && tree.error.status === 404) {
    return (
      <EmptyState title="Course not found" action={<a className="btn btn-secondary" href="#/courses">Back to courses</a>}>
        It may have been deleted.
      </EmptyState>
    );
  }
  if (!course) return tree.error ? <ErrorNotice error={tree.error} onRetry={tree.reload} /> : <Loading />;

  const modules = course.modules;
  const lessonTotal = modules.reduce((sum, m) => sum + m.lessons.length, 0);
  const closeDialog = () => setDialog(null);
  const saved = (message: string) => () => {
    closeDialog();
    toast(message);
    tree.reload();
  };

  const moveModule = (index: number, delta: -1 | 1) => {
    const ids = modules.map((m) => m.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    void act(() => api.post(`/admin/courses/${id}/modules/reorder`, { ids }));
  };
  const moveLesson = (m: ModuleNode, index: number, delta: -1 | 1) => {
    const ids = m.lessons.map((l) => l.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    void act(() => api.post(`/admin/modules/${m.id}/lessons/reorder`, { ids }));
  };

  const deleteModule = async (m: ModuleNode) => {
    const ok = await confirm({
      title: `Delete module “${m.title}”?`,
      body: `This removes the module${m.lessons.length > 0 ? `, its ${plural(m.lessons.length, "lesson")}` : ""}${m.quiz ? " and its quiz" : ""}. It is refused if learners already have progress in it.`,
      confirmLabel: "Delete module",
      tone: "danger",
    });
    if (ok) await act(() => api.del(`/admin/modules/${m.id}`), "Module deleted");
  };
  const deleteLesson = async (l: LessonSummary) => {
    const ok = await confirm({ title: `Delete lesson “${l.title}”?`, body: "It is refused if a learner has already opened it; mark it optional instead.", confirmLabel: "Delete lesson", tone: "danger" });
    if (ok) await act(() => api.del(`/admin/lessons/${l.id}`), "Lesson deleted");
  };
  const deleteQuiz = async (m: ModuleNode) => {
    const ok = await confirm({ title: `Remove the quiz from “${m.title}”?`, body: "Learners will no longer need to pass a quiz to finish this module. Their earlier attempts are kept.", confirmLabel: "Remove quiz", tone: "danger" });
    if (ok) await act(() => api.del(`/admin/modules/${m.id}/quiz`), "Quiz removed");
  };

  const archive = async (archived: boolean) => {
    const ok = await confirm({
      title: archived ? `Archive “${course.title}”?` : `Restore “${course.title}”?`,
      body: archived
        ? "Learners can no longer find or start it. Enrolments, progress and certificates are kept, so you can restore it later."
        : "It returns as a draft. Publish it again when it is ready for learners.",
      confirmLabel: archived ? "Archive course" : "Restore course",
      tone: archived ? "danger" : "primary",
    });
    if (ok) await act(() => api.patch(`/admin/courses/${id}/${archived ? "archive" : "unarchive"}`), archived ? "Course archived" : "Course restored");
  };
  const remove = async () => {
    const ok = await confirm({
      title: `Delete “${course.title}” for good?`,
      body: "This deletes the course with all its modules, lessons and quizzes. It is refused if anyone is enrolled or holds a certificate; archive it instead.",
      confirmLabel: "Delete course",
      tone: "danger",
    });
    if (ok && (await act(() => api.del(`/admin/courses/${id}`)))) {
      toast("Course deleted");
      navigate("/courses");
    }
  };

  return (
    <>
      <PageHeader
        back={{ href: "#/courses", label: "All courses" }}
        title={
          <>
            {course.title} <StatusBadge status={course.status} />
          </>
        }
        subtitle={
          <span className="meta-row">
            <span>
              {plural(modules.length, "module")} · {plural(lessonTotal, "lesson")}
            </span>
            <span>
              Address <span className="mono">{course.slug}</span>
            </span>
            <span>Updated {timeAgo(course.updatedAt)}</span>
          </span>
        }
        actions={
          isAdmin ? (
            <>
              {course.status === "draft" ? (
                <Button tone="primary" busy={publish.busy} onClick={() => void publish.run(true)}>
                  Publish
                </Button>
              ) : null}
              {course.status === "published" ? (
                <Button busy={publish.busy} onClick={() => void publish.run(false)}>
                  Unpublish
                </Button>
              ) : null}
              {course.status === "archived" ? <Button onClick={() => void archive(false)}>Restore from archive</Button> : <Button onClick={() => void archive(true)}>Archive</Button>}
              <Button tone="danger" icon="trash" onClick={() => void remove()}>
                Delete
              </Button>
            </>
          ) : null
        }
      />
      {publish.error ? <ErrorNotice error={publish.error} /> : null}
      {!isAdmin ? <Notice tone="info">You can look at this course. Only administrators can change it.</Notice> : null}
      {course.status === "archived" ? <Notice tone="warn">This course is archived: learners cannot find or start it. Their progress and certificates are kept.</Notice> : null}

      <div className="detail-grid">{isAdmin ? <CourseDetails key={course.updatedAt} course={course} media={media.data} onSaved={tree.reload} /> : <CourseFacts course={course} />}</div>

      <div className="section-head">
        <h2>Modules and lessons</h2>
        {isAdmin ? (
          <Button icon="plus" onClick={() => setDialog({ kind: "module" })}>
            Add module
          </Button>
        ) : null}
      </div>

      {modules.length === 0 ? (
        <Panel>
          <EmptyState
            title="No modules yet"
            action={
              isAdmin ? (
                <Button tone="primary" icon="plus" onClick={() => setDialog({ kind: "module" })}>
                  Add the first module
                </Button>
              ) : undefined
            }
          >
            A course is made of modules; each module has lessons (video, reading or picture) and can end with a quiz.
          </EmptyState>
        </Panel>
      ) : null}

      <div aria-busy={tree.loading || busy}>
        {modules.map((m, mi) => (
          <section className="module" key={m.id} aria-label={`Module ${mi + 1}: ${m.title}`}>
            <div className="module-head">
              <div className="module-title">
                <Badge>Module {mi + 1}</Badge>
                <h3>{m.title}</h3>
                {m.titleHi ? (
                  <span className="muted" lang="hi">
                    {m.titleHi}
                  </span>
                ) : null}
              </div>
              {isAdmin ? (
                <div className="row-actions">
                  <IconButton icon="up" label={`Move module ${mi + 1} up`} disabled={busy || mi === 0} onClick={() => moveModule(mi, -1)} />
                  <IconButton icon="down" label={`Move module ${mi + 1} down`} disabled={busy || mi === modules.length - 1} onClick={() => moveModule(mi, 1)} />
                  <IconButton icon="edit" label={`Edit module ${mi + 1}`} onClick={() => setDialog({ kind: "module", module: m })} />
                  <IconButton icon="trash" label={`Delete module ${mi + 1}`} disabled={busy} onClick={() => void deleteModule(m)} />
                </div>
              ) : null}
            </div>
            {m.description ? <p className="module-desc muted">{m.description}</p> : null}

            {m.lessons.length === 0 ? <p className="empty-inline">No lessons in this module yet.</p> : null}
            {m.lessons.map((l, li) => {
              const incomplete = lessonIncomplete(l);
              return (
                <div className="lesson-row" key={l.id}>
                  <span className="type-icon">
                    <Icon name={LESSON_ICON[l.contentType]} />
                  </span>
                  <div className="lesson-name">
                    <strong title={l.title}>{l.title}</strong>
                    <span className="meta">
                      {lessonMeta(l)}
                      {incomplete ? (
                        <>
                          {" "}
                          <Badge tone="warn">{incomplete}</Badge>
                        </>
                      ) : null}
                    </span>
                  </div>
                  {isAdmin ? (
                    <div className="row-actions">
                      <IconButton icon="up" label={`Move “${l.title}” up`} disabled={busy || li === 0} onClick={() => moveLesson(m, li, -1)} />
                      <IconButton icon="down" label={`Move “${l.title}” down`} disabled={busy || li === m.lessons.length - 1} onClick={() => moveLesson(m, li, 1)} />
                      <IconButton icon="edit" label={`Edit “${l.title}”`} onClick={() => setDialog({ kind: "lesson", module: m, lessonId: l.id })} />
                      <IconButton icon="trash" label={`Delete “${l.title}”`} disabled={busy} onClick={() => void deleteLesson(l)} />
                    </div>
                  ) : null}
                </div>
              );
            })}

            <div className="module-foot">
              <span className="module-meta">
                <Icon name="quiz" />
                {m.quiz ? (
                  <span>
                    Quiz: <strong>{m.quiz.title}</strong> · {plural(m.quiz.questionCount, "question")} · pass mark {m.quiz.passingScore}%
                  </span>
                ) : (
                  <span className="muted">No quiz</span>
                )}
              </span>
              {isAdmin ? (
                <div className="row-actions">
                  <Button small icon="plus" onClick={() => setDialog({ kind: "lesson", module: m })}>
                    Add lesson
                  </Button>
                  <Button small icon={m.quiz ? "edit" : "plus"} onClick={() => setDialog({ kind: "quiz", module: m })}>
                    {m.quiz ? "Edit quiz" : "Add quiz"}
                  </Button>
                  {m.quiz ? (
                    <Button small tone="quiet" disabled={busy} onClick={() => void deleteQuiz(m)}>
                      Remove quiz
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        ))}
      </div>

      {dialog?.kind === "module" ? <ModuleDialog courseId={id} module={dialog.module} onClose={closeDialog} onSaved={saved(dialog.module ? "Module saved" : "Module added")} /> : null}
      {dialog?.kind === "lesson" ? <LessonDialog moduleId={dialog.module.id} lessonId={dialog.lessonId} media={media.data} onClose={closeDialog} onSaved={saved(dialog.lessonId ? "Lesson saved" : "Lesson added")} /> : null}
      {dialog?.kind === "quiz" ? <QuizDialog module={dialog.module} onClose={closeDialog} onSaved={saved("Quiz saved")} /> : null}
    </>
  );
}

