import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

export interface Loaded<T> {
  data?: T | undefined;
  error?: ApiError | undefined;
  loading: boolean;
  reload: () => void;
}

/** GET a path (or nothing while `path` is null). Re-fetches when the path or query changes; late answers are ignored. */
export function useApi<T>(path: string | null, query?: Record<string, string | number | boolean | null | undefined>): Loaded<T> {
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ loading: path !== null });
  const [tick, setTick] = useState(0);
  const queryKey = JSON.stringify(query ?? {});

  useEffect(() => {
    if (path === null) {
      setState({ loading: false });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ data: s.data, loading: true }));
    api
      .get<T>(path, query, controller.signal)
      .then((data) => setState({ data, loading: false }))
      .catch((error: unknown) => {
        if ((error as { name?: string }).name === "AbortError") return;
        setState((s) => ({ data: s.data, error: error instanceof ApiError ? error : new ApiError(0, "UNKNOWN", String(error)), loading: false }));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, queryKey, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** What an action did: `ok` is the thing to branch on (a successful call may well return nothing). */
export type Outcome<R> = { ok: true; value: R } | { ok: false };

/**
 * Runs an async action with a busy flag and an error to show; ignores results after unmount.
 * `run()` never throws: it resolves to `{ ok: true, value }` or `{ ok: false }` and leaves the reason in `error`.
 */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | undefined>();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(
    async (...args: A): Promise<Outcome<R>> => {
      setBusy(true);
      setError(undefined);
      try {
        return { ok: true, value: await fn(...args) };
      } catch (e) {
        if (alive.current) setError(e instanceof ApiError ? e : new ApiError(0, "UNKNOWN", e instanceof Error ? e.message : String(e)));
        return { ok: false };
      } finally {
        if (alive.current) setBusy(false);
      }
    },
     
    [fn]
  );
  const clearError = useCallback(() => setError(undefined), []);
  return { run, busy, error, clearError };
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · FastSewa staff`;
  }, [title]);
}
