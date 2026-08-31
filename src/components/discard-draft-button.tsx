"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { discardInvoiceAction, discardQuoteAction } from "@/app/actions";
import { Modal } from "./modal";
import { buttonClasses, cx } from "./ui";

type DraftKind = "quote" | "invoice";

const COPY: Record<
  DraftKind,
  { title: string; body: string; confirm: string; iconLabel: string }
> = {
  quote: {
    title: "Kasta offertutkast?",
    body: "Utkastet tas bort.",
    confirm: "Kasta utkast",
    iconLabel: "Kasta offertutkast",
  },
  invoice: {
    title: "Kasta fakturautkast?",
    body: "Utkastet tas bort.",
    confirm: "Kasta utkast",
    iconLabel: "Kasta fakturautkast",
  },
};

export function DiscardDraftButton({
  kind,
  documentId,
  appearance = "button",
}: {
  kind: DraftKind;
  documentId: string;
  appearance?: "button" | "icon";
}) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const copy = COPY[kind];

  function confirm() {
    if (isPending) return;
    startTransition(async () => {
      if (kind === "quote") await discardQuoteAction(documentId);
      else await discardInvoiceAction(documentId);
    });
  }

  return (
    <>
      {appearance === "icon" ? (
        <button
          type="button"
          className={cx(
            "relative z-20 inline-flex size-8 items-center justify-center rounded-lg text-danger",
            "hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          )}
          aria-label={copy.iconLabel}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setConfirming(true);
          }}
        >
          <Trash2 className="size-4" />
        </button>
      ) : (
        <button
          type="button"
          data-testid="discard-draft-trigger"
          className={buttonClasses("danger-outline")}
          onClick={() => setConfirming(true)}
        >
          Kasta utkast
        </button>
      )}

      <Modal open={confirming} onClose={() => !isPending && setConfirming(false)} size="sm" title={copy.title}>
        <div className="px-6 py-5">
          <p className="text-[15px] leading-relaxed text-soft">{copy.body}</p>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button className={buttonClasses("secondary")} disabled={isPending} onClick={() => setConfirming(false)}>
              Avbryt
            </button>
            <button className={buttonClasses("danger")} disabled={isPending} onClick={confirm}>
              {isPending ? "Kastar …" : copy.confirm}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
