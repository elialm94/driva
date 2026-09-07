"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Link2, Search } from "lucide-react";
import { buttonClasses, cx } from "./ui";
import { ExpenseQuestionButtons, UploadReceiptButton } from "./money-widgets";
import { useToast } from "./toast";
import { confirmPaymentMatchAction, confirmRotPayoutAction, registerCreditRefundAction } from "@/app/bokforing-actions";
import { kr, datumKort } from "@/lib/format";
import type { BankRowAction, OpenReceivableOption } from "@/lib/services/economy-list";

/**
 * Åtgärderna för en obokad banktransaktion, direkt i bankvyn. Samma domän-
 * vägar som Hem-raderna: bekräfta motorns förslag, matcha mot en faktura för
 * hand, lägga till kvittot på kortköpet eller svara på kategorifrågan.
 * Registret lämnar aldrig en rad utan ett sätt att slutföra den.
 */
export function BankRowActions({
  txId,
  amount,
  action,
  receivables,
  defaultOpen = false,
}: {
  txId: string;
  amount: number;
  action: BankRowAction;
  receivables: OpenReceivableOption[];
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(defaultOpen && (action.kind === "pick_invoice" || action.kind === "confirm_match"));

  function run(label: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if (result.ok) {
          setDone(label);
          // Raden lämnar listan över obokade när sidan laddats om – toasten står kvar.
          toast({ title: label, text: "Transaktionen är avstämd och borta från att-göra-listan.", tone: "ok" });
          router.refresh();
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Något gick fel. Försök igen.");
      }
    });
  }

  if (done) {
    return (
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-ok" data-bank-row-done>
        <Check className="size-4" /> {done}
      </p>
    );
  }

  const primary = (() => {
    switch (action.kind) {
      case "confirm_match":
        return (
          <button
            type="button"
            className={buttonClasses("primary", "sm")}
            disabled={pending}
            onClick={() => run("Betalningen är bokförd", () => confirmPaymentMatchAction(txId, action.invoiceId))}
            data-bank-confirm-match
          >
            {pending ? "Bokför …" : action.label}
          </button>
        );
      case "confirm_rot_payout":
        return (
          <button
            type="button"
            className={buttonClasses("primary", "sm")}
            disabled={pending}
            onClick={() => run("Utbetalningen är bokförd", () => confirmRotPayoutAction(txId))}
          >
            {pending ? "Bokför …" : action.label}
          </button>
        );
      case "confirm_refund":
        return (
          <button
            type="button"
            className={buttonClasses("primary", "sm")}
            disabled={pending}
            onClick={() => run("Återbetalningen är bokförd", () => registerCreditRefundAction(action.invoiceId, txId))}
          >
            {pending ? "Bokför …" : action.label}
          </button>
        );
      case "receipt":
        return <UploadReceiptButton expenseId={action.expenseId} label="Lägg till kvitto" />;
      case "question":
        return <ExpenseQuestionButtons expenseId={action.expenseId} options={action.options} />;
      default:
        return null;
    }
  })();

  const canPick = amount > 0 && (action.kind === "pick_invoice" || action.kind === "confirm_match");

  return (
    <div className="space-y-2" data-bank-row-actions data-bank-row-kind={action.kind}>
      <p className="text-[13px] text-soft">{action.kind === "question" ? action.text : action.reason}</p>
      <div className="flex flex-wrap items-center gap-2">
        {primary}
        {canPick ? (
          <button
            type="button"
            className={buttonClasses(action.kind === "pick_invoice" ? "primary" : "ghost", "sm")}
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
            data-bank-pick-invoice
          >
            <Link2 className="size-3.5" />
            {action.kind === "pick_invoice" ? "Matcha mot faktura" : "Annan faktura …"}
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="text-[13px] font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {pickerOpen && canPick ? (
        <InvoicePicker
          amount={amount}
          receivables={receivables}
          pending={pending}
          onPick={(invoiceId) => run("Betalningen är bokförd", () => confirmPaymentMatchAction(txId, invoiceId))}
        />
      ) : null}
    </div>
  );
}

function InvoicePicker({
  amount,
  receivables,
  pending,
  onPick,
}: {
  amount: number;
  receivables: OpenReceivableOption[];
  pending: boolean;
  onPick: (invoiceId: string) => void;
}) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? receivables.filter((r) => `${r.invoiceNumber ?? ""} ${r.customerName}`.toLowerCase().includes(needle))
      : receivables;
    // Samma belopp överst – det är nästan alltid rätt faktura.
    return [...list].sort((a, b) => {
      const da = Math.abs(a.outstanding - amount);
      const dbb = Math.abs(b.outstanding - amount);
      if ((da <= 1) !== (dbb <= 1)) return da <= 1 ? -1 : 1;
      return a.dueDate.localeCompare(b.dueDate);
    });
  }, [q, receivables, amount]);

  if (receivables.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-3 py-2.5 text-[13px] text-muted">
        Det finns inga obetalda fakturor att matcha mot. Är det ingen kundbetalning kan den hanteras under Bokföring.
      </p>
    );
  }

  return (
    <div className="rounded-2xl border border-line/80 bg-card" data-bank-invoice-picker>
      {receivables.length > 5 ? (
        <div className="relative border-b border-line/70 p-2">
          <Search className="pointer-events-none absolute left-4.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            className="h-10 w-full rounded-xl border border-line bg-canvas pl-9 pr-3 text-[14px] focus:border-accent"
            placeholder="Sök fakturanummer eller kund"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Sök faktura att matcha mot"
          />
        </div>
      ) : null}
      <ul className="max-h-72 divide-y divide-line/70 overflow-y-auto" aria-label="Obetalda fakturor">
        {rows.length === 0 ? (
          <li className="px-3 py-3 text-[13px] text-muted">Ingen faktura matchade sökningen.</li>
        ) : (
          rows.map((r) => {
            const exact = Math.abs(r.outstanding - amount) <= 1;
            return (
              <li key={r.invoiceId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium text-ink">
                    {r.invoiceNumber != null ? `#${r.invoiceNumber}` : "Faktura"} · {r.customerName}
                  </p>
                  <p className="text-[12.5px] text-muted">
                    {kr(r.outstanding)} kvar · förfaller {datumKort(r.dueDate)}
                    {exact ? " · samma belopp" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className={cx(buttonClasses(exact ? "primary" : "secondary", "sm"), "shrink-0")}
                  disabled={pending}
                  onClick={() => onPick(r.invoiceId)}
                  aria-label={`Matcha mot faktura ${r.invoiceNumber ?? ""} ${r.customerName}`.trim()}
                >
                  Välj
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
