"use client";

import { useState, useTransition } from "react";
import { useAppNavigate } from "./app-link";
import { AlertTriangle } from "lucide-react";
import { Card, buttonClasses, cx } from "./ui";
import { kr } from "@/lib/format";
import { deniedReductionDraftLabel, getDeniedReductionNotice } from "@/lib/tax-reduction-terms";
import { createDeniedReductionInvoiceAction } from "@/app/actions";
import { FieldError, focusField, invalidFieldCls } from "./form-validation";

export function DeniedReductionCard({
  invoiceId,
  deduction,
}: {
  invoiceId: string;
  deduction: number;
}) {
  const navigate = useAppNavigate();
  const [amount, setAmount] = useState(String(deduction));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const parsed = Math.round(Number(amount.replace(/\s/g, "").replace(",", ".")));
  const valid = Number.isFinite(parsed) && parsed >= 1 && parsed <= deduction;
  const amountMessage = !amount.trim()
    ? "Ange det nekade beloppet i kronor."
    : !Number.isFinite(parsed)
      ? "Ange beloppet i hela kronor."
      : parsed < 1
        ? "Beloppet måste vara minst 1 kr."
        : parsed > deduction
          ? `Högst det preliminära avdraget på ${kr(deduction)}.`
          : null;

  function submit() {
    if (!valid) {
      focusField("nekat-belopp");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createDeniedReductionInvoiceAction(invoiceId, parsed);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      navigate(`/ekonomi/fakturor/${result.invoiceId}`);
    });
  }

  return (
    <Card className="mb-6 border-warn/25 bg-warn-soft/30 px-5 py-4">
      <p className="text-[15px] font-semibold text-ink">Nekat ROT/RUT-avdrag</p>
      <p className="mt-2 text-[14px] leading-relaxed text-soft">
        {valid ? getDeniedReductionNotice(parsed) : getDeniedReductionNotice(deduction)}
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-muted">Nekat belopp (kr)</span>
          <input
            id="nekat-belopp"
            type="number"
            min={1}
            max={deduction}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={amountMessage ? true : undefined}
            aria-describedby={amountMessage ? "nekat-belopp-fel" : undefined}
            className={cx(
              "w-36 rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] tabular",
              amountMessage && invalidFieldCls,
            )}
          />
        </label>
        <button className={buttonClasses("primary")} disabled={!valid || isPending} onClick={submit}>
          {isPending ? "Skapar …" : deniedReductionDraftLabel(valid ? parsed : deduction)}
        </button>
      </div>
      <FieldError id="nekat-belopp-fel" className="mt-2">
        {amountMessage}
      </FieldError>
      {amountMessage ? null : (
        <p className="mt-2 text-[12px] text-muted">Högst det preliminära avdraget på {kr(deduction)}.</p>
      )}
      {error ? (
        <p className="mt-2 flex items-center gap-1.5 text-[13px] text-danger">
          <AlertTriangle className="size-3.5" /> {error}
        </p>
      ) : null}
    </Card>
  );
}
