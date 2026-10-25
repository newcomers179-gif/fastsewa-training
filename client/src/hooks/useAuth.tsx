/**
 * Who is signed in. The tokens themselves live in the phone's keystore (lib/storage.ts) and are
 * handled by the API client; this layer decides which part of the app to show:
 *
 *   loading      → checking whether the stored session still works
 *   signedOut    → login / registration
 *   signedIn     → the app (or, while `user.mustChangePassword`, only the "choose a new password" screen)
 *   unreachable  → a session exists but the server cannot be reached and nothing is saved yet
 *
 * A signed-in person who loses signal keeps working: the profile is remembered in the keystore and the
 * course data in the offline cache, so opening the app in a basement shows their courses, not a login.
 */
import type { Lang } from "@shared/constants";
import { normalizeUsername } from "@shared/validation";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { currentLanguage, setLanguage as applyLanguage } from "@/i18n";
import { ApiError, api, sessionEvents, tokenStore } from "@/lib/api";
import { unregisterPushToken } from "@/lib/push";
import { forgetUserData } from "@/lib/queryClient";
import { forgetLegacyTokens, secureStore } from "@/lib/storage";
import type { AuthResult, AuthUser } from "@/types";

export type { AuthUser };
export type AuthStatus = "loading" | "signedOut" | "signedIn" | "unreachable";

export interface RegisterInput {
  username: string;
  password: string;
  displayName: string;
  email?: string;
  phoneNumber?: string;
  registrationCode?: string;
  acceptTerms: boolean;
  confirmAdult: boolean;
}

export interface ProfilePatch {
  displayName?: string;
  phoneNumber?: string | null;
  email?: string | null;
}

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** Shown once on the login screen after the server ended the session. */
  notice: "sessionEnded" | null;
  dismissNotice(): void;
  retry(): Promise<void>;
  login(username: string, password: string): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  logout(): Promise<void>;
  updateProfile(patch: ProfilePatch): Promise<void>;
  setLanguage(lang: Lang): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  deleteAccount(password: string): Promise<void>;
  exportData(): Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const USER_KEY = "fastsewa.user";
/** How long sign-out waits for the server before signing out on this phone regardless. */
const LOGOUT_WAIT_MS = 4000;

async function readCachedUser(): Promise<AuthUser | null> {
  try {
    const raw = await secureStore.getItem(USER_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<AuthUser>) : null;
    return parsed && typeof parsed.id === "string" && typeof parsed.username === "string" ? (parsed as AuthUser) : null;
  } catch {
    return null;
  }
}

