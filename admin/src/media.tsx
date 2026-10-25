/** A link field with an "Upload a file" button next to it, used for thumbnails, lesson images and lesson videos. */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { parseYouTubeId } from "@shared/validation";
import { formatBytes } from "./format";
import type { MediaConfig } from "./types";
import { Button, Icon, ProgressBar, TextField, describeError } from "./ui";
import { acceptAttribute, checkFile, describeFormats, uploadMedia, type MediaKind } from "./upload";

type Phase = { name: "idle" } | { name: "uploading"; file: string; percent: number } | { name: "failed"; message: string };

interface Props {
  kind: MediaKind;
  label: string;
  value: string;
  onChange: (url: string) => void;
  /** `undefined` while the server's media settings are still loading. */
  config: MediaConfig | undefined;
  error?: string | undefined;
  hint?: ReactNode;
  folder?: "thumbnails" | "images" | "videos";
  placeholder?: string;
  /** Called with the chosen file just before it uploads (to read a video's length from it). */
  onPicked?: (file: File) => void;
  required?: boolean;
  disabled?: boolean;
  /**
   * The link as it was last saved on the server. Only links we know are safe are previewed: this one, a file just
   * uploaded here, or one of our own /uploads/ files. Anything typed by hand is not fetched, so typing a web address
   * never makes the browser contact that site.
   */
  trustedUrl?: string;
}

export function MediaField({ kind, label, value, onChange, config, error, hint, folder, placeholder, onPicked, required, disabled, trustedUrl }: Props) {
  const picker = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const pickerId = useId();
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [broken, setBroken] = useState(false);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const uploading = phase.name === "uploading";
  const mayPreview = value !== "" && (value === trustedUrl || value === uploaded || value.startsWith("/uploads/"));

  useEffect(() => setBroken(false), [value]);
  useEffect(() => () => controller.current?.abort(), []);

  const choose = async (file: File) => {
    if (!config) return;
    const problem = checkFile(file, kind, config);
    if (problem) {
      setPhase({ name: "failed", message: problem });
      return;
    }
    onPicked?.(file);
    const abort = new AbortController();
    controller.current = abort;
    setPhase({ name: "uploading", file: file.name, percent: 0 });
    try {
      const url = await uploadMedia({
        kind,
        file,
        folder,
        signal: abort.signal,
        onProgress: (p) => setPhase({ name: "uploading", file: file.name, percent: p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 0 }),
      });
      setUploaded(url);
      onChange(url);
      setPhase({ name: "idle" });
    } catch (failure) {
      if ((failure as { name?: string }).name === "AbortError") setPhase({ name: "idle" });
      else setPhase({ name: "failed", message: describeError(failure) });
    }
  };

  const youtubeId = kind === "video" && value ? parseYouTubeId(value) : null;
  const limit = config ? (kind === "image" ? config.maxImageBytes : config.maxVideoBytes) : 0;

  return (
    <div className="upload-box">
      <TextField label={label} value={value} onChange={onChange} error={error} hint={hint} placeholder={placeholder} required={required} spellCheck={false} autoComplete="off" disabled={disabled || uploading} />

      {config?.enabled ? (
        <div className="cluster">
          <input
            ref={picker}
            id={pickerId}
            type="file"
            className="sr-only"
            tabIndex={-1}
            accept={acceptAttribute(kind, config)}
            aria-label={`Choose a ${kind} file to upload`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = ""; // so choosing the same file again still fires
              if (file) void choose(file);
            }}
          />
          <Button icon="upload" disabled={disabled || uploading} onClick={() => picker.current?.click()}>
            {kind === "video" ? "Upload a video" : "Upload an image"}
          </Button>
          <span className="muted small">
            {describeFormats(kind, config)} · up to {formatBytes(limit)}
          </span>
        </div>
      ) : config ? (
        <p className="hint">File uploads are not set up on this server yet{kind === "video" ? ", so use a YouTube link." : "."}</p>
      ) : null}

      {phase.name === "uploading" ? (
        <div className="stack" role="status">
          <div className="cluster">
            <span className="small">
              Uploading {phase.file} — {phase.percent}%
            </span>
            <Button small onClick={() => controller.current?.abort()}>
              Cancel
            </Button>
          </div>
          <ProgressBar percent={phase.percent} label="Upload progress" />
        </div>
      ) : null}
      {phase.name === "failed" ? (
        <p className="error-text" role="alert">
          {phase.message}
        </p>
      ) : null}

      {kind === "image" && mayPreview && !broken ? <img className="preview" src={value} alt="" onError={() => setBroken(true)} /> : null}
      {kind === "image" && mayPreview && broken ? <p className="hint">The picture could not be loaded from this link.</p> : null}
      {youtubeId ? (
        <p className="hint">
          <Icon name="video" size={15} /> YouTube video <span className="mono">{youtubeId}</span> ·{" "}
          <a href={`https://www.youtube.com/watch?v=${youtubeId}`} target="_blank" rel="noopener noreferrer">
            Open to check it
          </a>
        </p>
      ) : null}
      {kind === "video" && mayPreview && !youtubeId ? <video className="preview" src={value} controls preload="metadata" /> : null}
    </div>
  );
}
