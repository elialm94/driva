"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, MessageCircleQuestion, X } from "lucide-react";
import { Modal } from "./modal";
import { buttonClasses, cx } from "./ui";
import { askQuoteQuestionByTokenAction, declineQuoteByTokenAction } from "@/app/actions";

/**
 * Sekundära kundåtgärder på /offert/[token]: ställ en fråga och avböj.
 * Godkännandet bor i quote-accept.tsx.
 */

export function QuoteQuestionButton({ token, companyName }: { token: string; companyName: string }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [text, setText] = useState("");
  return (
    <>
      <button className={cx(buttonClasses("secondary", "lg"), "w-full sm:w-auto")} onClick={() => setOpen(true)}>
        <MessageCircleQuestion className="size-4.5" />
        Ställ en fråga
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Ställ en fråga" size="sm">
        {sent ? (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <CheckCircle2 className="size-9 text-ok" />
            <p className="mt-3 text-[16px] font-semibold">Frågan är skickad</p>
            <p className="mt-1 text-[14px] text-soft">{companyName} återkommer till dig så snart som möjligt.</p>
            <button className={cx(buttonClasses("primary", "sm"), "mt-5")} onClick={() => setOpen(false)}>
              Stäng
            </button>
          </div>
        ) : (
          <form
            className="space-y-4 px-6 py-5"
            action={async () => {
              if (!text.trim()) return;
              await askQuoteQuestionByTokenAction(token, text.trim());
              setSent(true);
            }}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder="Skriv din fråga om offerten …"
              className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] placeholder:text-muted focus:border-accent"
            />
            <div className="flex justify-end gap-2">
              <button type="button" className={buttonClasses("ghost")} onClick={() => setOpen(false)}>
                Avbryt
              </button>
              <button type="submit" className={buttonClasses("primary")} disabled={!text.trim()}>
                Skicka fråga
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

export function DeclineQuoteButton({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const router = useRouter();
  return (
    <>
      <button
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
