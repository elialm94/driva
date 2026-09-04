"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Modal } from "./modal";
import { buttonClasses } from "./ui";
import { declineQuoteByTokenAction } from "@/app/actions";

/**
 * Avböj på /offert/[token]. Godkännandet bor i quote-accept.tsx.
 * Ingen frågekanal – kunden hör av sig till företaget via sidfoten.
 */

export function DeclineQuoteButton({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const router = useRouter();
  return (
    <>
      <button
        type="button"
        data-testid="public-quote-decline"
        className="text-[14px] font-medium text-muted underline-offset-2 hover:text-danger hover:underline"
        onClick={() => setOpen(true)}
      >
        Avböj offerten
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Avböj offerten" size="sm">
        <form
          className="space-y-4 px-6 py-5"
          action={async () => {
            await declineQuoteByTokenAction(token, reason.trim() || undefined);
            setOpen(false);
            router.refresh();
          }}
        >
          <p className="text-[14px] leading-relaxed text-soft">
            Tråkigt att det inte passade den här gången. Vill du berätta varför? (frivilligt)
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="T.ex. priset, tidplanen …"
            className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] placeholder:text-muted focus:border-accent"
          />
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClasses("ghost")} onClick={() => setOpen(false)}>
              <X className="size-4" /> Avbryt
            </button>
            <button type="submit" className={buttonClasses("danger")}>
              Avböj offerten
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
