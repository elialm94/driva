"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Modal } from "./modal";
import { buttonClasses } from "./ui";
import { kr } from "@/lib/format";

function withFlag(href: string, key: string, value: string) {
  const url = new URL(href, "https://driva.local");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

export function QuoteDraftSend({
  customerName,
  amount,
  validUntilLabel,
  sendAction,
  detailHref,
  recipientEmail,
  addEmailHref,
  hasSendBlockers = false,
  mailConfigured = true,
}: {
  customerName: string;
  amount: number;
  validUntilLabel: string;
  sendAction: () => Promise<void | { ok: boolean; errors?: string[]; mailed?: boolean }>;
  detailHref: string;
  recipientEmail?: string;
  addEmailHref: string;
  hasSendBlockers?: boolean;
  /** Om e-postutskick är konfigurerat på servern – styr ärlig text i dialogen. */
  mailConfigured?: boolean;
}) {
  const router = useRouter();
  const [emailOpen, setEmailOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, startSending] = useTransition();
  const email = recipientEmail?.trim() ?? "";

  function requestSend() {
    setSendError(null);
    if (hasSendBlockers) {
      // Checklistan "Innan offerten kan skickas" förklarar vad som behövs.
      document.getElementById("quote-send-blockers")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!email) {
      setEmailOpen(true);
      return;
    }
    setConfirmOpen(true);
  }

  function finish(mailed: boolean) {
    // "1" = e-post skickades, "manuell" = markerad som skickad utan e-post.
    router.replace(withFlag(detailHref, "skickad", mailed ? "1" : "manuell"));
    router.refresh();
  }

  function confirmSend() {
    startSending(async () => {
      setSendError(null);
      const result = await sendAction();
      if (result && result.ok === false) {
        setSendError((result.errors ?? []).join(" "));
        return;
      }
      finish(Boolean(result && result.mailed));
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
          {mailConfigured ? (
            <p className="mt-4 text-[14px] leading-relaxed text-soft">
              Offerten skickas till: <span className="font-semibold text-ink">{email}</span>
            </p>
          ) : (
            <p className="mt-4 text-[14px] leading-relaxed text-soft">
              E-postutskick är inte konfigurerat ännu. Offerten markeras som skickad – dela sedan kundlänken med{" "}
              <span className="font-semibold text-ink">{customerName}</span> själv.
            </p>
          )}
          {sendError ? <p className="mt-3 text-[13px] font-medium text-danger">{sendError}</p> : null}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button className={buttonClasses("secondary")} disabled={isSending} onClick={() => setConfirmOpen(false)}>
              Avbryt
            </button>
            <button className={buttonClasses("primary")} disabled={isSending} onClick={confirmSend}>
              <Send className="size-4" />
              {isSending ? "Skickar …" : "Skicka offert"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={emailOpen} onClose={() => setEmailOpen(false)} size="sm" title="Kunden saknar e-postadress">
        <div className="px-6 py-5">
          <p className="text-[15px] leading-relaxed text-soft">
            Kunden saknar e-postadress. Utkastet sparas – lägg till e-post och skicka sedan.
          </p>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button className={buttonClasses("secondary")} onClick={() => setEmailOpen(false)}>
              Avbryt
            </button>
            <a href={addEmailHref} className={buttonClasses("primary")}>
              Lägg till e-post
            </a>
          </div>
        </div>
      </Modal>
    </>
  );
}
