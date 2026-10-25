/** Who is signed in, the sign-in screen and the forced "choose a new password" screen. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { PASSWORD_MIN_STAFF, checkPassword } from "@shared/validation";
import { api, ApiError, hasStoredSession, login as apiLogin, logout as apiLogout, onPasswordChangeRequired, onSessionLost, setTokens } from "./api";
import type { AuthResult, PublicUser } from "./types";
import { Button, ErrorNotice, Notice, TextField, describeError, fieldError } from "./ui";

type Status = "loading" | "signedOut" | "mustChangePassword" | "ready";

interface SessionValue {
  status: Status;
  user: PublicUser | null;
  /** Why the person is looking at the sign-in screen (session ended, account disabled, …). */
  notice: string | null;
  isAdmin: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession outside SessionProvider");
  return value;
}

const isStaff = (user: PublicUser) => user.role === "admin" || user.role === "trainer";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(hasStoredSession() ? "loading" : "signedOut");
  const [user, setUser] = useState<PublicUser | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const finish = useCallback((next: PublicUser) => {
    setUser(next);
    setNotice(null);
    setStatus(next.mustChangePassword ? "mustChangePassword" : "ready");
  }, []);

  // Resume a session that survived a page reload.
  useEffect(() => {
    if (!hasStoredSession()) return;
    let cancelled = false;
    api
      .get<PublicUser>("/auth/me")
      .then(async (me) => {
        if (cancelled) return;
        if (!isStaff(me)) {
          await apiLogout();
          setStatus("signedOut");
          return;
        }
        finish(me);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.code === "PASSWORD_CHANGE_REQUIRED") return; // handled by the listener below
        setStatus("signedOut");
        if (error instanceof ApiError && error.code === "NETWORK") setNotice(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [finish]);

  useEffect(() => {
    const offLost = onSessionLost(() => {
      setUser(null);
      setStatus("signedOut");
      setNotice("Your session ended. Sign in again to continue.");
    });
    const offChange = onPasswordChangeRequired(() => setStatus("mustChangePassword"));
    return () => {
      offLost();
      offChange();
    };
  }, []);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const result: AuthResult = await apiLogin(username, password);
      if (!isStaff(result.user)) {
        // A learner's account: end the session the server just opened and say where learners go.
        setTokens(result);
        await apiLogout();
        throw new ApiError(403, "NOT_STAFF", "This console is for FastSewa staff. Learners use the mobile app.");
      }
      setTokens(result);
      finish(result.user);
    },
    [finish]
  );

  const signOut = useCallback(async () => {
    await apiLogout();
    setUser(null);
    setNotice(null);
    setStatus("signedOut");
    window.location.hash = "";
  }, []);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      const result = await api.post<AuthResult>("/auth/change-password", { currentPassword, newPassword });
      setTokens(result);
      finish(result.user);
    },
    [finish]
  );

  const value = useMemo<SessionValue>(
    () => ({ status, user, notice, isAdmin: user?.role === "admin", signIn, signOut, changePassword }),
    [status, user, notice, signIn, signOut, changePassword]
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

// ─── screens ─────────────────────────────────────────────────────────────────
function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="10" fill="#e8590c" />
      <path d="M12 46 32 14l20 32z" fill="none" stroke="#1f2a33" strokeWidth="6" strokeLinejoin="round" />
      <rect x="29" y="26" width="6" height="12" rx="2" fill="#1f2a33" />
      <circle cx="32" cy="42" r="3" fill="#1f2a33" />
    </svg>
  );
}
export { BrandMark };

