/**
 * Server data on the phone: fetched with TanStack Query, remembered between launches, and shown from
 * that memory when there is no signal (a site basement, a village with one bar). Only a few kinds of
 * data are remembered (queries marked `meta: { persist: true }` in queries.ts: course outlines,
 * lesson text, the learner's own progress); quizzes and anything that changes by the second are not.
 * Everything is wiped on sign-out so the next person on a shared phone never sees it.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient, focusManager, onlineManager, type Query } from "@tanstack/react-query";
import Constants from "expo-constants";
import { AppState, Platform } from "react-native";
import { ApiError } from "./apiClient";

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: { persist?: boolean };
  }
}

export const CACHE_KEY = "fastsewa.cache";
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Whether asking the server again could give a different answer. A 4xx would not; a bad connection or a busy server might. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.status === 429) return false; // the server asked us to slow down
    if (error.isConnectionProblem || error.status >= 500) return failureCount < 2;
    return false;
  }
  return failureCount < 1;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      // Restored data must outlive the in-memory cache or it would be thrown away right after loading.
      gcTime: CACHE_MAX_AGE_MS,
      retry: shouldRetry,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnReconnect: true,
    },
    mutations: { retry: false },
  },
});

export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: CACHE_KEY, throttleTime: 2000 });

export const persistOptions = {
  persister,
  maxAge: CACHE_MAX_AGE_MS,
  // A new app version may expect differently shaped answers: start with an empty memory.
  buster: Constants.expoConfig?.version ?? "dev",
  dehydrateOptions: {
    shouldDehydrateQuery: (query: Query) => query.state.status === "success" && query.meta?.persist === true,
  },
};

/** Forget everything that belongs to the signed-in person (sign-out, account deletion, a different person signing in). */
export async function forgetUserData(): Promise<void> {
  queryClient.clear();
  try {
    await persister.removeClient();
  } catch {
    /* storage unavailable: the in-memory cache is already empty */
  }
}

/** Connect TanStack Query to the phone: "online" follows the network, "focused" follows the app being in the foreground. */
export function installQueryManagers(): () => void {
  onlineManager.setEventListener((setOnline) => {
    return NetInfo.addEventListener((state) => {
      // `isInternetReachable` is null until the phone has checked; only an explicit false means offline.
      setOnline(state.isConnected !== false && state.isInternetReachable !== false);
    });
  });
  const sub = AppState.addEventListener("change", (status) => {
    if (Platform.OS !== "web") focusManager.setFocused(status === "active");
  });
  return () => sub.remove();
}
