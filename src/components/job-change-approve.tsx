"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";
import { approveJobChangeByTokenAction, declineJobChangeByTokenAction, type ApproveJobChangeActionResult } from "@/app/closeout-actions";
import { announceLiveRefresh } from "@/lib/live-refresh";
import { datumTid, kr } from "@/lib/format";
import { Modal } from "./modal";
import { buttonClasses, cx } from "./ui-classes";

const FOOTNOTE = "Godkännandet sparas tillsammans med ändringens innehåll och tidpunkt.";

/**
 * Kundens godkännande av en ändring: namn + knapp, samma mönster som
 * offertlänken. Servern är idempotent; sidan släpper aldrig iväg två anrop.
 */
export function JobChangeApproveForm({
  token,
  statement,
  prefillName,
  contentHash,
}: {
  token: string;
  statement: string;
  prefillName: string;
  contentHash: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(prefillName);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<ApproveJobChangeActionResult, { ok: true }> | null>(null);
  const [pending, startTransition] = useTransition();
  const submittedRef = useRef(false);
  const errorId = useId();
  const canSubmit = name.trim().length > 0 && !pending && !done;

  useEffect(() => {
    if (!done) return;
    router.refresh();
    announceLiveRefresh("job-change-approved");
  }, [done, router]);

  function submit() {
    if (!canSubmit || submittedRef.current) return;
    submittedRef.current = true;
    setError(null);
    startTransition(async () => {
      const result = await approveJobChangeByTokenAction(token, name, contentHash);
      if (result.ok) {
        setDone(result);
        return;
      }
      submittedRef.current = false;
      setError(result.error);
      if (result.code === "changed" || result.code === "not_approvable" || result.code === "declined") router.refresh();
    });
  }

  if (done) {
    return (
      <div
        data-change-approved=""
        className="mt-8 rounded-2xl border border-ok/25 bg-ok-soft/70 p-5 animate-fade-up"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-ok" />
          <div>
            <p className="text-[17px] font-semibold text-ok">Ändringen är godkänd</p>
            <p className="mt-1 text-[14px] text-soft">
              Godkänd {datumTid(done.approvedAt)} av {done.approvedByName} · {kr(done.amount)}
            </p>
            <p className="mt-2 text-[13px] text-muted">{FOOTNOTE}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form
      id="godkann-andring"
      data-change-approve-form=""
      method="post"
      className="mt-8 scroll-mt-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="godkann-andring-namn" className="block text-[13px] font-medium text-soft">
        Ditt namn
      </label>
      <input
        id="godkann-andring-namn"
        name="name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="name"
        autoCapitalize="words"
        enterKeyHint="done"
        maxLength={120}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        placeholder="För- och efternamn"
        data-testid="public-change-name"
        className="mt-1.5 h-12 w-full rounded-xl border border-line-strong bg-white px-3.5 text-[16px] text-ink placeholder:text-muted focus:border-accent focus:outline-none"
      />
      <p className="mt-4 text-[14px] leading-relaxed text-ink">{statement}</p>
      {error ? (
        <p id={errorId} role="alert" className="mt-3 text-[13px] font-medium text-danger">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        data-testid="public-change-approve"
        disabled={!canSubmit}
        className={cx(buttonClasses("primary", "lg"), "mt-4 w-full sm:w-auto")}
      >
        {pending ? "Godkänner …" : "Godkänn ändringen"}
      </button>
      <p className="mt-3 text-[12px] text-muted">{FOOTNOTE}</p>
      <div className="mt-4">
        <DeclineJobChangeButton token={token} />
      </div>
    </form>
  );
}

export function DeclineJobChangeButton({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const router = useRouter();
  return (
    <>
      <button
        type="button"
        data-testid="public-change-decline"
        className="text-[14px] font-medium text-muted underline-offset-2 hover:text-danger hover:underline"
        onClick={() => setOpen(true)}
      >
        Avböj ändringen
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Avböj ändringen" size="sm">
        <form
          className="space-y-4 px-6 py-5"
          action={async () => {
            await declineJobChangeByTokenAction(token, reason.trim() || undefined);
            setOpen(false);
            router.refresh();
            announceLiveRefresh("job-change-declined");
          }}
        >
          <p className="text-[14px] leading-relaxed text-soft">
            Vill du berätta varför? (frivilligt) Företaget ser ditt svar och kan skicka en ny version.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="T.ex. priset, omfattningen …"
            className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] placeholder:text-muted focus:border-accent"
          />
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClasses("ghost")} onClick={() => setOpen(false)}>
              <X className="size-4" /> Avbryt
            </button>
            <button type="submit" className={buttonClasses("danger")}>
              Avböj ändringen
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
