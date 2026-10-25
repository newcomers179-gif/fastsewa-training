/**
 * What a screen that depends on one server answer should show right now. TanStack Query reports
 * "no data yet and the request is paused" when the phone has no signal; that is its own case (the
 * learner needs "connect once to load this", not a spinner that never ends).
 */
export type ViewState = "loading" | "offline" | "error" | "ready";

export interface QueryLike {
  data: unknown;
  isPending: boolean;
  fetchStatus: "fetching" | "paused" | "idle";
}

export function viewState(query: QueryLike): ViewState {
  if (query.data !== undefined) return "ready";
  if (query.isPending) return query.fetchStatus === "paused" ? "offline" : "loading";
  return "error";
}
