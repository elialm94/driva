"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, buttonClasses, cx } from "./ui";
import { approveInboxExtractionAction } from "@/app/actions";
import type { ExtractionFieldKey, ExtractionReviewField } from "@/lib/services/inbox";

/**
 * Kontrollera-vyn: Drivas tolkning fält för fält med mänskliga tillstånd
 * ("Säker"/"Kontrollera" – aldrig decimaler), redigerbar mot dokumentet.
 * [Godkänn uppgifter] sparar, sätter konfidens 1 och kör om pipelinen.
 */

type ReviewDocumentType = "kvitto" | "leverantorsfaktura";

const RECEIPT_KEYS: ExtractionFieldKey[] = ["supplier", "invoiceDate", "amount", "vatAmount"];
const INVOICE_KEYS: ExtractionFieldKey[] = [
  "supplier",
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "amount",
  "vatAmount",
  "ocr",
  "bankgiro",
];

const DATE_KEYS: ReadonlySet<ExtractionFieldKey> = new Set(["invoiceDate", "dueDate"]);
const AMOUNT_KEYS: ReadonlySet<ExtractionFieldKey> = new Set(["amount", "vatAmount"]);

function fieldStateBadge(field: ExtractionReviewField | undefined) {
  if (!field || field.value == null) {
    return <Badge tone="warn">Saknas – fyll i</Badge>;
  }
  return field.state === "saker" ? (
    <Badge tone="ok">Säker</Badge>
  ) : (
    <Badge tone="warn">Kontrollera</Badge>
  );
}

export function ExtractionReviewForm({
  itemId,
  documentType,
  fields,
  backHref,
}: {
  itemId: string;
  documentType: ReviewDocumentType | "ekonomiskt_dokument";
  fields: ExtractionReviewField[];
  backHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [docType, setDocType] = useState<ReviewDocumentType>(
    documentType === "kvitto" ? "kvitto" : "leverantorsfaktura"
  );

  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of fields) initial[f.key] = f.value == null ? "" : String(f.value);
    return initial;
  });

  const visibleKeys = docType === "kvitto" ? RECEIPT_KEYS : INVOICE_KEYS;

  function set(key: ExtractionFieldKey, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function parseAmount(raw: string): number | undefined {
    const compact = raw.replace(/[\s\u00a0]/g, "").replace(",", ".");
    if (!compact) return undefined;
    const n = Number(compact);
    return Number.isFinite(n) ? Math.round(n) : undefined;
  }

  function submit() {
    setError(null);
    // Formuläret är auktoritativt: tomma beloppsfält får ALDRIG falla
    // tillbaka på den osäkra tolkningen – då hade kontrollen varit meningslös.
    const amount = parseAmount(values.amount ?? "");
    if (amount == null) {
      setError("Ange totalbeloppet i hela kronor – kontrollera mot dokumentet.");
      return;
    }
    const vatAmount = parseAmount(values.vatAmount ?? "");
    if (vatAmount == null) {
      setError("Ange momsbeloppet i hela kronor (0 om moms saknas).");
      return;
    }
    startTransition(async () => {
      const result = await approveInboxExtractionAction({
        itemId,
        documentType: docType,
        supplier: values.supplier ?? "",
        ...(docType === "leverantorsfaktura" ? { invoiceNumber: values.invoiceNumber ?? "" } : {}),
        ...(values.invoiceDate ? { date: values.invoiceDate } : {}),
        ...(docType === "leverantorsfaktura" && values.dueDate ? { dueDate: values.dueDate } : {}),
        amount,
        vatAmount,
        ...(docType === "leverantorsfaktura" ? { ocr: values.ocr ?? "" } : {}),
        ...(docType === "leverantorsfaktura" ? { bankgiro: values.bankgiro ?? "" } : {}),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(
        result.autoBooked
          ? docType === "kvitto"
            ? "Uppgifterna godkändes – kvittot bokfördes."
            : "Uppgifterna godkändes – fakturan bokfördes."
          : "Uppgifterna godkändes."
      );
      router.push(backHref);
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-line bg-card p-5 shadow-card">
      <p className="text-[15px] font-semibold text-ink">Det här har Driva läst</p>
      <p className="mt-1 text-[13px] text-muted">
        Jämför mot dokumentet till vänster, rätta det som behövs och godkänn. Driva bokför aldrig på en
        osäker siffra.
      </p>

      <label className="mt-4 block text-[13px] font-medium text-muted">
        Dokumenttyp
        <select
          className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2 text-[14px] text-ink"
          value={docType}
          onChange={(e) => setDocType(e.target.value as ReviewDocumentType)}
        >
          <option value="leverantorsfaktura">Leverantörsfaktura (ska betalas)</option>
          <option value="kvitto">Kvitto (redan betalt – ingen utbetalning)</option>
        </select>
      </label>

      <div className="mt-4 space-y-3.5">
        {visibleKeys.map((key) => {
          const field = byKey.get(key);
          const label = field?.label ?? key;
          const isDate = DATE_KEYS.has(key);
          const isAmount = AMOUNT_KEYS.has(key);
          return (
            <div key={key}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label htmlFor={`review-${key}`} className="text-[13px] font-medium text-muted">
                  {label}
                </label>
                {fieldStateBadge(field)}
              </div>
              <input
                id={`review-${key}`}
                type={isDate ? "date" : "text"}
                inputMode={isAmount ? "numeric" : undefined}
                className={cx(
                  "w-full rounded-xl border px-3 py-2 text-[14px] text-ink",
                  field && field.value != null && field.state === "saker"
                    ? "border-line"
                    : "border-warn/60 bg-warn-soft/30"
                )}
                value={values[key] ?? ""}
                placeholder={isAmount ? "0" : undefined}
                onChange={(e) => set(key, e.target.value)}
              />
              {isAmount ? <p className="mt-0.5 text-[12px] text-muted">Hela kronor.</p> : null}
            </div>
          );
        })}
      </div>

      {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}
      {done ? <p className="mt-3 text-[13px] text-ok">{done}</p> : null}

      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          type="button"
          className={buttonClasses("secondary", "sm")}
          disabled={pending}
          onClick={() => router.push(backHref)}
        >
          Avbryt
        </button>
        <button type="button" className={buttonClasses("primary", "sm")} disabled={pending} onClick={submit}>
          {pending ? "Godkänner …" : "Godkänn uppgifter"}
        </button>
      </div>
    </div>
  );
}
