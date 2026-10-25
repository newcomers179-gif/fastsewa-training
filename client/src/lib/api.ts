/** The one API client the app uses, wired to secure token storage and to the auth layer's events. */
import { ApiError, createApiClient, createTokenStore } from "./apiClient";
import { API_BASE_URL } from "./config";
import { createEmitter } from "./events";
import { secureStore } from "./storage";

export { ApiError };

export const sessionEvents = createEmitter<{ lost: undefined; passwordChangeRequired: undefined }>();
export const tokenStore = createTokenStore(secureStore);

export const api = createApiClient({
  baseUrl: API_BASE_URL || "http://configuration-missing.invalid",
  tokens: tokenStore,
  onSessionLost: () => sessionEvents.emit("lost", undefined),
  onPasswordChangeRequired: () => sessionEvents.emit("passwordChangeRequired", undefined),
});
