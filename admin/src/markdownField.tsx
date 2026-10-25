/** A multi-line text field for lesson text, with a Write / Preview switch (the preview is exactly what the app renders). */
import { useId, useState, type ReactNode } from "react";
import { Markdown } from "./markdown";

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: ReactNode;
  lang?: string;
  required?: boolean;
  rows?: number;
  maxLength?: number;
}

export function MarkdownField({ label, value, onChange, error, hint, lang, required, rows = 10, maxLength = 100_000 }: Props) {
  const id = useId();
  const [mode, setMode] = useState<"write" | "preview">("write");
  return (
    <div className={`field${error ? " has-error" : ""}`}>
      <div className="field-head">
        <label htmlFor={id}>
          {label}
          {required ? (
            <span className="req" aria-hidden="true">
              {" "}
              *
            </span>
          ) : null}
        </label>
        <div className="segmented" role="group" aria-label={`${label}: view`}>
          <button type="button" aria-pressed={mode === "write"} onClick={() => setMode("write")}>
            Write
          </button>
          <button type="button" aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>
            Preview
          </button>
        </div>
      </div>
      {mode === "write" ? (
        <textarea id={id} rows={rows} value={value} lang={lang} maxLength={maxLength} spellCheck onChange={(event) => onChange(event.target.value)} aria-invalid={error ? true : undefined} aria-describedby={`${id}-hint`} />
      ) : (
        <Markdown source={value} lang={lang} />
      )}
      <p className="hint" id={`${id}-hint`}>
        {hint ?? "Formatting: # Heading · **bold** · _italic_ · - bullet list · 1. numbered list · > safety note"}
      </p>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
