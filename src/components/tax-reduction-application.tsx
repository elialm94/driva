"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, buttonClasses } from "./ui";
import {
  createTaxReductionUnderlagAction,
  patchHusExportFieldsAction,
  patchTaxReductionFieldsAction,
  setTaxReductionDecisionAction,
} from "@/app/actions";
import type { TaxReductionCase } from "@/lib/services/tax-reduction";
import type { HusExportPreview } from "@/lib/services/hus-export";
import { formatOrgnr } from "@/lib/invoices/formats";
import { formatPersonnummer } from "@/lib/personnummer";
import { formatAddressLine } from "@/lib/address-autocomplete";
import { datumKort, kr } from "@/lib/format";
import { AddressAutocomplete } from "./address-input";
import { AppLink } from "./app-link";

export function TaxReductionApplicationCard({
  cse,
  editHref,
  hus,
}: {
  cse: TaxReductionCase;
  editHref?: string;
  /** HUS-filen till Skatteverket – bara relevant när underlaget finns. */
  hus?: HusExportPreview | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [fieldValue, setFieldValue] = useState("");

  if (cse.phase === "none" || cse.phase === "preliminar" || cse.phase === "waiting_payment" || cse.phase === "waiting_work") {
    return null;
  }

  const missing = cse.missing[0];
  const kind = cse.label;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "Något gick fel.");
        return;
      }
      router.refresh();
    });
  }

  const firstMissing = missing?.code;
  const addPlaceholder =
    firstMissing === "propertyDesignation"
      ? "Fastighetsbeteckning"
      : firstMissing === "personnummer"
        ? "Personnummer"
        : firstMissing === "brfOrgNumber"
          ? "BRF organisationsnummer"
          : firstMissing === "apartmentNumber"
            ? "Lägenhetsnummer"
            : firstMissing === "workAddress"
              ? "Adress"
            : firstMissing === "workPeriod"
              ? "Arbetsperiod (ÅÅÅÅ-MM-DD)"
              : missing?.label ?? "";

  function submitMissing() {
    if (!missing) return;
    const patch: Parameters<typeof patchTaxReductionFieldsAction>[0] = {
      jobId: cse.jobId,
      invoiceId: cse.invoiceId,
    };
    const v = fieldValue.trim();
    if (!v) return;
    if (missing.code === "personnummer") patch.personalIdentityNumber = formatPersonnummer(v);
    if (missing.code === "workAddress") patch.workAddress = v;
    if (missing.code === "workPeriod") patch.workPeriodStart = v;
    if (missing.code === "propertyDesignation") patch.propertyDesignation = v;
    if (missing.code === "brfOrgNumber") patch.brfOrgNumber = formatOrgnr(v);
    if (missing.code === "apartmentNumber") patch.apartmentNumber = v;
    if (missing.code === "dwellingType") patch.dwellingType = v === "bostadsratt" ? "bostadsratt" : "smahus";
    run(() => patchTaxReductionFieldsAction(patch));
  }

  return (
    <Card className="mb-6 border-line px-5 py-4">
      {cse.phase === "missing_fields" ? (
        <>
          <p className="text-[15px] font-semibold text-ink">En uppgift saknas för {kind}</p>
          <p className="mt-1.5 text-[14px] leading-relaxed text-soft">
            Lägg till {missing?.label.toLowerCase() ?? "uppgiften"} så att Driva kan skapa underlag till Skatteverket
            senare.
          </p>
          {addOpen ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              {missing?.code === "dwellingType" ? (
                <div className="flex gap-1.5">
                  <button type="button" className={buttonClasses("secondary", "sm")} onClick={() => setFieldValue("smahus")}>
                    Fastighet/småhus
                  </button>
                  <button
                    type="button"
                    className={buttonClasses("secondary", "sm")}
                    onClick={() => setFieldValue("bostadsratt")}
                  >
                    Bostadsrätt
                  </button>
                </div>
              ) : firstMissing === "workAddress" ? (
                <div className="w-full max-w-xs">
                  <AddressAutocomplete
                    hideLabel
                    value={fieldValue}
                    onChange={setFieldValue}
                    onSelect={(parts) => setFieldValue(formatAddressLine(parts))}
                    composeSelected="line"
                    placeholder={addPlaceholder}
                    inputClassName="w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px]"
                  />
                </div>
              ) : (
                <input
                  value={fieldValue}
                  onChange={(e) => setFieldValue(e.target.value)}
                  placeholder={addPlaceholder}
                  className="w-full max-w-xs rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px]"
                />
              )}
              <button className={buttonClasses("primary", "sm")} disabled={isPending} onClick={submitMissing}>
                {isPending ? "Sparar …" : "Spara"}
              </button>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={buttonClasses("primary", "sm")} onClick={() => setAddOpen(true)}>
                Lägg till
              </button>
              {editHref ? (
                <Link href={editHref as never} className={buttonClasses("secondary", "sm")}>
                  Öppna fakturan
                </Link>
              ) : null}
            </div>
          )}
        </>
      ) : null}

      {cse.phase === "ready" ? (
        <>
          <p className="text-[15px] font-semibold text-ink">{kind} redo att ansökas</p>
          <p className="mt-1.5 text-[14px] leading-relaxed text-soft">
            Kunden har betalat sin del och arbetet är klart. Skapa ett underlag – ingen ansökan skickas till
            Skatteverket automatiskt.
          </p>
          <button
            className={buttonClasses("primary", "sm") + " mt-3"}
            disabled={isPending}
            onClick={() =>
              run(() => createTaxReductionUnderlagAction({ jobId: cse.jobId, invoiceId: cse.invoiceId }))
            }
          >
            {isPending ? "Skapar …" : "Skapa ansökningsunderlag"}
          </button>
        </>
      ) : null}

      {cse.phase === "underlag" ? (
        <>
          <p className="text-[15px] font-semibold text-ink">Ansökningsunderlag {kind}</p>
          {cse.application?.underlagSummary ? (
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-canvas px-3 py-2 text-[12px] leading-relaxed text-soft">
              {cse.application.underlagSummary}
            </pre>
          ) : null}
          {hus ? <HusExportSection hus={hus} jobId={cse.jobId} invoiceId={cse.invoiceId} run={run} isPending={isPending} /> : null}
          <p className="mt-3 text-[13px] text-muted">Väntar på Skatteverket – markera beslutet när det kommer.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className={buttonClasses("secondary", "sm")}
              disabled={isPending}
              onClick={() =>
                run(() =>
                  setTaxReductionDecisionAction({ jobId: cse.jobId, invoiceId: cse.invoiceId, outcome: "godkant" })
                )
              }
            >
              Godkänt
            </button>
            <button
              className={buttonClasses("secondary", "sm")}
              disabled={isPending}
              onClick={() =>
                run(() =>
                  setTaxReductionDecisionAction({
                    jobId: cse.jobId,
                    invoiceId: cse.invoiceId,
                    outcome: "delvis_godkant",
                  })
                )
              }
            >
              Delvis
            </button>
            <button
              className={buttonClasses("secondary", "sm")}
              disabled={isPending}
              onClick={() =>
                run(() =>
                  setTaxReductionDecisionAction({ jobId: cse.jobId, invoiceId: cse.invoiceId, outcome: "nekat" })
                )
              }
            >
              Nekat
            </button>
          </div>
        </>
      ) : null}

      {cse.phase === "godkant" || cse.phase === "delvis_godkant" || cse.phase === "nekat" ? (
        <p className="text-[15px] font-semibold text-ink">
          {kind} {cse.phase === "godkant" ? "godkänt" : cse.phase === "delvis_godkant" ? "delvis godkänt" : "nekat"}
        </p>
      ) : null}

      {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
    </Card>
  );
}

