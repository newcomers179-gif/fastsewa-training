import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { formatDate, formatDateTime } from "../format";
import { useAction, useApi, useDocumentTitle } from "../hooks";
import { useQueryState } from "../router";
import { useSession } from "../session";
import type { CertificateInfo } from "../types";
import { Badge, Button, EmptyState, ErrorNotice, Loading, Modal, Notice, PageHeader, Panel, TextField, fieldError, useConfirm, useToast } from "../ui";

function WithdrawDialog({ certificate, onClose, onDone }: { certificate: CertificateInfo; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | undefined>();
  const revoke = useAction(() => api.post(`/admin/certificates/${certificate.id}/revoke`, { reason: reason.trim() }));

  const submit = async () => {
    if (reason.trim().length < 3) {
      setProblem("Say why it is being withdrawn (at least 3 letters)");
      return;
    }
    setProblem(undefined);
    if ((await revoke.run()).ok) onDone();
  };

  return (
    <Modal
      title="Withdraw this certificate"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Keep it valid</Button>
          <Button tone="danger" busy={revoke.busy} onClick={() => void submit()}>
            Withdraw certificate
          </Button>
        </>
      }
    >
      <Notice tone="warn">
        <div>
          <p>
            <strong>{certificate.certificateNumber}</strong> — {certificate.holderName}, {certificate.courseTitle}.
          </p>
          <p>Anyone who checks this number, including by scanning the QR code on the certificate, will be told it is no longer valid. You can reinstate it later.</p>
        </div>
      </Notice>
      {revoke.error ? <ErrorNotice error={revoke.error} /> : null}
      <TextField label="Reason" required multiline rows={3} maxLength={300} autoFocus value={reason} onChange={setReason} error={problem ?? fieldError(revoke.error, "reason")} hint="Kept in the audit log. It is not shown to the public." />
    </Modal>
  );
}

function Result({ certificate, onChanged }: { certificate: CertificateInfo; onChanged: () => void }) {
  const { isAdmin } = useSession();
  const confirm = useConfirm();
  const toast = useToast();
  const [withdrawing, setWithdrawing] = useState(false);
  const reinstate = useAction(async () => {
    await api.post(`/admin/certificates/${certificate.id}/reinstate`);
    toast("Certificate reinstated — it is valid again");
    onChanged();
  });

  const askReinstate = async () => {
    const ok = await confirm({ title: "Reinstate this certificate?", body: `${certificate.certificateNumber} will be reported as valid again to anyone who checks it.`, confirmLabel: "Reinstate" });
    if (ok) await reinstate.run();
  };

  return (
    <Panel
      title={
        <>
          <span className="mono">{certificate.certificateNumber}</span> {certificate.revoked ? <Badge tone="bad">Withdrawn</Badge> : <Badge tone="good">Valid</Badge>}
        </>
      }
      actions={
        isAdmin ? (
          certificate.revoked ? (
            <Button busy={reinstate.busy} onClick={() => void askReinstate()}>
              Reinstate
            </Button>
          ) : (
            <Button tone="danger" onClick={() => setWithdrawing(true)}>
              Withdraw
            </Button>
          )
        ) : null
      }
    >
      {reinstate.error ? <ErrorNotice error={reinstate.error} /> : null}
      <dl className="facts">
        <div>
          <dt>Awarded to</dt>
          <dd>
            <a href={`#/learners/${certificate.userId}`}>{certificate.holderName}</a> <span className="muted">@{certificate.username}</span>
          </dd>
        </div>
        <div>
          <dt>Course</dt>
          <dd>
            <a href={`#/courses/${certificate.courseId}`}>{certificate.courseTitle}</a>
          </dd>
        </div>
        <div>
          <dt>Earned on</dt>
          <dd>{formatDate(certificate.earnedAt)}</dd>
        </div>
        {certificate.revoked ? (
          <>
            <div>
              <dt>Withdrawn on</dt>
              <dd>{formatDateTime(certificate.revokedAt)}</dd>
            </div>
            <div>
              <dt>Reason</dt>
              <dd className="pre-line">{certificate.revokedReason}</dd>
            </div>
          </>
        ) : null}
        <div>
          <dt>Public page</dt>
          <dd>
            <a href={`/verify/${encodeURIComponent(certificate.certificateNumber)}`} target="_blank" rel="noopener noreferrer">
              What an employer sees
            </a>
          </dd>
        </div>
      </dl>
      {withdrawing ? (
        <WithdrawDialog
          certificate={certificate}
          onClose={() => setWithdrawing(false)}
          onDone={() => {
            setWithdrawing(false);
            toast("Certificate withdrawn");
            onChanged();
          }}
        />
      ) : null}
    </Panel>
  );
}

export function Certificates() {
  useDocumentTitle("Certificates");
  const [filters, setFilters] = useQueryState({ number: "" });
  const [input, setInput] = useState(filters.number);
  const [problem, setProblem] = useState<string | undefined>();
  useEffect(() => setInput(filters.number), [filters.number]);

  const lookup = useApi<CertificateInfo>(filters.number ? "/admin/certificates/lookup" : null, { number: filters.number });
  const notFound = lookup.error instanceof ApiError && lookup.error.status === 404;

  const submit = () => {
    const number = input.trim();
    if (number.length < 4) {
      setProblem("Enter the whole certificate number, as printed on the certificate");
      return;
    }
    setProblem(undefined);
    if (number === filters.number) lookup.reload();
    else setFilters({ number });
  };

  return (
    <>
      <PageHeader title="Certificates" subtitle="Check a certificate by its number, and withdraw one that was issued by mistake." />
      <Panel>
        <form
          className="filters"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="grow">
            <TextField label="Certificate number" value={input} onChange={setInput} placeholder="FSWA-…" autoComplete="off" spellCheck={false} error={problem} />
          </div>
          <Button type="submit" tone="primary" icon="search" busy={lookup.loading && !!filters.number}>
            Look up
          </Button>
        </form>
      </Panel>

      {filters.number === "" ? <EmptyState title="Look up a certificate">Type the number printed on the certificate, or scan its QR code and copy the number from the page that opens.</EmptyState> : null}
      {filters.number !== "" && !lookup.data && lookup.loading ? <Loading /> : null}
      {notFound ? (
        <EmptyState title="No certificate has that number">Check it against the printed certificate. Numbers start with FSWA- and use only letters, digits and hyphens.</EmptyState>
      ) : lookup.error ? (
        <ErrorNotice error={lookup.error} onRetry={lookup.reload} />
      ) : null}
      {lookup.data && filters.number !== "" && !notFound ? <Result certificate={lookup.data} onChanged={lookup.reload} /> : null}
    </>
  );
}
