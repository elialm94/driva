"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Modal } from "./modal";
import { buttonClasses } from "./ui";
import { kr } from "@/lib/format";
import { QUOTE_EXCESS_WARN_AMOUNT, QUOTE_EXCESS_WARN_PERCENT } from "@/lib/quote-excess";
import { CustomerEmailPrompt } from "./customer-email-prompt";
import { useBlockedAction } from "./blocked-action";
import type { PendingAction } from "@/lib/missing-requirements";

function withFlag(href: string, key: string, value: string) {
  const url = new URL(href, "https://driva.local");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

export function InvoiceDraftSend({
  documentId,
  customerId,
  customerName,
  amount,
  dueDateLabel,
  sendAction,
  detailHref,
  recipientEmail,
  hasIssuanceBlockers = false,
  mailConfigured: _mailConfigured = true,
  excessAmount,
  tillaggHref,
}: {
  documentId: string;
  customerId: string;
  customerName: string;
  amount: number;
  dueDateLabel: string;
  sendAction: () => Promise<void | { ok: boolean; errors?: string[]; issued?: boolean; mailed?: boolean }>;
  detailHref: string;
  recipientEmail?: string;
  hasIssuanceBlockers?: boolean;
  /** Om e-postutskick är konfigurerat på servern – styr ärlig text i dialogen. */
  mailConfigured?: boolean;
  /** Positivt belopp om fakturan överstiger tröskeln; annars utelämnas varningen. */
  excessAmount?: number;
  tillaggHref?: string;
}) {
  const router = useRouter();
  const [warnOpen, setWarnOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, startSending] = useTransition();
  const needsWarning = (excessAmount ?? 0) > 0 && !!tillaggHref;
  const pendingAction: PendingAction = { kind: "SEND_INVOICE", documentId, customerId };

  function openConfirm() {
    setSendError(null);
    setConfirmOpen(true);
  }

  function afterExcessContinue() {
    setWarnOpen(false);
    openConfirm();
  }

  /** Nästa steg efter att kraven är uppfyllda: ev. beloppsvarning, sedan bekräftelse. */
  function continueSendFlow() {
    if (needsWarning) setWarnOpen(true);
    else openConfirm();
  }

  const { email, collecting, requestAction, resumeAfterResolve, cancelCollect } = useBlockedAction({
    action: pendingAction,
    customerEmail: recipientEmail,
    onResume: continueSendFlow,
  });

  function requestSend() {
    if (hasIssuanceBlockers) {
      document.getElementById("invoice-send-blockers")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    requestAction();
  }

  function finish(flag: "skickad" | "leveransfel", value = "1") {
    router.replace(withFlag(detailHref, flag, value));
    router.refresh();
  }

  function confirmSend() {
    if (isSending) return;
    startSending(async () => {
      setSendError(null);
      const result = await sendAction();
      if (result && result.ok === false) {
        setSendError((result.errors ?? []).join(" ") || "Fakturan kunde inte skickas. Försök igen.");
        if (result.issued) finish("leveransfel");
        return;
      }
      finish("skickad", "1");
    });
  }

  return (
    <>
      {hasIssuanceBlockers ? null : (
        <button
          type="button"
          className={buttonClasses("primary")}
          onClick={requestSend}
          disabled={isSending}
        >
          <Send className="size-4" />
          Skicka faktura
        </button>
      )}

      <Modal open={confirmOpen} onClose={() => !isSending && setConfirmOpen(false)} size="sm" title="Skicka faktura?">
        <div className="px-6 py-5">
          <p className="text-[17px] font-semibold tracking-tight text-ink">{customerName}</p>
          <p className="mt-1 text-[15px] text-soft">{kr(amount)}</p>
          <p className="mt-1 text-[14px] text-muted">Förfaller {dueDateLabel}</p>
          <p className="mt-4 text-[14px] leading-relaxed text-soft">
            Fakturan skickas till: <span className="font-semibold text-ink">{email}</span>
          </p>
          {sendError ? <p className="mt-3 text-[13px] font-medium text-danger">{sendError}</p> : null}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button className={buttonClasses("secondary")} disabled={isSending} onClick={() => setConfirmOpen(false)}>
              Avbryt
            </button>
            <button className={buttonClasses("primary")} disabled={isSending} onClick={confirmSend}>
              <Send className="size-4" />
              {isSending ? "Skickar …" : sendError ? "Försök igen" : "Skicka faktura"}
            </button>
          </div>
        </div>
      </Modal>

      <CustomerEmailPrompt
        open={collecting === "buyer_email"}
        onClose={cancelCollect}
        pendingAction={pendingAction}
        onResolved={resumeAfterResolve}
      />

      <Modal open={warnOpen} onClose={() => setWarnOpen(false)} size="sm" title="Högre än den godkända offerten">
        <div className="px-6 py-5">
          <p className="text-[15px] leading-relaxed text-soft">
            Den här fakturan är <span className="font-semibold text-ink">{kr(excessAmount ?? 0)}</span> högre än den
            offert kunden godkände med BankID.
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            Vi varnar när beloppet är mer än {kr(QUOTE_EXCESS_WARN_AMOUNT)} eller {QUOTE_EXCESS_WARN_PERCENT} % högre än
            offerten. Du kan skicka ändå, eller skapa en tilläggsoffert som kunden kan godkänna med BankID.
          </p>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button className={buttonClasses("secondary")} onClick={() => tillaggHref && router.push(tillaggHref)}>
              Skapa tilläggsoffert
            </button>
            <button className={buttonClasses("primary")} onClick={afterExcessContinue}>
              Fortsätt
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
