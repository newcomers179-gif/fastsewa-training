import { useState } from "react";
import { api } from "../api";
import { formatNumber } from "../format";
import { useAction, useDocumentTitle } from "../hooks";
import type { BroadcastResult } from "../types";
import { Button, ErrorNotice, Notice, PageHeader, Panel, TextField, fieldError, useConfirm, useToast } from "../ui";

const TITLE_MAX = 65;
const BODY_MAX = 240;

function Counter({ used, max }: { used: number; max: number }) {
  return (
    <p className={`counter${used > max ? " over" : ""}`} aria-live="polite">
      {used} / {max}
    </p>
  );
}

export function Broadcast() {
  useDocumentTitle("Notifications");
  const confirm = useConfirm();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [result, setResult] = useState<BroadcastResult | null>(null);

  const send = useAction(() => api.post<BroadcastResult>("/admin/notify/broadcast", { title: title.trim(), body: body.trim() }));

  const submit = async () => {
    const found: Record<string, string> = {};
    if (title.trim() === "") found.title = "Write a short headline";
    else if (title.trim().length > TITLE_MAX) found.title = `Keep the headline to ${TITLE_MAX} characters`;
    if (body.trim() === "") found.body = "Write the message";
    else if (body.trim().length > BODY_MAX) found.body = `Keep the message to ${BODY_MAX} characters`;
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    const ok = await confirm({
      title: "Send to every learner?",
      body: "This goes to the phone of every active learner who has the app installed and notifications turned on. It cannot be recalled.",
      confirmLabel: "Send now",
    });
    if (!ok) return;
    const outcome = await send.run();
    if (outcome.ok) {
      setResult(outcome.value);
      setTitle("");
      setBody("");
      toast(outcome.value.devices === 0 ? "Nothing was sent: no phones are registered yet" : `Sent to ${formatNumber(outcome.value.sent)} phones`);
    }
  };

  return (
    <>
      <PageHeader title="Notifications" subtitle="Send one message to all learners’ phones — a new course, a safety reminder, a holiday notice." />
      <div className="grid-2">
        <Panel title="Write the message">
          {send.error && Object.keys(send.error.fields).length === 0 ? <ErrorNotice error={send.error} /> : null}
          <form
            className="stack"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div>
              <TextField label="Headline" required maxLength={TITLE_MAX + 20} value={title} onChange={setTitle} error={problems.title ?? fieldError(send.error, "title")} />
              <Counter used={title.trim().length} max={TITLE_MAX} />
            </div>
            <div>
              <TextField label="Message" required multiline rows={4} maxLength={BODY_MAX + 40} value={body} onChange={setBody} error={problems.body ?? fieldError(send.error, "body")} hint="Phones show only the first few lines, so put the important part first. Hindi works." />
              <Counter used={body.trim().length} max={BODY_MAX} />
            </div>
            <div>
              <Button type="submit" tone="primary" icon="megaphone" busy={send.busy}>
                Send to all learners
              </Button>
            </div>
          </form>
        </Panel>

        <Panel title="How it looks on a phone">
          <div className="phone-note" aria-label="Preview of the notification">
            <span className="phone-note-app">FastSewa · now</span>
            <strong>{title.trim() || "Headline"}</strong>
            <span>{body.trim() || "Your message appears here."}</span>
          </div>
          <p className="muted small">Learners who have turned notifications off, or who have not opened the app since it was installed, will not receive it.</p>
        </Panel>
      </div>

      {result ? (
        <Panel title="Last message sent">
          {result.devices === 0 ? (
            <Notice tone="warn">No phones are registered for notifications yet. Learners need to open the updated app and allow notifications first.</Notice>
          ) : (
            <dl className="stats" aria-label="Delivery">
              <div className="stat">
                <dt>Phones reached</dt>
                <dd>{formatNumber(result.sent)}</dd>
              </div>
              <div className="stat">
                <dt>Registered phones</dt>
                <dd>{formatNumber(result.devices)}</dd>
              </div>
              <div className="stat">
                <dt>Failed</dt>
                <dd>{formatNumber(result.failed)}</dd>
              </div>
              <div className="stat">
                <dt>Switched off</dt>
                <dd>
                  {formatNumber(result.disabled)}
                  <span className="stat-note">no longer valid (app removed)</span>
                </dd>
              </div>
            </dl>
          )}
        </Panel>
      ) : null}
    </>
  );
}
