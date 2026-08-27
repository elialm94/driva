"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Modal } from "./modal";
import { PreviewModal } from "./preview-modal";
import { buttonClasses } from "./ui";
import { kr } from "@/lib/format";
import { QUOTE_EXCESS_WARN_AMOUNT, QUOTE_EXCESS_WARN_PERCENT } from "@/lib/quote-excess";

export function InvoiceDraftSend({
  customerFirstName,
  document,
  sendAction,
  publicPath,
  recipientEmail,
  excessAmount,
  tillaggHref,
}: {
  customerFirstName: string;
  document: ReactNode;
  sendAction: () => Promise<void>;
  publicPath: string;
  recipientEmail?: string;
  /** Positivt belopp om fakturan överstiger tröskeln; annars utelämnas varningen. */
  excessAmount?: number;
  tillaggHref?: string;
}) {
  const router = useRouter();
  const [warnOpen, setWarnOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const needsWarning = (excessAmount ?? 0) > 0 && !!tillaggHref;

  function requestPreview() {
    if (needsWarning) setWarnOpen(true);
    else setPreviewOpen(true);
  }

  return (
    <>
      <button className={buttonClasses("primary")} onClick={requestPreview}>
        <Send className="size-4" />
        Förhandsgranska & skicka
      </button>

      <PreviewModal
        hideTrigger
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        triggerLabel="Förhandsgranska & skicka"
        title={`Så här ser ${customerFirstName} fakturan`}
        document={document}
        mode="send"
        sendAction={sendAction}
        sendLabel="Skicka faktura"
        sentTitle="Fakturan är skickad"
        sentText="Fakturan är bokförd och kunden har fått den med e-post."
        publicPath={publicPath}
        recipientEmail={recipientEmail}
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
            <button
              className={buttonClasses("primary")}
              onClick={() => {
                setWarnOpen(false);
                setPreviewOpen(true);
              }}
            >
              Fortsätt till förhandsgranskning
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
