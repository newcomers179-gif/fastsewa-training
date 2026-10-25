/** Shared building blocks: icons, buttons, form fields, dialogs, toasts, status chips. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { ApiError } from "./api";
import { formatNumber } from "./format";

// ─── icons ───────────────────────────────────────────────────────────────────
const ICONS = {
  dashboard: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z",
  users: "M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3ZM8 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13Zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 1.9 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5Z",
  book: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Zm3 12a1 1 0 0 0-1 1 1 1 0 0 0 1 1h9V7a1 1 0 0 0-1-1H7v10.2c.3-.1.6-.2 1-.2Z",
  award: "M12 2a6 6 0 0 0-3.5 10.9L7 22l5-3 5 3-1.5-9.1A6 6 0 0 0 12 2Zm0 2a4 4 0 1 1-4 4 4 4 0 0 1 4-4Z",
  shield: "M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm0 2.2 6 2.3V11c0 3.9-2.5 7.6-6 8.8-3.5-1.2-6-4.9-6-8.8V6.5l6-2.3Z",
  clock: "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 2a8 8 0 1 1-8 8 8 8 0 0 1 8-8Zm-1 3v6l5 3 1-1.7-4-2.3V7h-2Z",
  megaphone: "M3 10v4a1 1 0 0 0 1 1h2l5 4V5L6 9H4a1 1 0 0 0-1 1Zm13-4v12a8 8 0 0 0 0-12Zm2.5-2.5v17c4-2 4-15 0-17Z",
  logout: "M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5v-2H5V5h5V3Zm6.6 4.6L15.2 9l2 2H9v2h8.2l-2 2 1.4 1.4L21 12l-4.4-4.4Z",
  plus: "M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4Z",
  edit: "M4 17.3V20h2.7L18.8 7.9l-2.7-2.7L4 17.3ZM20.7 6a1 1 0 0 0 0-1.4l-1.3-1.3a1 1 0 0 0-1.4 0l-1.1 1.1 2.7 2.7L20.7 6Z",
  trash: "M6 7h12l-1 14H7L6 7Zm3-4h6l1 2h4v2H4V5h4l1-2Zm0 6v10h2V9H9Zm4 0v10h2V9h-2Z",
  up: "m12 7 7 8-1.5 1.3L12 10.2 6.5 16.3 5 15l7-8Z",
  down: "m12 17-7-8 1.5-1.3 5.5 6.1 5.5-6.1L19 9l-7 8Z",
  search: "M10 3a7 7 0 1 0 4.3 12.5l4.6 4.6 1.4-1.4-4.6-4.6A7 7 0 0 0 10 3Zm0 2a5 5 0 1 1-5 5 5 5 0 0 1 5-5Z",
  download: "M11 3h2v9.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4 3.3 3.3V3ZM5 18h14v3H5v-3Z",
  upload: "M12 3l5.7 5.7-1.4 1.4L13 6.8V16h-2V6.8L7.7 10.1 6.3 8.7 12 3ZM5 18h14v3H5v-3Z",
  check: "m9.5 16.2-4-4L4 13.7l5.5 5.5L20 8.7l-1.5-1.5-9 9Z",
  x: "m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z",
  menu: "M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z",
  key: "M14 3a6 6 0 0 0-5.7 7.9L3 16.2V21h4v-2h2v-2h2l1.1-1.1A6 6 0 1 0 14 3Zm2 3.5a1.5 1.5 0 1 1-1.5 1.5A1.5 1.5 0 0 1 16 6.5Z",
  copy: "M8 3h11a2 2 0 0 1 2 2v12h-2V5H8V3Zm-3 4h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z",
  video: "M4 6h11a2 2 0 0 1 2 2v2.5l4-2.5v8l-4-2.5V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z",
  text: "M5 4h14v3h-2V6h-4v12h2v2H9v-2h2V6H7v1H5V4Z",
  image: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v8.6l3.5-3.5 3 3 4-4.6L19 14V6H5Zm3 4.5A1.5 1.5 0 1 0 6.5 9 1.5 1.5 0 0 0 8 10.5Z",
  quiz: "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm1 16h-2v-2h2v2Zm1.1-5.2-.9.9a2.6 2.6 0 0 0-.7 1.8h-1.8a3.6 3.6 0 0 1 1-2.5l1.2-1.3a1.6 1.6 0 0 0 .5-1.2 1.8 1.8 0 0 0-3.6 0H8a3.8 3.8 0 0 1 7.6 0 3.2 3.2 0 0 1-1.5 2.3Z",
  external: "M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14V3ZM5 5h6v2H7v10h10v-4h2v6H5V5Z",
  alert: "M12 3 1.5 21h21L12 3Zm1 14h-2v-2h2v2Zm0-4h-2V9h2v4Z",
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICONS[name]} fill="currentColor" />
    </svg>
  );
}

// ─── buttons ─────────────────────────────────────────────────────────────────
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: "primary" | "secondary" | "danger" | "quiet";
  busy?: boolean;
  icon?: IconName;
  small?: boolean;
}

export function Button({ tone = "secondary", busy = false, icon, small = false, children, className = "", disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button {...rest} type={type} disabled={disabled || busy} aria-busy={busy || undefined} className={`btn btn-${tone}${small ? " btn-small" : ""} ${className}`.trim()}>
      {busy ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={small ? 15 : 17} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

export function IconButton({ icon, label, tone = "quiet", ...rest }: { icon: IconName; label: string; tone?: ButtonProps["tone"] } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className={`btn btn-${tone} btn-icon ${rest.className ?? ""}`.trim()} aria-label={label} title={label}>
      <Icon name={icon} size={17} />
    </button>
  );
}

// ─── form fields ─────────────────────────────────────────────────────────────
export interface ControlProps {
  id: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}

export function Field({ label, error, hint, children, required, className = "" }: { label: string; error?: string | undefined; hint?: ReactNode; required?: boolean; className?: string; children: (props: ControlProps) => ReactNode }) {
  const id = useId();
  const describedBy = [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field ${error ? "has-error" : ""} ${className}`.trim()}>
      <label htmlFor={id}>
        {label}
        {required ? <span className="req" aria-hidden="true"> *</span> : null}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint ? (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="error-text" id={`${id}-err`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: ReactNode;
  type?: "text" | "password" | "email" | "tel" | "number" | "search";
  maxLength?: number;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  multiline?: boolean;
  rows?: number;
  disabled?: boolean;
  lang?: string;
  inputMode?: "text" | "numeric" | "tel" | "email";
  className?: string;
  spellCheck?: boolean;
}

export function TextField({ label, value, onChange, error, hint, type = "text", multiline, rows = 4, className, required, ...rest }: TextFieldProps) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(aria) =>
        multiline ? (
          <textarea {...aria} {...rest} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <input {...aria} {...rest} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
        )
      }
    </Field>
  );
}

export function SelectField<T extends string>({ label, value, onChange, options, error, hint, disabled, className }: { label: string; value: T; onChange: (value: T) => void; options: readonly { value: T; label: string }[]; error?: string | undefined; hint?: ReactNode; disabled?: boolean; className?: string }) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {(aria) => (
        <select {...aria} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function CheckboxField({ label, checked, onChange, hint, disabled }: { label: string; checked: boolean; onChange: (checked: boolean) => void; hint?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="check">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? `${id}-hint` : undefined} />
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** The first message for a field from a failed request, if any. */
export const fieldError = (error: ApiError | undefined, name: string): string | undefined => error?.fields[name]?.[0];

