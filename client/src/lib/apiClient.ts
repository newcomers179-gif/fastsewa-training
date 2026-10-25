/**
 * The app's HTTP client. It knows nothing about React Native: storage, `fetch` and the base URL are
 * handed in, so the whole thing (token refresh, error contract, timeouts) runs under `node --test`.
 *
 * What it does for every screen:
 *  - sends the bearer token and, on a 401, refreshes it ONCE for all requests that failed at the
 *    same moment (the server rotates refresh tokens; two parallel refreshes would sign the learner out);
 *  - turns the server's `{ error, code, details, requestId }` answers into an `ApiError` with a stable
 *    `code` the UI translates (no screen ever shows "[object Object]" or an English server sentence);
 *  - gives up on a hung connection after a timeout instead of spinning forever;
 *  - tells the app when the session is really over (refresh refused) and when the account must pick a
 *    new password first.
 */

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface TokenStore {
  read(): Promise<{ accessToken: string | null; refreshToken: string | null }>;
  write(tokens: TokenPair): Promise<void>;
  clear(): Promise<void>;
}

/** Codes the server sends (see shared/errors.ts) plus the ones only the client can produce. */
export type ClientErrorCode = "NETWORK" | "TIMEOUT" | "BAD_RESPONSE" | "SESSION_EXPIRED";

/** What the server's error answers look like (server/src/middleware/errors.ts); everything is checked before use. */
interface ErrorBody {
  error?: unknown;
  code?: unknown;
  details?: unknown;
  requestId?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly details: unknown;
  /** Field → messages, from a VALIDATION_ERROR (`details.fields`). */
  readonly fields: Record<string, string[]>;
  /** Seconds the server asked us to wait (Retry-After, or `details.retryAfterSeconds`). */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: { requestId?: string; details?: unknown; retryAfterSeconds?: number } = {}
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = extra.requestId;
    this.details = extra.details;
    this.fields = readFields(extra.details);
    this.retryAfterSeconds = extra.retryAfterSeconds ?? readNumber(extra.details, "retryAfterSeconds");
  }

  /** True for "the phone could not reach the server" (offline, DNS, timeout) as opposed to an answer. */
  get isConnectionProblem(): boolean {
    return this.code === "NETWORK" || this.code === "TIMEOUT";
  }
}

function readFields(details: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const fields = (details as { fields?: unknown } | null | undefined)?.fields;
  if (fields && typeof fields === "object") {
    for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
      if (Array.isArray(value)) out[key] = value.filter((v): v is string => typeof v === "string");
      else if (typeof value === "string") out[key] = [value];
    }
  }
  return out;
}

