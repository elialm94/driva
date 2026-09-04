"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { withdrawQuoteAction } from "@/app/actions";
import { actionMenuItemClassName, useActionMenu } from "./action-menu";
import { Modal } from "./modal";
import { buttonClasses, cx } from "./ui";

/** Tyst overflow-val: öppnar bekräftelsen utanför menyn (menyn är `hidden` när den stängs). */
export function WithdrawQuoteMenuItem({ onOpen }: { onOpen: () => void }) {
  const menu = useActionMenu();

  return (
    <button
      type="button"
      role="menuitem"
      data-quote-withdraw=""
      className={actionMenuItemClassName({ danger: true })}
      onClick={() => {
        menu?.close();
        onOpen();
      }}
    >
      <Undo2 className="size-3.5 shrink-0" /> Dra tillbaka offerten
    </button>
  );
}

/** Bekräftelse – syskon till overflow, inte barn i den dolda menyn. */
export function WithdrawQuoteDialog({
  quoteId,
  open,
  onClose,
}: {
  quoteId: string;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <Modal
      open={open}
      onClose={() => !isPending && onClose()}
      size="sm"
      title="Dra tillbaka offerten?"
    >
      <div className="px-6 py-5" data-quote-withdraw-dialog="">
        <p className="text-[15px] leading-relaxed text-soft">
          Kunden kan inte längre godkänna offerten. Offerten och versionerna ligger kvar i registret.
        </p>
        {error ? <p className="mt-3 text-[13px] font-medium text-danger">{error}</p> : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className={buttonClasses("secondary")}
            disabled={isPending}
            onClick={onClose}
          >
            Avbryt
          </button>
          <button
            type="button"
            data-quote-withdraw-confirm=""
            className={cx(buttonClasses("danger"))}
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await withdrawQuoteAction(quoteId);
                if (result.ok === false) {
                  setError(result.error);
                  return;
                }
                onClose();
                router.refresh();
              })
            }
          >
            {isPending ? "Drar tillbaka …" : "Dra tillbaka offerten"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
