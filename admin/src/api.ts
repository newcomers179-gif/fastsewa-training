/**
 * The console's only way to talk to the API.
 *
 *  - The short-lived access token lives in memory; the refresh token in sessionStorage (it dies with the
 *    tab, so a shared office computer does not stay signed in).
 *  - A 401 triggers exactly one token refresh shared by every request that failed at the same moment
 *    (refresh tokens rotate, so two parallel refreshes would sign the user out), then the request is retried.
 *  - Errors become ApiError with the server's stable `code`, so screens can react to codes, not sentences.
 */
import type { AuthResult, Tokens } from "./types";

const STORAGE_KEY = "fastsewa.admin.refresh";
const API = "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string[]>;
  readonly details: Record<string, unknown> | undefined;
  readonly requestId: string | undefined;
  readonly retryAfter: number | undefined;

  constructor(status: number, code: string, message: string, extra: { fields?: Record<string, string[]>; details?: Record<string, unknown>; requestId?: string; retryAfter?: number } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = extra.fields ?? {};
    this.details = extra.details;
    this.requestId = extra.requestId;
    this.retryAfter = extra.retryAfter;
  }
}

// ─── session tokens ──────────────────────────────────────────────────────────
function readStored(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function writeStored(value: string | null): void {
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, value);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode or storage blocked: the session simply will not survive a reload */
  }
}

let accessToken: string | null = null;
let refreshToken: string | null = readStored();
let refreshing: Promise<"ok" | "denied" | "offline"> | null = null;

const sessionLostListeners = new Set<() => void>();
const passwordChangeListeners = new Set<() => void>();

export const hasStoredSession = (): boolean => refreshToken !== null;
export const currentRefreshToken = (): string | null => refreshToken;

export function setTokens(tokens: Tokens | null): void {
  accessToken = tokens?.accessToken ?? null;
  refreshToken = tokens?.refreshToken ?? null;
  writeStored(refreshToken);
}

export function onSessionLost(listener: () => void): () => void {
  sessionLostListeners.add(listener);
  return () => sessionLostListeners.delete(listener);
}
export function onPasswordChangeRequired(listener: () => void): () => void {
  passwordChangeListeners.add(listener);
  return () => passwordChangeListeners.delete(listener);
}

// ─── plumbing ────────────────────────────────────────────────────────────────
type Query = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, query?: Query): string {
  const url = path.startsWith("/api/") ? path : `${API}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${url}?${text}` : url;
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: { error?: string; code?: string; details?: Record<string, unknown>; requestId?: string } = {};
  try {
    body = JSON.parse(await res.text());
  } catch {
    /* not JSON (proxy error page) */
  }
  const fields = (body.details?.fields ?? {}) as Record<string, string[]>;
  const retry = Number(res.headers.get("retry-after"));
  return new ApiError(res.status, body.code ?? (res.status >= 500 ? "SERVER_ERROR" : "REQUEST_FAILED"), body.error ?? `Request failed (${res.status})`, {
    fields,
    details: body.details,
    requestId: body.requestId,
    retryAfter: Number.isFinite(retry) && retry > 0 ? retry : undefined,
  });
}

const networkError = () => new ApiError(0, "NETWORK", "Cannot reach the server. Check your connection and try again.");

async function refreshSession(): Promise<"ok" | "denied" | "offline"> {
  if (!refreshToken) return "denied";
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store",
      });
      if (!res.ok) {
        // 5xx / 429 are the server's trouble, not proof that the session is dead.
        if (res.status >= 500 || res.status === 429) return "offline" as const;
        setTokens(null);
        return "denied" as const;
      }
      setTokens((await res.json()) as Tokens);
      return "ok" as const;
    } catch {
      return "offline" as const;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

interface SendOptions {
  body?: BodyInit | null;
  json?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /** false for sign-in itself: a 401 there is a wrong password, not an expired session. */
  auth?: boolean;
  accept?: string;
}

async function send(method: string, path: string, opts: SendOptions = {}): Promise<Response> {
  const url = buildUrl(path, opts.query);
  const useAuth = opts.auth !== false;
  const attempt = async (): Promise<Response> => {
    const headers: Record<string, string> = { accept: opts.accept ?? "application/json" };
    let body: BodyInit | null | undefined = opts.body;
    if (opts.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.json);
    }
    if (useAuth && accessToken) headers.authorization = `Bearer ${accessToken}`;
    try {
      return await fetch(url, { method, headers, body, signal: opts.signal, cache: "no-store" });
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") throw error;
      throw networkError();
    }
  };

  let res = await attempt();
  if (res.status === 401 && useAuth && refreshToken) {
    const outcome = await refreshSession();
    if (outcome === "offline") throw networkError();
    if (outcome === "ok") res = await attempt();
  }
  if (res.ok) return res;

  const error = await toApiError(res);
  if (res.status === 401 && useAuth) {
    setTokens(null);
    for (const listener of sessionLostListeners) listener();
  }
  if (error.code === "PASSWORD_CHANGE_REQUIRED") for (const listener of passwordChangeListeners) listener();
  throw error;
}

async function json<T>(method: string, path: string, opts: SendOptions = {}): Promise<T> {
  const res = await send(method, path, opts);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => json<T>("GET", path, { query, signal }),
  post: <T>(path: string, body?: unknown) => json<T>("POST", path, { json: body ?? {} }),
  put: <T>(path: string, body: unknown) => json<T>("PUT", path, { json: body }),
  patch: <T>(path: string, body: unknown = {}) => json<T>("PATCH", path, { json: body }),
  del: <T>(path: string, body?: unknown) => json<T>("DELETE", path, body === undefined ? {} : { json: body }),
};

// ─── authentication ──────────────────────────────────────────────────────────
export async function login(username: string, password: string): Promise<AuthResult> {
  return json<AuthResult>("POST", "/auth/login", { json: { username, password }, auth: false });
}

export async function logout(): Promise<void> {
  const token = refreshToken;
  setTokens(null);
  if (!token) return;
  try {
    await fetch(`${API}/auth/logout`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: token }), cache: "no-store" });
  } catch {
    /* best effort: the token also expires on its own */
  }
}

// ─── downloads and uploads ───────────────────────────────────────────────────
/** Fetches a file with the bearer token and hands it to the browser as a download. */
export async function download(path: string, query: Query, fallbackName: string): Promise<void> {
  const res = await send("GET", path, { query, accept: "*/*" });
  const blob = await res.blob();
  const match = /filename="?([^";]+)"?/i.exec(res.headers.get("content-disposition") ?? "");
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = match?.[1] ?? fallbackName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface UploadProgress {
  loaded: number;
  total: number;
}

/** XMLHttpRequest because fetch cannot report upload progress. Resolves with the response text. */
export function xhrUpload(opts: {
  method: "PUT" | "POST";
  url: string;
  headers?: Record<string, string>;
  body: Blob | FormData;
  withAuth?: boolean;
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(opts.method, opts.url);
    for (const [key, value] of Object.entries(opts.headers ?? {})) xhr.setRequestHeader(key, value);
    if (opts.withAuth && accessToken) xhr.setRequestHeader("authorization", `Bearer ${accessToken}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) opts.onProgress?.({ loaded: event.loaded, total: event.total });
    };
    xhr.onerror = () => reject(networkError());
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText);
        return;
      }
      let code = "UPLOAD_FAILED";
      let message = `The upload was refused (${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText) as { code?: string; error?: string };
        code = body.code ?? code;
        message = body.error ?? message;
      } catch {
        /* storage providers answer in XML */
      }
      reject(new ApiError(xhr.status, code, message));
    };
    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(opts.body);
  });
}