function readNumber(details: unknown, key: string): number | undefined {
  const value = (details as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export interface ApiClientOptions {
  /** e.g. "https://api.example.org" (no trailing slash needed). */
  baseUrl: string;
  tokens: TokenStore;
  /** Defaults to "/api/v1". */
  prefix?: string;
  fetchImpl?: typeof fetch;
  /** Milliseconds before a request is abandoned. Default 20 000. */
  timeoutMs?: number;
  /** The refresh token was refused (revoked, expired, account disabled): the learner must sign in again. */
  onSessionLost?: () => void;
  /** The server wants a new password before it will answer anything else. */
  onPasswordChangeRequired?: () => void;
}

export interface RequestOptions {
  body?: unknown;
  /** Sign-in, registration and password-reset calls are made without a session. Default true. */
  auth?: boolean;
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | null | undefined>;
}

export interface WithMeta<T> {
  data: T;
  /** `X-Total-Count`, when the endpoint sends it. */
  total: number | undefined;
}

export type ApiClient = ReturnType<typeof createApiClient>;

const STATUS_CODES: Record<number, string> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  429: "RATE_LIMITED",
  502: "SERVICE_UNAVAILABLE",
  503: "SERVICE_UNAVAILABLE",
  504: "SERVICE_UNAVAILABLE",
};

export function createApiClient(options: ApiClientOptions) {
  const base = options.baseUrl.replace(/\/+$/, "") + (options.prefix ?? "/api/v1");
  const doFetch = options.fetchImpl ?? ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 20_000;
  let refreshing: Promise<string | null> | null = null;

  function url(path: string, query?: RequestOptions["query"]): string {
    let out = `${base}${path}`;
    if (query) {
      const parts: string[] = [];
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === "") continue;
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
      }
      if (parts.length > 0) out += `${path.includes("?") ? "&" : "?"}${parts.join("&")}`;
    }
    return out;
  }

  /** One round trip with a timeout. Never throws anything but ApiError (or AbortError when the caller cancelled). */
  async function send(method: string, path: string, opts: RequestOptions, accessToken: string | null): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = () => controller.abort();
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener("abort", onCallerAbort, { once: true });
    }
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (opts.body !== undefined) headers["Content-Type"] = "application/json";
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      return await doFetch(url(path, opts.query), {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (e) {
      if (timedOut) throw new ApiError(0, "TIMEOUT", "The server took too long to answer");
      if ((e as { name?: string } | null)?.name === "AbortError") throw e; // the caller cancelled: not an error to show
      throw new ApiError(0, "NETWORK", "Could not reach the server");
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onCallerAbort);
    }
  }

  async function toError(res: Response): Promise<ApiError> {
    let body: ErrorBody | null = null;
    try {
      body = (await res.json()) as ErrorBody | null;
    } catch {
      body = null; // a proxy's HTML error page, an empty body
    }
    const retryHeader = Number(res.headers.get("retry-after"));
    const code = typeof body?.code === "string" ? body.code : (STATUS_CODES[res.status] ?? (res.status >= 500 ? "INTERNAL" : "UNKNOWN"));
    return new ApiError(res.status, code, typeof body?.error === "string" ? body.error : `Request failed (${res.status})`, {
      requestId: typeof body?.requestId === "string" ? body.requestId : (res.headers.get("x-request-id") ?? undefined),
      details: body?.details,
      retryAfterSeconds: Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : undefined,
    });
  }

  /**
   * Trades the refresh token for a new pair. Concurrent callers share one network call.
   * Resolves to the new access token, or null when the session is over. A connection problem is
   * NOT the end of the session: it rejects, and the tokens stay for the next attempt.
   */
  function refresh(): Promise<string | null> {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const { refreshToken } = await options.tokens.read();
      if (!refreshToken) return null;
      const res = await send("POST", "/auth/refresh", { body: { refreshToken }, auth: false }, null); // may throw NETWORK/TIMEOUT
      if (res.status === 200) {
        const pair = (await res.json().catch(() => null)) as Partial<TokenPair> | null;
        if (pair?.accessToken && pair.refreshToken) {
          await options.tokens.write({ accessToken: pair.accessToken, refreshToken: pair.refreshToken });
          return pair.accessToken;
        }
        throw new ApiError(res.status, "BAD_RESPONSE", "Unexpected answer from the server");
      }
      if (res.status >= 500 || res.status === 429) throw await toError(res); // the server is struggling: try again later
      await options.tokens.clear(); // 400/401/403: this refresh token is no good
      return null;
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function execute(method: string, path: string, opts: RequestOptions): Promise<Response> {
    const auth = opts.auth ?? true;
    let { accessToken } = auth ? await options.tokens.read() : { accessToken: null };
    // No access token but a refresh token (the app was killed before it could store the new one): try that first.
    if (auth && !accessToken) accessToken = await refresh();

    let res = await send(method, path, opts, accessToken);
    if (auth && res.status === 401) {
      const body = await toError(res.clone());
      // Only an expired/invalid token is worth a refresh; a 401 from the login itself is a wrong password.
      if (body.code === "UNAUTHORIZED" || body.code === "TOKEN_EXPIRED") {
        const fresh = await refresh();
        if (!fresh) {
          options.onSessionLost?.();
          throw new ApiError(401, "SESSION_EXPIRED", "Your session has ended. Please sign in again.");
        }
        res = await send(method, path, opts, fresh);
      }
    }
    if (!res.ok) {
      const error = await toError(res);
      if (error.code === "PASSWORD_CHANGE_REQUIRED") options.onPasswordChangeRequired?.();
      if (auth && res.status === 401) {
        options.onSessionLost?.();
        throw new ApiError(401, "SESSION_EXPIRED", "Your session has ended. Please sign in again.", { requestId: error.requestId });
      }
      throw error;
    }
    return res;
  }

  async function json<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const res = await execute(method, path, opts);
    if (res.status === 204) return undefined as T;
    try {
      return (await res.json()) as T;
    } catch {
      throw new ApiError(res.status, "BAD_RESPONSE", "Unexpected answer from the server");
    }
  }

  return {
    baseUrl: base,
    request: json,
    get: <T>(path: string, opts?: Omit<RequestOptions, "body">) => json<T>("GET", path, opts),
    post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "body">) => json<T>("POST", path, { ...opts, body: body ?? {} }),
    patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "body">) => json<T>("PATCH", path, { ...opts, body: body ?? {} }),
    put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "body">) => json<T>("PUT", path, { ...opts, body: body ?? {} }),
    delete: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "body">) => json<T>("DELETE", path, { ...opts, ...(body !== undefined ? { body } : {}) }),
    /** A GET that also reports the `X-Total-Count` header (paged lists). */
    async getWithMeta<T>(path: string, opts?: Omit<RequestOptions, "body">): Promise<WithMeta<T>> {
      const res = await execute("GET", path, opts ?? {});
      const total = Number(res.headers.get("x-total-count"));
      let data: T;
      try {
        data = (await res.json()) as T;
      } catch {
        throw new ApiError(res.status, "BAD_RESPONSE", "Unexpected answer from the server");
      }
      return { data, total: Number.isFinite(total) && res.headers.get("x-total-count") !== null ? total : undefined };
    },
  };
}

// ─── token storage on top of any key/value store ─────────────────────────────
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// SecureStore keys may only contain letters, digits, "." "-" and "_".
export const ACCESS_TOKEN_KEY = "fastsewa.access";
export const REFRESH_TOKEN_KEY = "fastsewa.refresh";

export function createTokenStore(store: KeyValueStore): TokenStore {
  return {
    async read() {
      const [accessToken, refreshToken] = await Promise.all([store.getItem(ACCESS_TOKEN_KEY), store.getItem(REFRESH_TOKEN_KEY)]);
      return { accessToken, refreshToken };
    },
    async write(tokens) {
      // Refresh token first: if the app dies in between, the next start can still get a new access token.
      await store.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
      await store.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    },
    async clear() {
      await Promise.all([store.removeItem(ACCESS_TOKEN_KEY), store.removeItem(REFRESH_TOKEN_KEY)]);
    },
  };
}
