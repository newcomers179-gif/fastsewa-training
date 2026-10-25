import { useState } from "react";
import { normalizeUsername } from "@shared/validation";
import { api, ApiError } from "../api";
import { formatDate, formatDateTime, timeAgo } from "../format";
import { useAction, useApi, useDocumentTitle } from "../hooks";
import { navigate } from "../router";
import { useSession } from "../session";
import type { TemporaryPassword, WorkerDetail } from "../types";
import { Badge, Button, EmptyState, ErrorNotice, Loading, Modal, Notice, PageHeader, Panel, ProgressBar, SecretBox, SelectField, TextField, fieldError, useConfirm, useToast } from "../ui";

type Detail = WorkerDetail;

function Facts({ user }: { user: Detail["user"] }) {
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "Username", value: <span className="mono">@{user.username}</span> },
    { label: "Phone", value: user.phoneNumber ?? "—" },
    { label: "E-mail", value: user.email ?? "—" },
    { label: "App language", value: user.preferredLang === "hi" ? "Hindi" : "English" },
    { label: "Joined", value: formatDateTime(user.createdAt) },
    { label: "Last signed in", value: user.lastLoginAt ? `${formatDateTime(user.lastLoginAt)} (${timeAgo(user.lastLoginAt)})` : "Never" },
    { label: "Privacy notice accepted", value: user.consentAcceptedAt ? `${formatDate(user.consentAcceptedAt)}${user.consentVersion ? ` · version ${user.consentVersion}` : ""}` : "Not recorded (registered before consent was collected)" },
  ];
  return (
    <dl className="facts">
      {rows.map(({ label, value }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EditDialog({ user, onClose, onSaved }: { user: Detail["user"]; onClose: () => void; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [phone, setPhone] = useState(user.phoneNumber ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [lang, setLang] = useState(user.preferredLang);
  const save = useAction(() =>
    api.patch(`/admin/workers/${user.id}`, {
      displayName,
      phoneNumber: phone.trim() === "" ? null : phone.trim(),
      email: email.trim() === "" ? null : email.trim(),
      preferredLang: lang,
    })
  );
  const err = save.error;
  const submit = async () => {
    if ((await save.run()).ok) onSaved();
  };
  return (
    <Modal
      title="Edit learner"
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
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
      >
        {err && Object.keys(err.fields).length === 0 && !["PHONE_INVALID", "EMAIL_TAKEN"].includes(err.code) ? (
          <div className="wide">
            <ErrorNotice error={err} />
          </div>
        ) : null}
        <TextField className="wide" label="Name" value={displayName} onChange={setDisplayName} required maxLength={60} error={fieldError(err, "displayName")} hint="Printed on certificates. English or Hindi letters only." />
        <TextField label="Phone" type="tel" value={phone} onChange={setPhone} autoComplete="off" error={err?.code === "PHONE_INVALID" ? err.message : fieldError(err, "phoneNumber")} hint="Indian mobile number, with or without +91" />
        <TextField label="E-mail" type="email" value={email} onChange={setEmail} autoComplete="off" error={err?.code === "EMAIL_TAKEN" ? err.message : fieldError(err, "email")} />
        <SelectField
          label="App language"
          value={lang}
          onChange={setLang}
          options={[
            { value: "en", label: "English" },
            { value: "hi", label: "Hindi" },
          ]}
        />
        <button type="submit" className="sr-only" tabIndex={-1}>
          Save
        </button>
      </form>
    </Modal>
  );
}

function EraseDialog({ user, onClose, onErased }: { user: Detail["user"]; onClose: () => void; onErased: () => void }) {
  const [typed, setTyped] = useState("");
  const erase = useAction(() => api.del(`/admin/workers/${user.id}`, { confirmUsername: typed.trim() }));
  const matches = normalizeUsername(typed) === user.username;
  return (
    <Modal
      title="Erase this learner’s data"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Keep the account</Button>
          <Button
            tone="danger"
            busy={erase.busy}
            disabled={!matches}
            onClick={async () => {
              if ((await erase.run()).ok) onErased();
            }}
          >
            Erase permanently
          </Button>
        </>
      }
    >
      <Notice tone="warn">
        <div>
          <p>
            <strong>This cannot be undone.</strong> {user.displayName}’s name, phone, e-mail and sign-in are removed and every device is signed out. Course progress and quiz attempts are deleted.
          </p>
          <p>Issued certificates stay verifiable by their number, but no longer show a name.</p>
        </div>
      </Notice>
      {erase.error ? <ErrorNotice error={erase.error} /> : null}
      <TextField label={`Type “${user.username}” to confirm`} value={typed} onChange={setTyped} autoComplete="off" spellCheck={false} />
    </Modal>
  );
}

export function LearnerDetail({ id }: { id: string }) {
  const { isAdmin } = useSession();
  const confirm = useConfirm();
  const toast = useToast();
  const detail = useApi<Detail>(`/admin/workers/${id}`);
  const [dialog, setDialog] = useState<"edit" | "erase" | null>(null);
  const [temp, setTemp] = useState<TemporaryPassword | null>(null);
  const d = detail.data;
  useDocumentTitle(d?.user.displayName ?? "Learner");

  const toggle = useAction(async (activate: boolean) => {
    await api.patch(`/admin/workers/${id}/${activate ? "activate" : "deactivate"}`);
    toast(activate ? "Account reactivated" : "Account deactivated — all sessions ended");
    detail.reload();
  });
  const reset = useAction(async () => {
    setTemp(await api.post<TemporaryPassword>(`/admin/workers/${id}/reset-password`));
    detail.reload();
  });

  if (detail.error instanceof ApiError && detail.error.status === 404) {
    return <EmptyState title="Learner not found" action={<a className="btn btn-secondary" href="#/learners">Back to learners</a>}>This account may have been erased.</EmptyState>;
  }
  if (!d) return detail.error ? <ErrorNotice error={detail.error} onRetry={detail.reload} /> : <Loading />;

  const { user } = d;
  const ask = async (activate: boolean) => {
    const ok = await confirm({
      title: activate ? `Reactivate ${user.displayName}?` : `Deactivate ${user.displayName}?`,
      body: activate ? "They will be able to sign in again with their current password." : "They are signed out of every device at once and cannot sign in until you reactivate the account. Their progress is kept.",
      confirmLabel: activate ? "Reactivate" : "Deactivate",
      tone: activate ? "primary" : "danger",
    });
    if (ok) await toggle.run(activate);
  };
  const askReset = async () => {
    const ok = await confirm({
      title: `Reset ${user.displayName}’s password?`,
      body: "You will get a one-time password to give them in person or by phone. They are signed out everywhere and must choose a new password the next time they sign in.",
      confirmLabel: "Create one-time password",
    });
    if (ok) await reset.run();
  };

  return (
    <>
      <PageHeader
        back={{ href: "#/learners", label: "All learners" }}
        title={
          <>
            {user.displayName} {user.isActive ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Deactivated</Badge>}
          </>
        }
        subtitle={`@${user.username}`}
        actions={
          isAdmin ? (
            <>
              <Button icon="edit" onClick={() => setDialog("edit")}>
                Edit
              </Button>
              <Button icon="key" busy={reset.busy} onClick={() => void askReset()}>
                Reset password
              </Button>
              <Button busy={toggle.busy} onClick={() => void ask(!user.isActive)}>
                {user.isActive ? "Deactivate" : "Reactivate"}
              </Button>
            </>
          ) : null
        }
      />
      {reset.error ? <ErrorNotice error={reset.error} /> : null}
      {toggle.error ? <ErrorNotice error={toggle.error} /> : null}
      {user.mustChangePassword ? <Notice tone="warn">This learner has a one-time password and has not chosen a new one yet.</Notice> : null}

      <div className="grid-2">
        <Panel title="Profile">
          <Facts user={user} />
        </Panel>
        <Panel title="Certificates" flush>
          {d.certificates.length === 0 ? (
            <EmptyState title="No certificates yet">A certificate is issued when every required lesson and quiz in a course is done.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Course</th>
                    <th>Number</th>
                    <th>Earned</th>
                  </tr>
                </thead>
                <tbody>
                  {d.certificates.map((c) => (
                    <tr key={c.id}>
                      <td className="primary-cell">{c.courseTitle}</td>
                      <td>
                        <a className="mono" href={`#/certificates?number=${encodeURIComponent(c.certificateNumber)}`}>
                          {c.certificateNumber}
                        </a>
                        {c.revokedAt ? <span className="sub"><Badge tone="bad">Withdrawn</Badge> {c.revokedReason}</span> : null}
                      </td>
                      <td className="nowrap">{formatDate(c.earnedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Courses" flush>
        {d.enrollments.length === 0 ? (
          <EmptyState title="Not enrolled in any course">They can enrol from the Learn tab of the app.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Progress</th>
                  <th>Enrolled</th>
                  <th>Finished</th>
                </tr>
              </thead>
              <tbody>
                {d.enrollments.map((e) => (
                  <tr key={e.courseId}>
                    <td className="primary-cell">
                      <a href={`#/courses/${e.courseId}`}>{e.courseTitle}</a>
                    </td>
                    <td>
                      <div className="bar-cell">
                        <ProgressBar percent={e.completionPercent} label={`${e.courseTitle} progress`} />
                        <span>{e.completionPercent}%</span>
                      </div>
                    </td>
                    <td className="nowrap">{formatDate(e.enrolledAt)}</td>
                    <td className="nowrap">{e.completedAt ? formatDate(e.completedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Module results" flush>
        {d.modules.length === 0 ? (
          <EmptyState title="No module started yet" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Module</th>
                  <th>Started</th>
                  <th>Quiz</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {d.modules.map((m) => (
                  <tr key={m.moduleId}>
                    <td className="primary-cell">{m.moduleTitle}</td>
                    <td className="nowrap">{formatDate(m.startedAt)}</td>
                    <td>
                      {m.quizScore === null ? (
                        <span className="muted">Not attempted</span>
                      ) : (
                        <>
                          {m.quizScore}% {m.quizPassed ? <Badge tone="good">Passed</Badge> : <Badge tone="warn">Not passed</Badge>}
                        </>
                      )}
                    </td>
                    <td className="nowrap">{m.completedAt ? formatDate(m.completedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {isAdmin ? (
        <Panel title="Erase personal data">
          <div className="cluster spread">
            <p className="muted danger-copy">
              If this person asks for their data to be deleted, erase it here. Their name, phone, e-mail and sign-in are removed and their progress is deleted. Certificates stay verifiable by number but no longer show a name.
            </p>
            <Button tone="danger" icon="trash" onClick={() => setDialog("erase")}>
              Erase data…
            </Button>
          </div>
        </Panel>
      ) : null}

      {dialog === "edit" ? (
        <EditDialog
          user={user}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            toast("Changes saved");
            detail.reload();
          }}
        />
      ) : null}
      {dialog === "erase" ? (
        <EraseDialog
          user={user}
          onClose={() => setDialog(null)}
          onErased={() => {
            toast("Learner data erased");
            navigate("/learners");
          }}
        />
      ) : null}
      {temp ? (
        <Modal title="One-time password" onClose={() => setTemp(null)} footer={<Button tone="primary" onClick={() => setTemp(null)}>Done</Button>}>
          <SecretBox label={`Password for @${temp.username}`} value={temp.temporaryPassword} />
          <Notice tone="warn">
            Give it to the learner privately. It is shown only now, and it stops working as soon as they choose their own password.
          </Notice>
        </Modal>
      ) : null}
    </>
  );
}