// ─── messages ────────────────────────────────────────────────────────────────
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "RATE_LIMITED") {
      const wait = error.retryAfter ? ` Try again in ${error.retryAfter >= 90 ? `${Math.ceil(error.retryAfter / 60)} minutes` : `${error.retryAfter} seconds`}.` : "";
      return `Too many attempts.${wait}`;
    }
    const first = Object.values(error.fields)[0]?.[0];
    if (error.code === "VALIDATION_ERROR" && first) return first;
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong";
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div className="notice notice-error" role="alert">
      <Icon name="alert" />
      <div>
        <p>{describeError(error)}</p>
        {requestId ? <p className="muted small">Reference {requestId}</p> : null}
      </div>
      {onRetry ? (
        <Button small onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "good"; children: ReactNode }) {
  return <div className={`notice notice-${tone}`}>{children}</div>;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children ? <p className="muted">{children}</p> : null}
      {action}
    </div>
  );
}

export type Tone = "good" | "warn" | "bad" | "info" | "neutral";
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="progress-fill" style={{ width: `${value}%` }} />
    </div>
  );
}

// ─── layout pieces ───────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="page-header">
      <div>
        {back ? (
          <a className="back-link" href={back.href}>
            ← {back.label}
          </a>
        ) : null}
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Panel({ title, actions, children, flush = false }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="panel">
      {title || actions ? (
        <div className="panel-head">
          {title ? <h2>{title}</h2> : <span />}
          {actions ? <div className="panel-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className={flush ? "panel-body flush" : "panel-body"}>{children}</div>
    </section>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="pagination" aria-label="Pages">
      <span className="muted">
        {total === 0 ? "No results" : `${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(total)}`}
      </span>
      <div>
        <Button small disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <span className="page-number">
          Page {page} of {pages}
        </span>
        <Button small disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}

// ─── dialogs ─────────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, footer, wide = false, dismissOnBackdrop = false }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; dismissOnBackdrop?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal${wide ? " modal-wide" : ""}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (dismissOnBackdrop && e.target === ref.current) onClose();
      }}
    >
      <div className="modal-card">
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </dialog>
  );
}

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  tone?: "primary" | "danger";
}
type Ask = (options: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Ask>(() => Promise.resolve(false));

/** `const confirm = useConfirm(); if (await confirm({ title: "Delete course?" })) …` */
export const useConfirm = (): Ask => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const ask = useCallback<Ask>((options) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })), []);
  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending ? (
        <Modal
          title={pending.title}
          onClose={() => settle(false)}
          dismissOnBackdrop
          footer={
            <>
              <Button onClick={() => settle(false)}>Cancel</Button>
              <Button tone={pending.tone === "danger" ? "danger" : "primary"} onClick={() => settle(true)}>
                {pending.confirmLabel ?? "Confirm"}
              </Button>
            </>
          }
        >
          {pending.body}
        </Modal>
      ) : null}
    </ConfirmContext.Provider>
  );
}

// ─── toasts ──────────────────────────────────────────────────────────────────
interface Toast {
  id: number;
  tone: "good" | "bad";
  text: string;
}
const ToastContext = createContext<(text: string, tone?: Toast["tone"]) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const push = useCallback((text: string, tone: Toast["tone"] = "good") => {
    const id = ++counter.current;
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "bad" ? 8000 : 4000);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <Icon name={t.tone === "good" ? "check" : "alert"} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ─── secrets ─────────────────────────────────────────────────────────────────
/** A one-time value (temporary password) with a copy button. Shown once, so make copying easy. */
export function SecretBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard blocked: the value is selectable below */
    }
  };
  return (
    <div className="secret">
      <span className="secret-label">{label}</span>
      <div className="secret-row">
        <code className="secret-value" tabIndex={0}>
          {value}
        </code>
        <Button small icon={copied ? "check" : "copy"} onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
