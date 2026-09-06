"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClasses, cx } from "./ui";
import {
  approveConfirmationAction,
  cancelPurchaseOrderAction,
  dismissConfirmationAction,
  setPurchaseOrderLineCustomerPriceAction,
  setWholesalerOrderNumberAction,
} from "@/app/wholesaler-actions";

const inputCls =
  "rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }
  return { pending, error, run };
}

export function ConfirmationActions({
  confirmationId,
  canApprove,
  canDismiss,
}: {
  confirmationId: string;
  canApprove: boolean;
  canDismiss: boolean;
}) {
  const { pending, error, run } = useAction();
  if (!canApprove && !canDismiss) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canApprove ? (
        <button
          type="button"
          className={buttonClasses("primary", "sm")}
          disabled={pending}
          onClick={() => run(() => approveConfirmationAction(confirmationId))}
          data-approve-confirmation
        >
          Godkänn ändringarna
        </button>
      ) : null}
      {canDismiss ? (
        <button
          type="button"
          className={buttonClasses("ghost", "sm")}
          disabled={pending}
          onClick={() => run(() => dismissConfirmationAction(confirmationId))}
        >
          Hör inte hit
        </button>
      ) : null}
      {error ? <p className="text-[13px] font-medium text-danger">{error}</p> : null}
    </div>
  );
}

export function CustomerPriceField({
  lineId,
  unit,
  currentKr,
  invoiced,
}: {
  lineId: string;
  unit: string;
  currentKr: number | null;
  invoiced: boolean;
}) {
  const { pending, error, run } = useAction();
  const [value, setValue] = useState(currentKr != null ? String(currentKr) : "");
  const [open, setOpen] = useState(currentKr == null);
  if (invoiced) return <span className="text-[13px] text-muted">{currentKr != null ? `${currentKr} kr/${unit}` : "–"} · fakturerad</span>;
  if (!open) {
    return (
      <button type="button" className="text-[13px] text-accent underline-offset-2 hover:underline" onClick={() => setOpen(true)}>
        {currentKr != null ? `${currentKr} kr/${unit} · ändra` : "Ange kundpris"}
      </button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const kr = Number(value.replace(/\s/g, "").replace(",", "."));
        if (!Number.isFinite(kr) || kr < 0) return;
        run(() => setPurchaseOrderLineCustomerPriceAction(lineId, Math.round(kr)));
        setOpen(false);
      }}
    >
      <input
        className={cx(inputCls, "h-11 w-24")}
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={`Kundpris kr per ${unit}`}
        placeholder="kr"
        autoFocus
      />
      <span className="text-[13px] text-muted">kr/{unit}</span>
      <button type="submit" className={buttonClasses("secondary", "sm")} disabled={pending || value.trim() === ""} data-set-customer-price>
        Spara
      </button>
      {currentKr != null ? (
        <button type="button" className={buttonClasses("ghost", "sm")} onClick={() => setOpen(false)}>
          Avbryt
        </button>
      ) : null}
      {error ? <p className="text-[13px] font-medium text-danger">{error}</p> : null}
    </form>
  );
}

export function WholesalerOrderNumberField({ orderId, current }: { orderId: string; current: string | null }) {
  const { pending, error, run } = useAction();
  const [value, setValue] = useState(current ?? "");
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="text-[13px] text-accent underline-offset-2 hover:underline" onClick={() => setOpen(true)}>
        {current ? `Grossistens ordernummer ${current} · ändra` : "Lägg till grossistens ordernummer"}
      </button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setWholesalerOrderNumberAction(orderId, value));
        setOpen(false);
      }}
    >
      <input className={cx(inputCls, "h-11 w-44")} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Grossistens ordernummer" autoFocus />
      <button type="submit" className={buttonClasses("secondary", "sm")} disabled={pending}>
        Spara
      </button>
      <button type="button" className={buttonClasses("ghost", "sm")} onClick={() => setOpen(false)}>
        Avbryt
      </button>
      {error ? <p className="text-[13px] font-medium text-danger">{error}</p> : null}
    </form>
  );
}

export function CancelOrderButton({ orderId, wholesalerName }: { orderId: string; wholesalerName: string }) {
  const { pending, error, run } = useAction();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="space-y-2">
      {!confirm ? (
        <button type="button" className={buttonClasses("ghost", "sm")} onClick={() => setConfirm(true)}>
          Avbryt beställningen
        </button>
      ) : (
        <div className="rounded-xl border border-line/80 p-3 text-[14px] text-soft">
          <p>
            Beställningen markeras som avbruten i Ferva. Kontakta {wholesalerName} separat om mejlet redan skickats –
            Ferva skickar ingen avbokning.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" className={buttonClasses("danger", "sm")} disabled={pending} onClick={() => run(() => cancelPurchaseOrderAction(orderId))}>
              Ja, avbryt
            </button>
            <button type="button" className={buttonClasses("ghost", "sm")} onClick={() => setConfirm(false)}>
              Nej
            </button>
          </div>
        </div>
      )}
      {error ? <p className="text-[13px] font-medium text-danger">{error}</p> : null}
    </div>
  );
}
