"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { linkConfirmationToOrderAction } from "@/app/wholesaler-actions";
import { buttonClasses } from "./ui";

export function LinkConfirmationButtons({
  inboxItemId,
  options,
}: {
  inboxItemId: string;
  options: { orderId: string; label: string; detail: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (options.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2">
      {options.map((o) => (
        <li key={o.orderId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line/80 px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-ink">{o.label}</p>
            <p className="text-[12.5px] text-muted">{o.detail}</p>
          </div>
          <button
            type="button"
            className={buttonClasses("secondary", "md")}
            disabled={pending}
            data-link-order={o.orderId}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const res = await linkConfirmationToOrderAction(inboxItemId, o.orderId);
                if (!res.ok) setError(res.error);
                router.refresh();
              });
            }}
          >
            Det är den här
          </button>
        </li>
      ))}
      {error ? <li className="text-[13px] font-medium text-danger">{error}</li> : null}
    </ul>
  );
}
