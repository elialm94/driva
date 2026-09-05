"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, FileUp, Upload } from "lucide-react";
import { importSieOpeningBalancesAction, previewSieImportAction } from "@/app/sie-import-actions";
import type { SieImportPreview } from "@/lib/accounting/sie";
import type { SieImportResult } from "@/lib/accounting/sie-import";
import { kr } from "@/lib/format";
import { Badge, buttonClasses, cx } from "./ui";

/**
 * SIE-import i två steg: läs filen, se vad den skulle göra, importera sedan.
 *
 * Mellansteget är hela poängen. Ingående balanser är det enda stället i Driva
 * där ett saldo sätts utan verifikation, så den som gör det ska se kontoplanen,
 * beloppen och varningarna först. Filen ligger kvar i webbläsaren mellan stegen
 * – servern håller inget halvfärdigt importläge.
 */

export interface SieImportPanelProps {
  /** Räkenskapsåret balanserna blir ingående balans för. */
  fiscalYearId: string;
  fiscalYearLabel: string;
  /** Klienten importen gäller. Konsultytan skickar den. */
  businessId?: string;
}

const MAX_BYTES = 8 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Filen kunde inte läsas."));
    // Data-URL, inte text: SIE skrivs i PC8 och servern måste se byten själv.
    reader.readAsDataURL(file);
  });
}

export function SieImportPanel({ fiscalYearId, fiscalYearLabel, businessId }: SieImportPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [preview, setPreview] = useState<SieImportPreview | null>(null);
  const [result, setResult] = useState<SieImportResult | null>(null);

  function choose(chosen: File | null) {
    if (!chosen) return;
    setError(null);
    setPreview(null);
    setResult(null);
    if (chosen.size > MAX_BYTES) {
      setError("SIE-filen är större än 8 MB. Exportera ett enskilt räkenskapsår i stället.");
      return;
    }
    startTransition(async () => {
      try {
        const base64 = await fileToBase64(chosen);
        const response = await previewSieImportAction(base64, businessId);
        if (!response.ok) {
          setError(response.error);
          return;
        }
        setFile({ name: chosen.name, base64 });
        setPreview(response.preview);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Filen kunde inte läsas.");
      }
    });
  }

  function runImport() {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      const response = await importSieOpeningBalancesAction(file.base64, fiscalYearId, businessId);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setResult(response.result);
      setPreview(null);
      setFile(null);
      router.refresh();
    });
  }

  if (result) {
    return (
      <div className="rounded-2xl border border-ok/40 bg-ok-soft/40 px-5 py-4">
        <p className="text-[14px] font-medium">Ingående balanser är på plats för {fiscalYearLabel}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-soft">
          {result.accountsTotal} konto{result.accountsTotal === 1 ? "" : "n"} fick ingående balans
          {result.accountsCreated > 0
            ? `, och ${result.accountsCreated} konto${result.accountsCreated === 1 ? "" : "n"} lades till i kontoplanen`
            : ""}
          .{" "}
          {result.balancedWith
            ? `Filen gick inte ihop, så ${kr(Math.abs(result.balancedWith))} lades på balanserat resultat.`
            : "Balanserna summerade till noll."}
        </p>
        {result.warnings.length > 0 ? (
          <ul className="mt-2.5 space-y-1">
            {result.warnings.map((w, i) => (
              <li key={i} className="text-[12.5px] leading-relaxed text-soft">
                {w}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  const balanceRows = preview
    ? Object.entries(preview.openingBalances)
        .map(([account, amount]) => ({ account: Number(account), amount }))
        .sort((a, b) => a.account - b.account)
    : [];
  const balanceSum = balanceRows.reduce((s, r) => s + r.amount, 0);

  return (
    <div>
      <label className={cx(buttonClasses("secondary", "sm"), "cursor-pointer")}>
        <FileUp className="size-3.5" />
        {isPending && !preview ? "Läser filen …" : preview ? "Välj en annan fil" : "Välj SIE-fil"}
        <input
          type="file"
          accept=".se,.si,.sie,.SE,.SI,.SIE,text/plain"
          className="hidden"
          disabled={isPending}
          onChange={(e) => choose(e.target.files?.[0] ?? null)}
        />
      </label>

      {error ? (
        <p className="mt-2.5 flex items-start gap-1.5 text-[13px] text-danger">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {preview ? (
        <div className="mt-4 rounded-2xl bg-canvas/70 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[14px] font-medium">{preview.companyName ?? file?.name ?? "SIE-fil"}</p>
            {preview.orgNumber ? <Badge tone="neutral">{preview.orgNumber}</Badge> : null}
          </div>
          <p className="mt-1 text-[13px] text-soft">
            Filens räkenskapsår: {preview.fiscalYears.map((y) => `${y.startDate} – ${y.endDate}`).join(", ")} ·{" "}
            {preview.accounts.length} konto{preview.accounts.length === 1 ? "" : "n"} i kontoplanen
          </p>

          <table className="mt-3 w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <th className="pb-1.5 font-semibold">Konto</th>
                <th className="pb-1.5 text-right font-semibold">Ingående balans</th>
              </tr>
            </thead>
            <tbody>
              {balanceRows.map((row) => (
                <tr key={row.account} className="border-t border-line/50">
                  <td className="py-1.5 pr-3">
                    <span className="font-mono text-muted">{row.account}</span>{" "}
                    {preview.accounts.find((a) => a.account === row.account)?.name ?? ""}
                  </td>
                  <td className="py-1.5 text-right tabular">{kr(row.amount)}</td>
                </tr>
              ))}
              <tr className="border-t border-line">
                <td className="py-1.5 pr-3 font-medium">Summa</td>
                <td className={cx("py-1.5 text-right font-semibold tabular", balanceSum !== 0 && "text-warn")}>
                  {kr(balanceSum)}
                </td>
              </tr>
            </tbody>
          </table>

          {preview.warnings.length > 0 ? (
            <ul className="mt-3 space-y-1 border-t border-line/60 pt-3">
              {preview.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-soft">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" />
                  {w}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-4 border-t border-line/60 pt-4">
            <button type="button" onClick={runImport} disabled={isPending} className={buttonClasses("primary", "sm")}>
              <Upload className="size-3.5" />
              {isPending ? "Importerar …" : `Sätt som ingående balans ${fiscalYearLabel}`}
            </button>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
              Verifikationerna i filen importeras inte. Historiken ligger kvar i det gamla programmet, där den ändå ska
              arkiveras i sju år, och kommer in här som ingående balans.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
