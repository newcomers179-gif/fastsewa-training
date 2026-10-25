import React from "react";
import { ErrorView, LoadingView } from "@/components/ui";
import { ApiError } from "@/lib/apiClient";
import { viewState, type QueryLike } from "@/lib/viewState";

const OFFLINE = new ApiError(0, "NETWORK", "offline");

/**
 * Shows a spinner, an offline notice or an error with "try again" until the query has data,
 * then the screen's content (handed the data, so no screen needs a non-null assertion).
 */
export function QueryGate<T>({ query, children }: { query: QueryLike & { data: T | undefined; error: unknown; refetch: () => unknown }; children: (data: T) => React.ReactNode }) {
  const state = viewState(query);
  if (state === "ready" && query.data !== undefined) return <>{children(query.data)}</>;
  if (state === "loading") return <LoadingView />;
  if (state === "offline") return <ErrorView error={OFFLINE} onRetry={() => void query.refetch()} />;
  return <ErrorView error={query.error} onRetry={() => void query.refetch()} />;
}
