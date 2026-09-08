"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Modal } from "./modal";
import { buttonClasses } from "./ui";
import { kr } from "@/lib/format";
import { CustomerEmailPrompt } from "./customer-email-prompt";
import { ShareCustomerLink } from "./share-customer-link";
import { RotCustomerShareCallout } from "./rot-customer-share";
import { useBlockedAction } from "./blocked-action";
import { DisabledSendWrap } from "./disabled-send-button";
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
  canSend = true,
  mailConfigured = true,
  publicPath,
  customerPhone,
  quoteNumber,
  deduction,
  rotType,
}: {
  documentId: string;
  customerId: string;
  customerName: string;
  amount: number;
  validUntilLabel: string;
  sendAction: (message?: string) => Promise<void | { ok: boolean; errors?: string[]; mailed?: boolean; demo?: boolean }>;
  detailHref: string;
  recipientEmail?: string;
  /** Samma källa som checklistan: canSend = quoteSendBlockers().length === 0. */
  canSend?: boolean;
  /** Om e-postutskick är konfigurerat på servern – styr ärlig text i dialogen. */
  mailConfigured?: boolean;
  publicPath?: string;
  customerPhone?: string;
  quoteNumber?: number;
  deduction?: number;
  rotType?: "rot" | "rut";
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState("");
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
    if (!canSend || isSending) return;
    requestAction();
  }

  function finish(flag: "1" | "manuell" | "demo" = "1") {
    router.replace(withFlag(detailHref, "skickad", flag));
    router.refresh();
  }

  function confirmSend() {
    if (isSending) return;
    startSending(async () => {
      setSendError(null);
      const result = await sendAction(message.trim() || undefined);
      if (result && result.ok === false) {
        setSendError((result.errors ?? []).join(" ") || "Offerten kunde inte skickas just nu.");
        return;
      }
      if (result && result.demo) {
        finish("demo");
        return;
      }
      const mailed = !result || result.mailed !== false;
      finish(mailed ? "1" : "manuell");
    });
  }

  return (
    <>
      {canSend ? (
        <button type="button" className={buttonClasses("primary")} onClick={requestSend} disabled={isSending}>
          <Send className="size-4" />
          Skicka offert
        </button>
      ) : (
        <DisabledSendWrap title="Komplettera uppgifterna ovan innan offerten kan skickas.">
          <button type="button" className={buttonClasses("primary")} disabled aria-disabled>
            <Send className="size-4" />
            Skicka offert
          </button>
        </DisabledSendWrap>
      )}

      <Modal open={confirmOpen} onClose={() => !isSending && setConfirmOpen(false)} size="sm" title="Skicka offert?">
        <div className="px-6 py-5">
          <p className="text-[17px] font-semibold tracking-tight text-ink">{customerName}</p>
          <p className="mt-1 text-[15px] text-soft">{kr(amount)}</p>
          <p className="mt-1 text-[14px] text-muted">Giltig till {validUntilLabel}</p>
          {rotType && deduction ? (
            <RotCustomerShareCallout type={rotType} toPay={amount} deduction={deduction} />
          ) : null}
          <label className="mt-4 block text-[13px] font-medium text-ink">
            Personligt meddelande
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="Valfritt – syns överst i mejlet."
              className="mt-1.5 w-full rounded-xl border border-line bg-card px-3 py-2 text-[14px] font-normal text-ink placeholder:text-muted focus:border-accent"
            />
          </label>
          <p className="mt-4 text-[14px] leading-relaxed text-soft">
            {mailConfigured ? (
              <>
                Offerten skickas till: <span className="font-semibold text-ink">{email}</span>
              </>
            ) : (
              <>
                E-post är inte konfigurerad i den här miljön. Offerten markeras som skickad – dela
                kundlänken med <span className="font-semibold text-ink">{email || customerName}</span>.
              </>
            )}
          </p>
          {publicPath ? (
            <div className="mt-4">
              <p className="mb-2 text-[12px] font-medium text-muted">Förhandsgranska och dela</p>
              <ShareCustomerLink path={publicPath} kind="offert" number={quoteNumber} phone={customerPhone} />
            </div>
          ) : null}
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
