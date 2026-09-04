"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, buttonClasses } from "./ui";
import {
  createTaxReductionUnderlagAction,
  patchTaxReductionFieldsAction,
  setTaxReductionDecisionAction,
} from "@/app/actions";
import type { TaxReductionCase } from "@/lib/services/tax-reduction";
import { formatOrgnr } from "@/lib/invoices/formats";
import { formatPersonnummer } from "@/lib/personnummer";
import { formatAddressLine } from "@/lib/address-autocomplete";
import { AddressAutocomplete } from "./address-input";

export function TaxReductionApplicationCard({
  cse,
  editHref,
}: {
  cse: TaxReductionCase;
  editHref?: string;
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