const INPUT = "rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px]";

/**
 * "Ladda ner fil till Skatteverket": HUS-XML (Begäran v6) att importera själv i
 * e-tjänsten Rot och rut – företag. Samma yta som underlaget, inget nytt noun.
 * Luckor blockerar nedladdningen med länk till där de åtgärdas.
 */
function HusExportSection({
  hus,
  jobId,
  invoiceId,
  run,
  isPending,
}: {
  hus: HusExportPreview;
  jobId?: string;
  invoiceId?: string;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
  isPending: boolean;
}) {
  const router = useRouter();
  const [hours, setHours] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      hus.invoices
        .filter((r) => r.derivedHours == null)
        .map((r) => [r.invoiceId, r.manualHours != null ? String(r.manualHours) : ""])
    )
  );
  const manualRows = hus.invoices.filter((r) => r.derivedHours == null);
  const hoursDirty = manualRows.some((r) => (hours[r.invoiceId] ?? "") !== (r.manualHours != null ? String(r.manualHours) : ""));
  const kind = hus.type.toUpperCase();
  const canDownload = hus.blockers.length === 0;

  function saveHours() {
    const patch: Record<string, number | null> = {};
    for (const r of manualRows) {
      const raw = (hours[r.invoiceId] ?? "").trim().replace(",", ".");
      patch[r.invoiceId] = raw === "" ? null : Number(raw);
    }
    run(() => patchHusExportFieldsAction({ jobId, invoiceId, laborHoursByInvoice: patch }));
  }

  return (
    <div id="hus-fil" className="mt-4 border-t border-line pt-4">
      <p className="text-[14px] font-semibold text-ink">Fil till Skatteverket</p>
      <p className="mt-1 text-[13px] leading-relaxed text-soft">
        Ladda ner en XML-fil och importera den själv i Skatteverkets e-tjänst <em>Rot och rut – företag</em>. Driva
        skickar ingenting till Skatteverket.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[12px] font-medium text-muted" htmlFor="hus-arbetsomrade">
          Arbetsområde
          <select
            id="hus-arbetsomrade"
            value={hus.category ?? ""}
            disabled={isPending}
            onChange={(e) => run(() => patchHusExportFieldsAction({ jobId, invoiceId, workCategory: e.target.value }))}
            className={INPUT + " font-normal text-ink"}
          >
            {hus.type === "rut" ? <option value="">Välj arbetsområde …</option> : null}
            {hus.categories.map((c) => (
              <option key={c} value={c}>
                {hus.categoryLabels[c]}
                {hus.type === "rot" && c === "Bygg" && !hus.categoryExplicit ? " (standard)" : ""}
              </option>
            ))}
          </select>
        </label>

        {hus.invoices.map((r) => {
          const nr = r.number != null ? `#${r.number}` : "";
          if (r.derivedHours != null) {
            return (
              <p key={r.invoiceId} className="self-end text-[13px] text-soft">
                Arbetade timmar {nr}: <span className="font-medium text-ink">{r.derivedHours} tim</span>{" "}
                <span className="text-muted">(från fakturaraderna)</span>
              </p>
            );
          }
          return (
            <label
              key={r.invoiceId}
              className="flex flex-col gap-1 text-[12px] font-medium text-muted"
              htmlFor={`hus-timmar-${r.invoiceId}`}
            >
              Arbetade timmar {nr}
              <input
                id={`hus-timmar-${r.invoiceId}`}
                inputMode="numeric"
                placeholder="t.ex. 40"
                value={hours[r.invoiceId] ?? ""}
                onChange={(e) => setHours((h) => ({ ...h, [r.invoiceId]: e.target.value }))}
                className={INPUT + " font-normal text-ink"}
              />
            </label>
          );
        })}
      </div>
      {manualRows.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={buttonClasses("secondary", "sm")} disabled={isPending || !hoursDirty} onClick={saveHours}>
            {isPending ? "Sparar …" : "Spara timmar"}
          </button>
          <span className="text-[12px] text-muted">Fast pris på raderna – ange faktiskt arbetade timmar.</span>
        </div>
      ) : null}

      {hus.blockers.length ? (
        <ul id="hus-luckor" className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-soft">
          {hus.blockers.map((b, i) => (
            <li key={`${b.code}-${b.invoiceId ?? i}`}>
              {b.label}
              {b.href ? (
                <>
                  {" "}
                  {b.href.startsWith("#") ? (
                    <a href={b.href} className="font-medium text-ink underline-offset-2 hover:underline">
                      {b.actionLabel ?? "Komplettera"}
                    </a>
                  ) : (
                    <AppLink href={b.href} className="font-medium text-ink underline-offset-2 hover:underline">
                      {b.actionLabel ?? "Komplettera"}
                    </AppLink>
                  )}
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {canDownload ? (
          <a
            href={hus.downloadHref}
            download={hus.fileName}
            data-testid="hus-download"
            className={buttonClasses("primary", "sm")}
            onClick={() => window.setTimeout(() => router.refresh(), 1500)}
          >
            Ladda ner fil till Skatteverket
          </a>
        ) : (
          <button type="button" className={buttonClasses("primary", "sm")} disabled data-testid="hus-download">
            Ladda ner fil till Skatteverket
          </button>
        )}
        <span className="text-[12px] text-muted">
          {kind} · begärt {kr(hus.invoices.reduce((s, r) => s + r.deduction, 0))}
          {hus.fileDownloadedAt ? ` · fil nedladdad ${datumKort(hus.fileDownloadedAt)}` : ""}
        </span>
      </div>
    </div>
  );
}