async function cacheUser(user: AuthUser | null): Promise<void> {
  try {
    if (user) await secureStore.setItem(USER_KEY, JSON.stringify(user));
    else await secureStore.removeItem(USER_KEY);
  } catch {
    /* the profile is re-fetched at the next start */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [notice, setNotice] = useState<"sessionEnded" | null>(null);
  const userRef = useRef<AuthUser | null>(null);

  const adopt = useCallback(async (next: AuthUser) => {
    userRef.current = next;
    setUser(next);
    await cacheUser(next);
  }, []);

  const endSession = useCallback(async (reason: "sessionEnded" | null) => {
    userRef.current = null;
    setUser(null);
    setNotice(reason);
    setStatus("signedOut");
    await Promise.all([tokenStore.clear(), cacheUser(null), forgetUserData()]);
  }, []);

  const restore = useCallback(async () => {
    setStatus("loading");
    await forgetLegacyTokens();
    const { refreshToken, accessToken } = await tokenStore.read();
    if (!refreshToken && !accessToken) {
      setStatus("signedOut");
      return;
    }
    try {
      const me = await api.get<AuthUser>("/auth/me");
      await adopt(me);
      setStatus("signedIn");
    } catch (error) {
      const unreachable = error instanceof ApiError && (error.isConnectionProblem || error.status >= 500);
      if (unreachable) {
        const cached = await readCachedUser();
        if (cached) {
          userRef.current = cached;
          setUser(cached);
          setStatus("signedIn"); // offline: the offline cache serves the courses; the server is asked again on the next request
        } else {
          setStatus("unreachable");
        }
        return;
      }
      await endSession(null); // the stored session was refused: start from the login screen
    }
  }, [adopt, endSession]);

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    const offLost = sessionEvents.on("lost", () => {
      if (userRef.current) void endSession("sessionEnded");
    });
    const offPassword = sessionEvents.on("passwordChangeRequired", () => {
      const current = userRef.current;
      if (current && !current.mustChangePassword) void adopt({ ...current, mustChangePassword: true });
    });
    return () => {
      offLost();
      offPassword();
    };
  }, [adopt, endSession]);

  const startSession = useCallback(
    async (result: AuthResult) => {
      await forgetUserData(); // never inherit another person's cached courses
      await tokenStore.write({ accessToken: result.accessToken, refreshToken: result.refreshToken });
      await adopt(result.user);
      setNotice(null);
      setStatus("signedIn");
    },
    [adopt]
  );

  const login = useCallback(
    async (username: string, password: string) => {
      const result = await api.post<AuthResult>("/auth/login", { username: normalizeUsername(username), password }, { auth: false });
      await startSession(result);
      void applyLanguage(result.user.preferredLang); // the language chosen on an earlier phone follows the person
    },
    [startSession]
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const body = {
        username: normalizeUsername(input.username),
        password: input.password,
        displayName: input.displayName,
        email: input.email?.trim() || undefined,
        phoneNumber: input.phoneNumber?.trim() || undefined,
        registrationCode: input.registrationCode?.trim() || undefined,
        acceptTerms: input.acceptTerms,
        confirmAdult: input.confirmAdult,
        preferredLang: currentLanguage(),
      };
      const result = await api.post<AuthResult>("/auth/register", body, { auth: false });
      await startSession(result);
    },
    [startSession]
  );

  const logout = useCallback(async () => {
    const { refreshToken } = await tokenStore.read();
    // Best effort, and never for long: this phone is signed out whatever the server says.
    const serverSide = (async () => {
      try {
        await unregisterPushToken();
      } catch {
        /* offline: the server drops dead push addresses by itself */
      }
      try {
        await api.post("/auth/logout", { refreshToken: refreshToken ?? undefined }, { auth: false });
      } catch {
        /* the refresh token expires on its own */
      }
    })();
    await Promise.race([serverSide, new Promise<void>((resolve) => setTimeout(resolve, LOGOUT_WAIT_MS))]);
    await endSession(null);
  }, [endSession]);

  const updateProfile = useCallback(
    async (patch: ProfilePatch) => {
      await adopt(await api.patch<AuthUser>("/auth/me", patch));
    },
    [adopt]
  );

  const setLanguage = useCallback(
    async (lang: Lang) => {
      await applyLanguage(lang);
      const current = userRef.current;
      if (current && current.preferredLang !== lang) {
        try {
          await adopt(await api.patch<AuthUser>("/auth/me", { preferredLang: lang }));
        } catch {
          /* kept on this phone; the server copy is updated the next time the language is changed online */
        }
      }
    },
    [adopt]
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      // The server signs every other phone out and answers with a fresh session for this one.
      const result = await api.post<AuthResult>("/auth/change-password", { currentPassword, newPassword });
      await tokenStore.write({ accessToken: result.accessToken, refreshToken: result.refreshToken });
      await adopt(result.user);
    },
    [adopt]
  );

  const deleteAccount = useCallback(
    async (password: string) => {
      await api.delete("/auth/me", { password });
      await endSession(null);
    },
    [endSession]
  );

  const exportData = useCallback(async () => JSON.stringify(await api.get<unknown>("/auth/me/export"), null, 2), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      notice,
      dismissNotice: () => setNotice(null),
      retry: restore,
      login,
      register,
      logout,
      updateProfile,
      setLanguage,
      changePassword,
      deleteAccount,
      exportData,
    }),
    [status, user, notice, restore, login, register, logout, updateProfile, setLanguage, changePassword, deleteAccount, exportData]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** For screens that only exist while signed in. */
export function useUser(): AuthUser {
  const { user } = useAuth();
  if (!user) throw new Error("useUser was used on a screen that is shown while signed out");
  return user;
}
