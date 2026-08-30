"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClasses } from "./ui";
import { submitSupplierPaymentAction } from "@/app/actions";

export function SendToBankButton({
  supplierInvoiceId,
  paymentId,
  confirmRows,
  scheduledDate: defaultDate,
  label = "Skicka till bank",
}: {
  supplierInvoiceId: string;
  paymentId?: string;
  confirmRows: { label: string; value: string }[];
  scheduledDate: string;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [scheduledDate, setScheduledDate] = useState(defaultDate.slice(0, 10));

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        className={buttonClasses("primary", "sm") + " max-lg:min-h-11"}
        disabled={pending}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {pending ? "Skickar …" : label}
      </button>
      {open ? (
        <div className="w-full max-w-sm rounded-2xl border border-line bg-card p-4 text-left shadow-card">
          <p className="text-[15px] font-semibold">Skicka till bank?</p>
          <ul className="mt-3 space-y-1.5 text-[14px]">
            {confirmRows.map((row) => (
              <li key={row.label} className="flex justify-between gap-3">
                <span className="text-muted">{row.label}</span>
                <span className="font-medium text-ink">{row.value}</span>
              </li>
            ))}
          </ul>
          <label className="mt-3 block text-[13px] text-muted">
            Betaldatum
            <input
              type="date"
              className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-[14px] text-ink"
              defaultValue={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
            />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={buttonClasses("secondary", "sm")} onClick={() => setOpen(false)}>
              Avbryt
            </button>
            <button
              type="button"
              className={buttonClasses("primary", "sm") + " max-lg:min-h-11"}
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  const result = await submitSupplierPaymentAction({
                    supplierInvoiceId,
                    paymentId,
                    scheduledDate,
                  });
                  if (!result.ok) setError(result.error);
                  else {
                    setOpen(false);
                    router.refresh();
                  }
                });
              }}
            >
              {pending ? "Skickar …" : "Skicka till bank"}
            </button>
          </div>
          {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
