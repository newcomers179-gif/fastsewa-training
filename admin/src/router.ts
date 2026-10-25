/** A tiny hash router: "#/learners/abc?page=2" → { segments: ["learners", "abc"], query }. */
import { useCallback, useEffect, useState } from "react";

export interface Route {
  segments: string[];
  query: URLSearchParams;
}

function read(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [path, search = ""] = raw.split("?");
  return { segments: path.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(search) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export const href = (path: string): string => `#/${path.replace(/^\//, "")}`;

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  const target = href(path);
  if (opts.replace) window.location.replace(target);
  else window.location.hash = target;
}

/** List filters kept in the address, so Back returns to the same search and page. */
export function useQueryState<T extends Record<string, string>>(defaults: T): [T, (patch: Partial<T>) => void] {
  const { query } = useRoute();
  const value = Object.fromEntries(Object.keys(defaults).map((k) => [k, query.get(k) ?? defaults[k]])) as T;
  const set = useCallback(
    (patch: Partial<T>) => {
      const next = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === defaults[k]) next.delete(k);
        else next.set(k, v as string);
      }
      const path = window.location.hash.replace(/^#/, "").split("?")[0];
      const text = next.toString();
      window.location.replace(`#${path}${text ? `?${text}` : ""}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(defaults)]
  );
  return [value, set];
}
