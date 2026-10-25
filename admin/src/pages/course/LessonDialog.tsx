import { useState } from "react";
import type { ContentType } from "@shared/constants";
import { api } from "../../api";
import { formatDuration, parseDuration } from "../../format";
import { useAction, useApi } from "../../hooks";
import { MarkdownField } from "../../markdownField";
import { MediaField } from "../../media";
import type { LessonFull, MediaConfig } from "../../types";
import { probeVideoDuration } from "../../upload";
import { Button, CheckboxField, ErrorNotice, Loading, Modal, Notice, SelectField, TextField, fieldError } from "../../ui";

interface Draft {
  title: string;
  titleHi: string;
  contentType: ContentType;
  isRequired: boolean;
  videoUrl: string;
  duration: string;
  content: string;
  contentHi: string;
  imageUrl: string;
}

const draftOf = (lesson: LessonFull | undefined): Draft => ({
  title: lesson?.title ?? "",
  titleHi: lesson?.titleHi ?? "",
  contentType: lesson?.contentType ?? "video",
  isRequired: lesson?.isRequired ?? true,
  videoUrl: lesson?.videoUrl ?? "",
  duration: lesson?.videoDurationSeconds ? formatDuration(lesson.videoDurationSeconds) : "",
  content: lesson?.content ?? "",
  contentHi: lesson?.contentHi ?? "",
  imageUrl: lesson?.imageUrl ?? "",
});

/** The same rules the server enforces, checked first so the person fixes them without a round trip. */
function problemsIn(d: Draft): Record<string, string> {
  const found: Record<string, string> = {};
  if (d.title.trim().length < 2) found.title = "Give the lesson a title (at least 2 letters)";
  if (d.contentType === "video") {
    if (!d.videoUrl.trim()) found.videoUrl = "Add a YouTube link or upload a video";
    const seconds = parseDuration(d.duration);
    if (seconds === null || seconds < 1 || seconds > 86_400) found.videoDurationSeconds = "Enter the length in minutes and seconds, like 12:30";
  }
  if (d.contentType === "text" && d.content.trim() === "") found.content = "Write the lesson text";
  if (d.contentType === "image" && !d.imageUrl.trim()) found.imageUrl = "Add an image";
  return found;
}

