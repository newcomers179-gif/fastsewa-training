/**
 * Works out the API address from the build's settings. Kept apart from config.ts (which reads the
 * Expo constants) so the rules can be tested without loading React Native.
 */

export interface ApiUrlResult {
  url: string | null;
  /** Why there is no usable address (shown to whoever installed a mis-built app). */
  problem: "missing" | "insecure" | "placeholder" | "invalid" | null;
}

const ADDRESS = /^https?:\/\/[^\s/?#]+(?:\/[^\s?#]*)?$/i;
const PLACEHOLDER = /YOUR[_-]|yourdomain|example\.(?:com|org|net)|<[^>]+>|\.\.\./i;

export function resolveApiBaseUrl(input: { env: string | undefined; isDev: boolean; hostUri?: string | null }): ApiUrlResult {
  const env = (input.env ?? "").trim();
  if (env !== "") {
    const url = env.replace(/\/+$/, "");
    if (!ADDRESS.test(url)) return { url: null, problem: "invalid" };
    if (!input.isDev) {
      if (PLACEHOLDER.test(url)) return { url: null, problem: "placeholder" };
      if (!/^https:\/\//i.test(url)) return { url: null, problem: "insecure" };
    }
    return { url, problem: null };
  }
  if (input.isDev) {
    // `expo start` knows the computer's address on the local network; a real phone can reach the API there, "localhost" would be the phone itself.
    const host = input.hostUri?.split(":")[0];
    return { url: `http://${host && host !== "" ? host : "localhost"}:5000`, problem: null };
  }
  return { url: null, problem: "missing" };
}