export function SignInScreen() {
  const { signIn, notice } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(username, password);
    } catch (e) {
      setError(e);
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="signin">
      <section className="signin-side">
        <div className="brand">
          <BrandMark />
          <span className="brand-name">
            FastSewa
            <span className="brand-sub">Training programme</span>
          </span>
        </div>
        <div className="stack">
          <h1>Training records for every worker on site.</h1>
          <p>Add courses, check who has finished what, issue and verify certificates. This console is for FastSewa trainers and administrators only.</p>
        </div>
        <p className="small">Learners sign in on the FastSewa mobile app.</p>
      </section>
      <section className="signin-main">
        <form className="signin-card" onSubmit={submit} noValidate>
          <div>
            <h2 className="signin-title">Sign in</h2>
            <p className="muted">Use the username and password your administrator gave you.</p>
          </div>
          {notice ? <Notice tone="warn">{notice}</Notice> : null}
          {error ? <ErrorNotice error={error} /> : null}
          <TextField label="Username" value={username} onChange={setUsername} autoComplete="username" autoFocus required spellCheck={false} />
          <TextField label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" required />
          <Button type="submit" tone="primary" busy={busy} disabled={!username.trim() || !password}>
            Sign in
          </Button>
          <p className="muted small">Forgot your password? Ask an administrator for a one-time password.</p>
        </form>
      </section>
    </main>
  );
}

export function ChangePasswordForm({ onDone, forced = false }: { onDone?: () => void; forced?: boolean }) {
  const { changePassword, user } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | undefined>();

  const problem = next ? checkPassword(next, { username: user?.username, staff: true }) : null;
  const localError =
    problem === "PASSWORD_TOO_SHORT"
      ? `Use at least ${PASSWORD_MIN_STAFF} characters`
      : problem === "PASSWORD_TOO_COMMON"
        ? "That password is too easy to guess"
        : problem === "PASSWORD_SAME_AS_USERNAME"
          ? "The password cannot be your username"
          : problem === "PASSWORD_TOO_LONG"
            ? "That password is too long"
            : undefined;
  const mismatch = again && again !== next ? "The two passwords do not match" : undefined;
  const ready = current && next && again && !problem && !mismatch;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await changePassword(current, next);
      onDone?.();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "UNKNOWN", describeError(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit} noValidate>
      {forced ? <Notice tone="warn">Your administrator gave you a one-time password. Choose your own before you continue.</Notice> : null}
      {error && !error.fields.newPassword && error.code !== "CURRENT_PASSWORD_INCORRECT" ? <ErrorNotice error={error} /> : null}
      <TextField
        label="Current password"
        type="password"
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
        required
        error={error?.code === "CURRENT_PASSWORD_INCORRECT" ? "That is not your current password" : undefined}
      />
      <TextField
        label="New password"
        type="password"
        value={next}
        onChange={setNext}
        autoComplete="new-password"
        required
        hint={`At least ${PASSWORD_MIN_STAFF} characters. A few unrelated words make a strong, memorable password.`}
        error={localError ?? fieldError(error, "newPassword") ?? (error?.code?.startsWith("PASSWORD_") ? error.message : undefined)}
      />
      <TextField label="New password again" type="password" value={again} onChange={setAgain} autoComplete="new-password" required error={mismatch} />
      <div className="cluster">
        <Button type="submit" tone="primary" busy={busy} disabled={!ready}>
          Save new password
        </Button>
        {!forced && onDone ? <Button onClick={onDone}>Cancel</Button> : null}
      </div>
      {!forced ? <p className="muted small">You stay signed in here. Every other device is signed out.</p> : null}
    </form>
  );
}

export function ForcedPasswordScreen() {
  const { signOut, user } = useSession();
  return (
    <main className="signin">
      <section className="signin-side">
        <div className="brand">
          <BrandMark />
          <span className="brand-name">
            FastSewa
            <span className="brand-sub">Training programme</span>
          </span>
        </div>
        <div className="stack">
          <h1>Choose your own password.</h1>
          <p>The password you signed in with was set by someone else, so it is only good for this one step.</p>
        </div>
        <p className="small">Signed in as {user?.displayName}.</p>
      </section>
      <section className="signin-main">
        <div className="signin-card">
          <h2 className="signin-title">New password</h2>
          <ChangePasswordForm forced />
          <Button tone="quiet" onClick={() => void signOut()}>
            Sign out instead
          </Button>
        </div>
      </section>
    </main>
  );
}
