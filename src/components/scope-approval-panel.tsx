"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveScopeEntryAction, revokeScopeApprovalAction } from "@/app/omfattning-actions";
import type { ScopeApproval } from "@/lib/types";
import type { SupportEntry } from "@/lib/support/matrix";
import { buttonClasses, cx } from "./ui";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";

/**
 * Konsultens godkännande av ett konsultfall i klientens bolag. Servern
 * kräver capability approve_scope – panelen visas därför bara för den
 * som kan godkänna (`canApprove`), men beslutet fattas på servern.
 */
export function ScopeApprovalPanel({
  businessId,
  entry,
  approval,
  canApprove,
}: {
  businessId: string;
  entry: SupportEntry;
  approval: ScopeApproval | undefined;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-canvas px-3.5 py-3" data-scope-approval={entry.id}>
      {approval ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="text-[13px]">
            <p className="font-medium text-ok">
              Godkänt {approval.approvedAt.slice(0, 10)} av {approval.approvedBy.name || approval.approvedBy.email}
            </p>
            <p className="text-muted">
              Matris {approval.matrixVersion || "okänd"}
              {approval.note ? ` · ${approval.note}` : ""}
            </p>
          </div>
          {canApprove ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => revokeScopeApprovalAction({ businessId, entryId: entry.id }))}
              className={buttonClasses("secondary", "sm")}
              data-scope-revoke
            >
              Återkalla
            </button>
          ) : null}
        </div>
      ) : canApprove ? (
        <div className="space-y-2">
          <p className="text-[13px] text-soft">
            Godkänn bara om du själv tar ansvar för fallet i klientens bokföring och deklaration. Godkännandet
            auditloggas och kan återkallas.
          </p>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-soft">Not (valfritt)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="T.ex. underentreprenör åt två byggbolag, momsdeklaration granskas av oss månadsvis"
              className={inputCls}
              disabled={pending}
            />
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => approveScopeEntryAction({ businessId, entryId: entry.id, note }))}
            className={cx(buttonClasses("primary", "sm"))}
            data-scope-approve
          >
            {pending ? "Sparar …" : "Godkänn för det här bolaget"}
          </button>
        </div>
      ) : (
        <p className="text-[13px] text-soft">Väntar på godkännande av bolagets redovisningskonsult.</p>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