function LessonForm({ moduleId, lesson, media, onClose, onSaved }: { moduleId: string; lesson?: LessonFull; media: MediaConfig | undefined; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<Draft>(() => draftOf(lesson));
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [probing, setProbing] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((current) => ({ ...current, [key]: value }));

  const save = useAction(() => {
    const isVideo = d.contentType === "video";
    const body = {
      title: d.title.trim(),
      titleHi: d.titleHi.trim() || null,
      contentType: d.contentType,
      isRequired: d.isRequired,
      videoUrl: isVideo ? d.videoUrl.trim() : null,
      videoDurationSeconds: isVideo ? parseDuration(d.duration) : null,
      imageUrl: d.contentType === "image" ? d.imageUrl.trim() : null,
      content: d.content.trim() === "" ? null : d.content,
      contentHi: d.contentHi.trim() === "" ? null : d.contentHi,
    };
    return lesson ? api.put(`/admin/lessons/${lesson.id}`, body) : api.post(`/admin/modules/${moduleId}/lessons`, body);
  });
  const err = save.error;
  const shown = (field: string) => problems[field] ?? fieldError(err, field);

  const submit = async () => {
    const found = problemsIn(d);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    if ((await save.run()).ok) onSaved();
  };

  const typeOptions: { value: ContentType; label: string }[] = [
    { value: "video", label: "Video" },
    { value: "text", label: "Reading (text)" },
    { value: "image", label: "Picture" },
    ...(lesson?.contentType === "quiz" ? [{ value: "quiz" as const, label: "Quiz (older format)" }] : []),
  ];
  const textLabel = d.contentType === "text" ? "Lesson text" : d.contentType === "video" ? "Notes under the video" : "Caption under the picture";

  return (
    <Modal
      wide
      title={lesson ? "Edit lesson" : "Add lesson"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" busy={save.busy} disabled={probing} onClick={() => void submit()}>
            {lesson ? "Save lesson" : "Add lesson"}
          </Button>
        </>
      }
    >
      {err && Object.keys(err.fields).length === 0 ? <ErrorNotice error={err} /> : null}
      <form
        className="form-grid"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <TextField className="wide" label="Title" required autoFocus maxLength={160} value={d.title} onChange={(v) => set("title", v)} error={shown("title")} />
        <TextField className="wide" label="Title in Hindi" lang="hi" maxLength={160} value={d.titleHi} onChange={(v) => set("titleHi", v)} error={shown("titleHi")} hint="Optional. Hindi-language learners see this instead of the English title." />
        <SelectField label="Type" value={d.contentType} onChange={(v) => set("contentType", v)} options={typeOptions} error={shown("contentType")} />
        <div className="wide">
          <CheckboxField label="Learners must finish this lesson" checked={d.isRequired} onChange={(v) => set("isRequired", v)} hint="Turn off for extra reading that should not hold back the certificate." />
        </div>

        {d.contentType === "video" ? (
          <>
            <div className="wide">
              <MediaField
                kind="video"
                label="Video"
                required
                value={d.videoUrl}
                trustedUrl={lesson?.videoUrl ?? ""}
                onChange={(v) => set("videoUrl", v)}
                config={media}
                folder="videos"
                placeholder="https://www.youtube.com/watch?v=…"
                error={shown("videoUrl")}
                hint="Paste a YouTube link, or upload a video file."
                onPicked={(file) => {
                  setProbing(true);
                  void probeVideoDuration(file).then((seconds) => {
                    setProbing(false);
                    if (seconds) set("duration", formatDuration(seconds));
                  });
                }}
              />
            </div>
            <TextField
              label="Video length"
              required
              value={d.duration}
              onChange={(v) => set("duration", v)}
              placeholder="12:30"
              inputMode="text"
              autoComplete="off"
              error={shown("videoDurationSeconds")}
              hint="Minutes and seconds. Learners must watch 70% of this before the lesson counts as done, so enter it exactly."
            />
          </>
        ) : null}

        {d.contentType === "image" ? (
          <div className="wide">
            <MediaField kind="image" label="Picture" required value={d.imageUrl} trustedUrl={lesson?.imageUrl ?? ""} onChange={(v) => set("imageUrl", v)} config={media} folder="images" error={shown("imageUrl")} hint="JPG, PNG or WebP. Shown full width on the learner's phone, so use a clear, not-too-wide picture." />
          </div>
        ) : null}

        <div className="wide">
          <MarkdownField label={`${textLabel} (English)`} required={d.contentType === "text"} value={d.content} onChange={(v) => set("content", v)} error={shown("content")} rows={d.contentType === "text" ? 12 : 5} />
        </div>
        <div className="wide">
          <MarkdownField label={`${textLabel} (Hindi)`} lang="hi" value={d.contentHi} onChange={(v) => set("contentHi", v)} error={shown("contentHi")} rows={d.contentType === "text" ? 12 : 5} hint="Optional. Hindi-language learners see this when it is filled in; otherwise they see the English text." />
        </div>
        <button type="submit" className="sr-only" tabIndex={-1}>
          Save
        </button>
      </form>
      {probing ? <Notice tone="info">Reading the video’s length…</Notice> : null}
    </Modal>
  );
}

interface Props {
  moduleId: string;
  /** Present when editing; its full text is fetched here because the course tree carries only summaries. */
  lessonId?: string;
  media: MediaConfig | undefined;
  onClose: () => void;
  onSaved: () => void;
}

export function LessonDialog({ moduleId, lessonId, media, onClose, onSaved }: Props) {
  const existing = useApi<LessonFull>(lessonId ? `/admin/lessons/${lessonId}` : null);

  if (lessonId && !existing.data) {
    return (
      <Modal title="Edit lesson" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
        {existing.error ? <ErrorNotice error={existing.error} onRetry={existing.reload} /> : <Loading />}
      </Modal>
    );
  }
  return <LessonForm moduleId={moduleId} lesson={existing.data} media={media} onClose={onClose} onSaved={onSaved} />;
}
