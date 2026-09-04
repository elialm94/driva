"use client";

import { useState, useTransition } from "react";
import { Undo2 } from "lucide-react";
import { withdrawQuoteAction } from "@/app/actions";
import { actionMenuItemClassName, useActionMenu } from "./action-menu";
import { Modal } from "./modal";
import { buttonClasses, cx } from "./ui";

/** Tyst overflow-val: Dra tillbaka offerten, med bekräftelse. */
export function WithdrawQuoteMenuItem({ quoteId }: { quoteId: string }) {
  const menu = useActionMenu();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        role="menuitem"
        data-quote-withdraw=""
        className={actionMenuItemClassName({ danger: true })}
        onClick={() => {
          menu?.close();
          setError(null);
          setConfirming(true);
        }}
      >
        <Undo2 className="size-3.5 shrink-0" /> Dra tillbaka offerten
      </button>
      <Modal
        open={confirming}
        onClose={() => !isPending && setConfirming(false)}
        size="sm"
        title="Dra tillbaka offerten?"
      >
        <div className="px-6 py-5">
          <p className="text-[15px] leading-relaxed text-soft">
            Kunden kan inte längre godkänna offerten. Offerten och versionerna ligger kvar i registret.
          </p>
          {error ? <p className="mt-3 text-[13px] font-medium text-danger">{error}</p> : null}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              className={buttonClasses("secondary")}
              disabled={isPending}
              onClick={() => setConfirming(false)}
            >
              Avbryt
            </button>
            <button
              type="button"
              className={cx(buttonClasses("danger"))}
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await withdrawQuoteAction(quoteId);
                  if (result.ok === false) {
                    setError(result.error);
                    return;
                  }
                  setConfirming(false);
                })
              }
            >
              {isPending ? "Drar tillbaka …" : "Dra tillbaka offerten"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
