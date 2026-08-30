"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClasses } from "./ui";
import { createExpenseFromInboxAction, markInboxMailProcessedAction } from "@/app/actions";

export function InboxMailActions({
  itemId,
  canCreateExpense,
}: {
  itemId: string;
  canCreateExpense: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {canCreateExpense ? (
          <button
            type="button"
            className={buttonClasses("primary", "sm")}
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await createExpenseFromInboxAction(itemId);
                if (!result.ok) setError(result.error);
                else router.refresh();
              });
            }}
          >
            Skapa utgift
          </button>
        ) : null}
        <button
          type="button"
          className={buttonClasses("secondary", "sm")}
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              await markInboxMailProcessedAction(itemId);
              router.refresh();
            });
          }}
        >
          Markera som hanterad
        </button>
      </div>
      {error ? <p className="text-[13px] text-danger">{error}</p> : null}
    </div>
  );
}
