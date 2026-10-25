import { useState } from "react";
import { isValidDisplayName, isValidEmail, isValidUsername, normalizeDisplayName, normalizeEmail, normalizeUsername, PASSWORD_MIN_STAFF, USERNAME_MAX, USERNAME_MIN } from "@shared/validation";
import { api, ApiError } from "../api";
import { timeAgo } from "../format";
import { useAction, useApi, useDocumentTitle } from "../hooks";
import { useSession } from "../session";
import type { StaffRow } from "../types";
import { Badge, Button, EmptyState, ErrorNotice, Loading, Modal, Notice, PageHeader, Panel, SecretBox, SelectField, TextField, describeError, fieldError, useConfirm, useToast } from "../ui";

type StaffRole = StaffRow["role"];
const ROLE_OPTIONS: readonly { value: StaffRole; label: string }[] = [
  { value: "trainer", label: "Trainer — can look, cannot change" },
  { value: "admin", label: "Administrator — can change everything" },
];
const roleName = (role: StaffRole) => (role === "admin" ? "Administrator" : "Trainer");

interface Secret {
  title: string;
  username: string;
  password: string;
  note: string;
}

function AddDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (secret: Secret) => void }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<StaffRole>("trainer");
  const [email, setEmail] = useState("");
  const [problems, setProblems] = useState<Record<string, string>>({});
  const create = useAction(() =>
    api.post<{ user: StaffRow; temporaryPassword: string }>("/admin/staff", {
      username: normalizeUsername(username),
      displayName: normalizeDisplayName(displayName),
      role,
      email: email.trim() === "" ? null : normalizeEmail(email),
    })
  );
  const err = create.error;
  const shown = (field: string, code?: string) => problems[field] ?? (code && err?.code === code ? err.message : fieldError(err, field));

  const submit = async () => {
    const found: Record<string, string> = {};
    if (!isValidUsername(normalizeUsername(username))) found.username = `${USERNAME_MIN}–${USERNAME_MAX} characters: lowercase letters, digits and underscore`;
    if (!isValidDisplayName(normalizeDisplayName(displayName))) found.displayName = "Use English or Hindi letters only (no digits or symbols)";
    if (email.trim() !== "" && !isValidEmail(normalizeEmail(email))) found.email = "That does not look like an e-mail address";
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    const result = await create.run();
    if (result.ok) {
      onCreated({
        title: "Staff account created",
        username: result.value.user.username,
        password: result.value.temporaryPassword,
        note: `Give this one-time password to ${result.value.user.displayName} privately. At first sign-in they must choose their own password of at least ${PASSWORD_MIN_STAFF} characters.`,
      });
    }
  };

  const generic = err && Object.keys(err.fields).length === 0 && !["USERNAME_TAKEN", "EMAIL_TAKEN"].includes(err.code);
  return (
    <Modal
      title="Add a staff member"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" busy={create.busy} onClick={() => void submit()}>
            Create account
          </Button>
        </>
      }
    >
      <form
        className="form-grid"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {generic ? (
          <div className="wide">
            <ErrorNotice error={err} />
          </div>
        ) : null}
        <TextField label="Name" required autoFocus maxLength={60} value={displayName} onChange={setDisplayName} error={shown("displayName")} />
        <TextField label="Username" required maxLength={USERNAME_MAX} value={username} onChange={setUsername} autoComplete="off" spellCheck={false} error={shown("username", "USERNAME_TAKEN")} hint="They sign in with this. It cannot be changed later." />
        <SelectField className="wide" label="Role" value={role} onChange={setRole} options={ROLE_OPTIONS} />
        <TextField className="wide" label="E-mail" type="email" value={email} onChange={setEmail} autoComplete="off" error={shown("email", "EMAIL_TAKEN")} hint="Optional." />
        <button type="submit" className="sr-only" tabIndex={-1}>
          Create
        </button>
      </form>
      <Notice tone="info">A one-time password is created for the account and shown once, on the next screen.</Notice>
    </Modal>
  );
}

