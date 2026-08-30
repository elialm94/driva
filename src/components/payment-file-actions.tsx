"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download } from "lucide-react";
import { buttonClasses } from "./ui";
import { createPaymentFileAction, regeneratePaymentFileAction } from "@/app/actions";

export interface PaymentFileConfirmRow {
  label: string;
  value: string;
}

/**
 * [Skapa bankfil]: bekräftelse med exakt vad som betalas och från vilket
 * konto → skapa pain.001 → "✓ Bankfil skapad" med nedladdning och nästa steg.
 * Skapad fil ≠ skickad till bank ≠ betald – texten säger det rakt ut.
 */
export function CreatePaymentFileButton({
  supplierInvoiceIds,
  title,
  confirmRows,
  helpText = "Ladda upp filen i din internetbank och godkänn betalningen där.",
  label = "Skapa bankfil",
  size = "sm",
  disabled,
}: {
  supplierInvoiceIds: string[];
  /** T.ex. "Betala Beijer Bygg" eller "Betala 2 fakturor". */
  title: string;
  confirmRows: PaymentFileConfirmRow[];
  helpText?: string;
  label?: string;
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [problems, setProblems] = useState<string[]>([]);
  const [created, setCreated] = useState<{ fileId: string; filename: string } | null>(null);

  if (created) {
    return (
      <div className="w-full max-w-sm rounded-2xl border border-ok/30 bg-ok-soft/40 p-4 text-left">
        <p className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <CheckCircle2 className="size-4 text-ok" /> Bankfil skapad
        </p>
        <p className="mt-1 text-[13px] text-soft">{created.filename}</p>
        <p className="mt-2 text-[13px] text-soft">{helpText}</p>
        <a
          href={`/api/betalfil/${created.fileId}`}
          download
          className={buttonClasses("primary", "sm", "mt-3")}
        >
          <Download className="size-4" /> Ladda ned bankfilen
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        className={buttonClasses("primary", size) + " max-lg:min-h-11"}
        disabled={pending || disabled}
        onClick={() => {
          setProblems([]);
          setOpen(true);
        }}
      >
        {label}
      </button>
      {open ? (
        <div className="w-full max-w-sm rounded-2xl border border-line bg-card p-4 text-left shadow-card">
          <p className="text-[15px] font-semibold">{title}</p>
          <ul className="mt-3 space-y-1.5 text-[14px]">
            {confirmRows.map((row) => (
              <li key={row.label} className="flex justify-between gap-3">
                <span className="text-muted">{row.label}</span>
                <span className="text-right font-medium text-ink">{row.value}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] text-muted">
            Filen laddas upp i din internetbank – inget betalas förrän du godkänner det där.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className={buttonClasses("secondary", "sm")}
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Avbryt
            </button>
            <button
              type="button"
              className={buttonClasses("primary", "sm")}
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  const result = await createPaymentFileAction({ supplierInvoiceIds });
                  if (!result.ok) {
                    setProblems(result.problems);
                    return;
                  }
                  setOpen(false);
                  setCreated({ fileId: result.fileId, filename: result.filename });
                  router.refresh();
                });
              }}
            >
              {pending ? "Skapar …" : "Skapa bankfil"}
            </button>
          </div>
          {problems.length > 0 ? (
            <ul className="mt-2 space-y-1 text-[13px] text-danger">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Ersätt en aktiv bankfil (gamla blir REPLACED – aldrig två aktiva filer). */
export function RegeneratePaymentFileButton({ fileId }: { fileId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [problems, setProblems] = useState<string[]>([]);

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        className={buttonClasses("secondary", "sm")}
        disabled={pending}
        onClick={() => {
          setProblems([]);
          startTransition(async () => {
            const result = await regeneratePaymentFileAction(fileId);
            if (!result.ok) setProblems(result.problems);
            else router.refresh();
          });
        }}
      >
        {pending ? "Skapar ny fil …" : "Skapa ny fil (ersätter denna)"}
      </button>
      {problems.map((p) => (
        <p key={p} className="text-[13px] text-danger">
          {p}
        </p>
      ))}
    </div>
  );
}
