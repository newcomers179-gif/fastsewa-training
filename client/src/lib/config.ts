/**
 * Where the API lives. A release build must be told explicitly (EXPO_PUBLIC_API_URL, set per build
 * profile in eas.json) and must use https; anything else is refused up front instead of silently
 * talking to localhost or sending passwords over plain http.
 */
import Constants from "expo-constants";
import { resolveApiBaseUrl } from "./apiUrl";

export type { ApiUrlResult } from "./apiUrl";

// Metro replaces `process.env.EXPO_PUBLIC_*` only when it is written out literally like this.
const resolved = resolveApiBaseUrl({
  env: process.env.EXPO_PUBLIC_API_URL,
  isDev: typeof __DEV__ !== "undefined" ? __DEV__ : false,
  hostUri: Constants.expoConfig?.hostUri ?? null,
});

export const API_BASE_URL: string = resolved.url ?? "";
export const API_CONFIG_PROBLEM = resolved.problem;
