"use client";

import { useState, useTransition } from "react";
import { Lock } from "lucide-react";
import { buttonClasses } from "./ui";
import { closePeriodAction } from "@/app/periodstangning-actions";

/**
 * Stängningsknappen. Stängningen låser bokföringen och kan bara backas genom
 * att räkenskapsåret öppnas igen, så knappen bekräftar innan den kör.
 */
export function ClosePeriodButton({
  periodKey,
  label,
  disabled,
  businessId,
}: {
  periodKey: string;
  label: string;
  disabled?: boolean;
  businessId?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-soft">
            Låset går bara framåt. Efteråt kan inget ändras i månaden – en rättelse bokförs i öppen period.
          </span>
          <button
            className={buttonClasses("primary", "sm")}
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const res = await closePeriodAction(periodKey, businessId);
                setError(res.ok ? null : res.error);
                if (res.ok) setConfirming(false);
              })
            }
          >
            <Lock className="size-3.5" />
            {isPending ? "Stänger …" : "Ja, stäng perioden"}
          </button>
          <button
            className={buttonClasses("ghost", "sm")}
            disabled={isPending}
            onClick={() => {
              setConfirming(false);
              setError(null);
            }}
          >
            Avbryt
          </button>
        </div>
        {error ? <p className="mt-2 text-[13px] font-medium text-danger">{error}</p> : null}
      </div>
    );
  }

  return (
    <div>
      <button
        className={buttonClasses("primary", "sm")}
        disabled={disabled || isPending}
        onClick={() => setConfirming(true)}
      >
        <Lock className="size-3.5" />
        {label}
      </button>
      {error ? <p className="mt-2 text-[13px] font-medium text-danger">{error}</p> : null}
    </div>
  );
}
