"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Check, ShieldCheck } from "lucide-react";
import { updateCompanyClaimsAction } from "@/app/actions";
import { insuranceStatus, isIsoDay, type CompanyClaimsInput } from "@/lib/company-claims";
import type { CompanyClaims } from "@/lib/types";
import { buttonClasses, Card, cx } from "./ui";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";
const hintCls = "mt-1 text-[12px] text-muted";

export interface CompanyClaimsCardProps {
  claims: CompanyClaims | undefined;
  /** Dagens datum (YYYY-MM-DD) från servern – styr om försäkringen räknas som giltig. */
  today: string;
}

/**
 * Inställningar → Företag → Verifierade uppgifter. Ferva påstår aldrig
 * F-skatt eller försäkring åt företaget: bara det som bekräftas här hamnar i
 * offertvillkor, dokumentsidfötter och på hemsidan. Sparas direkt.
 */
export function CompanyClaimsCard({ claims, today }: CompanyClaimsCardProps) {
  const router = useRouter();
  const [fSkattOn, setFSkattOn] = useState(Boolean(claims?.fSkatt));
  const [fSkattDate, setFSkattDate] = useState(claims?.fSkatt?.confirmedAt ?? today);
  const [fSkattSource, setFSkattSource] = useState(claims?.fSkatt?.source ?? "");
  const [insOn, setInsOn] = useState(Boolean(claims?.liabilityInsurance));
  const [insurer, setInsurer] = useState(claims?.liabilityInsurance?.insurer ?? "");
  const [validUntil, setValidUntil] = useState(claims?.liabilityInsurance?.validUntil ?? "");
  const [insSource, setInsSource] = useState(claims?.liabilityInsurance?.source ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const savedInsurance = insuranceStatus({ claims }, today);
  const insuranceExpired = savedInsurance === "utgangen";
  const fSkattError = fSkattOn && (!isIsoDay(fSkattDate) || fSkattDate > today) ? "Ange en dag som inte ligger i framtiden." : null;
  const insurerError = insOn && !insurer.trim() ? "Ange försäkringsbolaget." : null;
  const validUntilError = insOn
    ? !isIsoDay(validUntil)
      ? "Ange sista giltighetsdag."
      : validUntil < today
        ? "Försäkringen har gått ut – förnya den innan du bekräftar."
        : null
    : null;
  const blocked = Boolean(fSkattError || insurerError || validUntilError);

  function submit() {
    if (blocked) return;
    const input: CompanyClaimsInput = {
      fSkatt: { confirmed: fSkattOn, confirmedAt: fSkattDate, source: fSkattSource },
      liabilityInsurance: { confirmed: insOn, insurer, validUntil, source: insSource },
    };
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateCompanyClaimsAction(input);
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Card className="space-y-5 p-6" data-company-claims>
      <div>
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Verifierade uppgifter</p>
        <p className="mt-1 max-w-prose text-[14px] leading-relaxed text-soft">
          Ferva påstår aldrig något om F-skatt eller försäkring åt dig. Det du bekräftar här får stå i offertvillkor, i
          dokumentens sidfot och på hemsidan – och försvinner automatiskt när en försäkring gått ut. Utfärdade dokument
          ändras inte.
        </p>
      </div>

      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <fieldset className="space-y-3 rounded-xl border border-line p-4" data-claim="fskatt">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-accent"
              checked={fSkattOn}
              onChange={(e) => {
                setSaved(false);
                setFSkattOn(e.target.checked);
              }}
              data-claim-fskatt-confirm
            />
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
                <BadgeCheck className={cx("size-4", fSkattOn ? "text-ok" : "text-muted")} />
                Företaget är godkänt för F-skatt
              </span>
              <span className="mt-0.5 block text-[13px] text-muted">
                Ger raden ”Godkänd för F-skatt” på offerter och fakturor. Kontrollera i Skatteverkets e-tjänst om du är osäker.
              </span>
            </span>
          </label>
          {fSkattOn ? (
            <div className="grid gap-3 pl-7 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="claims-fskatt-date">
                  Bekräftad den
                </label>
                <input
                  id="claims-fskatt-date"
                  type="date"
                  max={today}
                  value={fSkattDate}
                  onChange={(e) => setFSkattDate(e.target.value)}
                  aria-invalid={fSkattError ? true : undefined}
                  className={cx(inputCls, fSkattError && "border-danger")}
                />
                {fSkattError ? <p className="mt-1 text-[12px] text-danger">{fSkattError}</p> : null}
              </div>
              <div>
                <label className={labelCls} htmlFor="claims-fskatt-source">
                  Källa <span className="font-normal text-muted">(valfritt)</span>
                </label>
                <input
                  id="claims-fskatt-source"
                  type="text"
                  maxLength={200}
                  placeholder="t.ex. Skatteverkets registerutdrag"
                  value={fSkattSource}
                  onChange={(e) => setFSkattSource(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
          ) : null}
        </fieldset>

        <fieldset className="space-y-3 rounded-xl border border-line p-4" data-claim="forsakring">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-accent"
              checked={insOn}
              onChange={(e) => {
                setSaved(false);
                setInsOn(e.target.checked);
              }}
              data-claim-insurance-confirm
            />
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
                <ShieldCheck className={cx("size-4", insOn && !insuranceExpired ? "text-ok" : "text-muted")} />
                Företaget har ansvarsförsäkring
              </span>
              <span className="mt-0.5 block text-[13px] text-muted">
                Nämns i offertvillkoren och på hemsidan fram till sista giltighetsdag. Därefter tas påståendet bort tills du bekräftar en ny period.
              </span>
            </span>
          </label>
          {insuranceExpired ? (
            <p className="ml-7 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn" data-claim-insurance-expired>
              Försäkringen som bekräftades gick ut {claims!.liabilityInsurance!.validUntil}. Påståendet visas inte längre –
              ange den nya perioden när du förnyat.
            </p>
          ) : null}
          {insOn ? (
            <div className="grid gap-3 pl-7 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="claims-insurer">
                  Försäkringsbolag
                </label>
                <input
                  id="claims-insurer"
                  type="text"
                  maxLength={200}
                  placeholder="t.ex. Länsförsäkringar"
                  value={insurer}
                  onChange={(e) => setInsurer(e.target.value)}
                  aria-invalid={insurerError ? true : undefined}
                  className={cx(inputCls, insurerError && "border-danger")}
                />
                {insurerError ? <p className="mt-1 text-[12px] text-danger">{insurerError}</p> : null}
              </div>
              <div>
                <label className={labelCls} htmlFor="claims-valid-until">
                  Giltig till och med
                </label>
                <input
                  id="claims-valid-until"
                  type="date"
                  min={today}
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                  aria-invalid={validUntilError ? true : undefined}
                  className={cx(inputCls, validUntilError && "border-danger")}
                />
                {validUntilError ? <p className="mt-1 text-[12px] text-danger">{validUntilError}</p> : null}
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls} htmlFor="claims-insurance-source">
                  Försäkringsnummer eller länk till försäkringsbrevet <span className="font-normal text-muted">(valfritt)</span>
                </label>
                <input
                  id="claims-insurance-source"
                  type="text"
                  maxLength={200}
                  placeholder="t.ex. försäkringsnummer 123 456"
                  value={insSource}
                  onChange={(e) => setInsSource(e.target.value)}
                  className={inputCls}
                />
                <p className={hintCls}>Bilagor laddas inte upp här – spara försäkringsbrevet i inkorgen eller hos försäkringsbolaget.</p>
              </div>
            </div>
          ) : null}
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={buttonClasses("primary", "sm")} disabled={pending || blocked} data-claims-save>
            {pending ? "Sparar …" : "Spara bekräftelser"}
          </button>
          {error ? (
            <p className="text-[13px] font-medium text-danger">{error}</p>
          ) : saved ? (
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-ok">
              <Check className="size-4" /> Sparat
            </p>
          ) : claims?.fSkatt || claims?.liabilityInsurance ? (
            <p className="text-[13px] text-muted">
              {claims.fSkatt ? `F-skatt bekräftad ${claims.fSkatt.confirmedAt}.` : ""}{" "}
              {claims.liabilityInsurance && savedInsurance === "giltig"
                ? `Försäkring hos ${claims.liabilityInsurance.insurer} t.o.m. ${claims.liabilityInsurance.validUntil}.`
                : ""}
            </p>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