function EditDialog({ row, isSelf, onClose, onSaved }: { row: StaffRow; isSelf: boolean; onClose: () => void; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(row.displayName);
  const [role, setRole] = useState<StaffRole>(row.role);
  const [problem, setProblem] = useState<string | undefined>();
  const save = useAction(() => api.patch(`/admin/staff/${row.id}`, { displayName: normalizeDisplayName(displayName), ...(role !== row.role ? { role } : {}) }));
  const err = save.error;

  const submit = async () => {
    if (!isValidDisplayName(normalizeDisplayName(displayName))) {
      setProblem("Use English or Hindi letters only (no digits or symbols)");
      return;
    }
    setProblem(undefined);
    if ((await save.run()).ok) onSaved();
  };

  return (
    <Modal
      title={`Edit ${row.displayName}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" busy={save.busy} onClick={() => void submit()}>
            Save changes
          </Button>
        </>
      }
    >
      {err && Object.keys(err.fields).length === 0 ? <ErrorNotice error={err} /> : null}
      <form
        className="form-grid"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <TextField className="wide" label="Name" required maxLength={60} value={displayName} onChange={setDisplayName} error={problem ?? fieldError(err, "displayName")} />
        <SelectField className="wide" label="Role" value={role} onChange={setRole} options={ROLE_OPTIONS} disabled={isSelf} hint={isSelf ? "You cannot change your own role. Ask another administrator." : "A role change takes effect immediately, even if the person is signed in."} />
        <button type="submit" className="sr-only" tabIndex={-1}>
          Save
        </button>
      </form>
    </Modal>
  );
}

export function Staff() {
  useDocumentTitle("Staff accounts");
  const { user: me } = useSession();
  const confirm = useConfirm();
  const toast = useToast();
  const list = useApi<StaffRow[]>("/admin/staff");
  const [dialog, setDialog] = useState<null | { kind: "add" } | { kind: "edit"; row: StaffRow }>(null);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = async (id: string, work: () => Promise<void>) => {
    setBusyId(id);
    try {
      await work();
    } catch (failure) {
      toast(failure instanceof ApiError ? describeError(failure) : "Something went wrong", "bad");
    } finally {
      setBusyId(null);
    }
  };

  const setActive = async (row: StaffRow, active: boolean) => {
    const ok = await confirm({
      title: active ? `Reactivate ${row.displayName}?` : `Deactivate ${row.displayName}?`,
      body: active ? "They can sign in again with their current password." : "They are signed out everywhere at once and cannot sign in until you reactivate the account.",
      confirmLabel: active ? "Reactivate" : "Deactivate",
      tone: active ? "primary" : "danger",
    });
    if (!ok) return;
    await run(row.id, async () => {
      await api.patch(`/admin/staff/${row.id}`, { isActive: active });
      toast(active ? "Account reactivated" : "Account deactivated");
      list.reload();
    });
  };

  const resetPassword = async (row: StaffRow) => {
    const ok = await confirm({ title: `Reset ${row.displayName}’s password?`, body: "They are signed out everywhere and must choose a new password the next time they sign in. You will get a one-time password to give them.", confirmLabel: "Create one-time password" });
    if (!ok) return;
    await run(row.id, async () => {
      const result = await api.post<{ username: string; temporaryPassword: string }>(`/admin/staff/${row.id}/reset-password`);
      setSecret({ title: "One-time password", username: result.username, password: result.temporaryPassword, note: `Give it to ${row.displayName} privately. It stops working as soon as they choose their own password.` });
      list.reload();
    });
  };

  const rows = list.data ?? [];
  return (
    <>
      <PageHeader
        title="Staff accounts"
        subtitle="Administrators can change everything. Trainers can look at learners, courses and certificates but cannot change anything."
        actions={
          <Button tone="primary" icon="plus" onClick={() => setDialog({ kind: "add" })}>
            Add a staff member
          </Button>
        }
      />
      <Panel flush>
        {list.error ? (
          <div className="panel-body">
            <ErrorNotice error={list.error} onRetry={list.reload} />
          </div>
        ) : null}
        {!list.data && !list.error ? <Loading /> : null}
        {list.data && rows.length === 0 ? <EmptyState title="No staff accounts" /> : null}
        {rows.length > 0 ? (
          <div className="table-wrap" aria-busy={list.loading}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last signed in</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isSelf = row.id === me?.id;
                  const busy = busyId === row.id;
                  return (
                    <tr key={row.id}>
                      <td className="primary-cell">
                        {row.displayName} {isSelf ? <Badge tone="info">You</Badge> : null}
                        <span className="sub">
                          @{row.username}
                          {row.email ? ` · ${row.email}` : ""}
                        </span>
                      </td>
                      <td>{row.role === "admin" ? <Badge tone="info">{roleName(row.role)}</Badge> : <Badge>{roleName(row.role)}</Badge>}</td>
                      <td>
                        {row.isActive ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Deactivated</Badge>}
                        {row.mustChangePassword ? <span className="sub">Has not set a password yet</span> : null}
                      </td>
                      <td className="nowrap">{timeAgo(row.lastLoginAt)}</td>
                      <td className="actions">
                        <div className="row-actions">
                          <Button small onClick={() => setDialog({ kind: "edit", row })}>
                            Edit
                          </Button>
                          <Button small disabled={isSelf || busy} onClick={() => void resetPassword(row)} title={isSelf ? "Use “Change password” in the side menu for your own account" : undefined}>
                            Reset password
                          </Button>
                          <Button small disabled={isSelf || busy} onClick={() => void setActive(row, !row.isActive)} title={isSelf ? "You cannot deactivate yourself" : undefined}>
                            {row.isActive ? "Deactivate" : "Reactivate"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>
      <p className="muted small">The system always keeps at least one active administrator. Staff passwords need at least {PASSWORD_MIN_STAFF} characters.</p>

      {dialog?.kind === "add" ? (
        <AddDialog
          onClose={() => setDialog(null)}
          onCreated={(created) => {
            setDialog(null);
            setSecret(created);
            list.reload();
          }}
        />
      ) : null}
      {dialog?.kind === "edit" ? (
        <EditDialog
          row={dialog.row}
          isSelf={dialog.row.id === me?.id}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            toast("Changes saved");
            list.reload();
          }}
        />
      ) : null}
      {secret ? (
        <Modal title={secret.title} onClose={() => setSecret(null)} footer={<Button tone="primary" onClick={() => setSecret(null)}>Done</Button>}>
          <SecretBox label={`One-time password for @${secret.username}`} value={secret.password} />
          <Notice tone="warn">{secret.note}</Notice>
        </Modal>
      ) : null}
    </>
  );
}
