"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Modal } from "./modal";
import { buttonClasses } from "./ui";
import { kr } from "@/lib/format";
import { CustomerEmailPrompt } from "./customer-email-prompt";
import { useBlockedAction } from "./blocked-action";
import type { PendingAction } from "@/lib/missing-requirements";

function withFlag(href: string, key: string, value: string) {
  const url = new URL(href, "https://driva.local");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

export function QuoteDraftSend({
  documentId,
  customerId,
  customerName,
  amount,
  validUntilLabel,
  sendAction,
  detailHref,
  recipientEmail,
  hasSendBlockers = false,
  mailConfigured: _mailConfigured = true,
}: {
  documentId: string;
  customerId: string;
  customerName: string;
  amount: number;
  validUntilLabel: string;
  sendAction: () => Promise<void | { ok: boolean; errors?: string[]; mailed?: boolean; demo?: boolean }>;
  detailHref: string;
  recipientEmail?: string;
  hasSendBlockers?: boolean;
  /** Om e-postutskick är konfigurerat på servern – styr ärlig text i dialogen. */
  mailConfigured?: boolean;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, startSending] = useTransition();
  const pendingAction: PendingAction = { kind: "SEND_QUOTE", documentId, customerId };

  const { email, collecting, requestAction, resumeAfterResolve, cancelCollect } = useBlockedAction({
    action: pendingAction,
    customerEmail: recipientEmail,
    onResume: () => {
      setSendError(null);
      setConfirmOpen(true);
    },
  });

  function requestSend() {
    setSendError(null);
    if (hasSendBlockers) {
      // Checklistan "Innan offerten kan skickas" förklarar vad som behövs.
      document.getElementById("quote-send-blockers")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    requestAction();
  }

  function finish(value = "1") {
    router.replace(withFlag(detailHref, "skickad", value));
    router.refresh();
  }

  function confirmSend() {
    if (isSending) return;
    startSending(async () => {
      setSendError(null);
      const result = await sendAction();
      if (result && result.ok === false) {
        setSendError((result.errors ?? []).join(" ") || "Offerten kunde inte skickas. Försök igen.");
        return;
      }
      // "demo": demoföretaget – notisen berättar att mejlet simulerades.
      finish(result && result.demo ? "demo" : "1");
    });
  }

  return (
    <>
      <button className={buttonClasses("primary")} onClick={requestSend}>
        <Send className="size-4" />
        Skicka offert
      </button>

      <Modal open={confirmOpen} onClose={() => !isSending && setConfirmOpen(false)} size="sm" title="Skicka offert?">
        <div className="px-6 py-5">
          <p className="text-[17px] font-semibold tracking-tight text-ink">{customerName}</p>
          <p className="mt-1 text-[15px] text-soft">{kr(amount)}</p>
          <p className="mt-1 text-[14px] text-muted">Giltig till {validUntilLabel}</p>
          <p className="mt-4 text-[14px] leading-relaxed text-soft">
            Offerten skickas till: <span className="font-semibold text-ink">{email}</span>
          </p>
          {sendError ? <p className="mt-3 text-[13px] font-medium text-danger">{sendError}</p> : null}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button className={buttonClasses("secondary")} disabled={isSending} onClick={() => setConfirmOpen(false)}>
              Avbryt
            </button>
            <button className={buttonClasses("primary")} disabled={isSending} onClick={confirmSend}>
              <Send className="size-4" />
              {isSending ? "Skickar …" : sendError ? "Försök igen" : "Skicka offert"}
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
    </>
  );
}
