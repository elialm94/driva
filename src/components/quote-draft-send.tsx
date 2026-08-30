"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Modal } from "./modal";
import { buttonClasses } from "./ui";
import { kr } from "@/lib/format";
import { CustomerEmailPrompt } from "./customer-email-prompt";
import { useBlockedAction } from "./blocked-action";
import type { PendingAction } from "@/lib/missing-requirements";
import { defaultSendChannels, type SelectedChannels } from "@/lib/sms/channels";
import { DeliveryChannelPicker } from "./delivery-channel-picker";

function withFlag(href: string, key: string, value: string) {
  const url = new URL(href, "https://driva.local");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

export type SendDocumentResult = {
  ok: boolean;
  errors?: string[];
  mailed?: boolean;
  texted?: boolean;
  demo?: boolean;
  warning?: string;
};

export function QuoteDraftSend({
  documentId,
  customerId,
  customerName,
  amount,
  validUntilLabel,
  sendAction,
  detailHref,
  recipientEmail,
  recipientPhone,
  hasSendBlockers = false,
  mailConfigured = true,
}: {
  documentId: string;
  customerId: string;
  customerName: string;
  amount: number;
  validUntilLabel: string;
  sendAction: (channels: SelectedChannels) => Promise<void | SendDocumentResult>;
  detailHref: string;
  recipientEmail?: string;
  recipientPhone?: string;
  hasSendBlockers?: boolean;
  /** Om e-postutskick är konfigurerat på servern – styr ärlig text i dialogen. */
  mailConfigured?: boolean;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, startSending] = useTransition();
  const defaults = useMemo(
    () => defaultSendChannels(recipientEmail, recipientPhone),
    [recipientEmail, recipientPhone]
  );
  const [channels, setChannels] = useState<SelectedChannels>(defaults);
  const pendingAction: PendingAction = { kind: "SEND_QUOTE", documentId, customerId };

  const { email, collecting, requestAction, resumeAfterResolve, cancelCollect } = useBlockedAction({
    action: pendingAction,
    customerEmail: recipientEmail,
    customerPhone: recipientPhone,
    onResume: () => {
      setSendError(null);
      setChannels(defaultSendChannels(recipientEmail, recipientPhone));
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

  function finish(flag: "1" | "manuell" | "demo" | "delvis" = "1") {
    router.replace(withFlag(detailHref, "skickad", flag));
    router.refresh();
  }

  function confirmSend() {
    if (isSending || (!channels.email && !channels.sms)) return;
    startSending(async () => {
      setSendError(null);
      const result = await sendAction(channels);
      if (result && result.ok === false) {
        setSendError((result.errors ?? []).join(" ") || "Offerten kunde inte skickas just nu.");
        return;
      }
      if (result?.warning) {
        finish("delvis");
        return;
      }
      if (result && result.demo) {
        finish("demo");
        return;
      }
      const delivered = !result || result.mailed !== false || result.texted === true;
      finish(delivered ? "1" : "manuell");
    });
  }

  const hasPicker = Boolean(email || recipientPhone?.trim());

  return (
    <>
      <button className={buttonClasses("primary")} onClick={requestSend}>
        <Send className="size-4" />
        Skicka offert
      </button>

      <Modal open={confirmOpen} onClose={() => !isSending && setConfirmOpen(false)} size="sm" title="Skicka offert">
        <div className="px-6 py-5">
          <p className="text-[17px] font-semibold tracking-tight text-ink">{customerName}</p>
          <p className="mt-1 text-[15px] text-soft">{kr(amount)}</p>
          <p className="mt-1 text-[14px] text-muted">Giltig till {validUntilLabel}</p>
          <div className="mt-4">
            {hasPicker ? (
              <DeliveryChannelPicker
                email={email}
                phone={recipientPhone}
                selected={channels}
                onChange={setChannels}
                disabled={isSending}
              />
            ) : mailConfigured ? (
              <p className="text-[14px] leading-relaxed text-soft">
                Offerten skickas till: <span className="font-semibold text-ink">{email}</span>
              </p>
            ) : (
              <p className="text-[14px] leading-relaxed text-soft">
                E-post är inte konfigurerad i den här miljön. Offerten markeras som skickad – dela
                kundlänken med <span className="font-semibold text-ink">{email || customerName}</span>.
              </p>
            )}
          </div>
          {sendError ? <p className="mt-3 text-[13px] font-medium text-danger">{sendError}</p> : null}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button className={buttonClasses("secondary")} disabled={isSending} onClick={() => setConfirmOpen(false)}>
              Avbryt
            </button>
            <button
              className={buttonClasses("primary")}
              disabled={isSending || (!channels.email && !channels.sms)}
              onClick={confirmSend}
            >
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
