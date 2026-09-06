"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, FileCheck2, Landmark, Lock, Play, Printer, Undo2, CalendarClock } from "lucide-react";
import { buttonClasses, cx } from "./ui";
import {
  advanceAnnualReportStatusAction,
  closeFiscalYearAction,
  generateAnnualReportAction,
  generateVatReportAction,
  markVatDeclaredAction,
  planAccrualAction,
  reopenFiscalYearAction,
  runBokslutAutomationAction,
  setVatPeriodicityAction,
  undoExpenseBookingAction,
} from "@/app/bokforing-actions";
import { VAT_PERIODICITY, type VatPeriodicity } from "@/lib/accounting/dates";

/** Klientwidgets för bokföringen. All logik ligger i domänlagret – här finns bara knappar. */

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="mt-2 text-[13px] font-medium text-danger">{error}</p>;
}

export function GenerateVatReportButton({ periodKey, label = "Visa underlag" }: { periodKey: string; label?: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        className={buttonClasses("secondary", "sm")}
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const res = await generateVatReportAction(periodKey);
            setError(res.ok ? null : res.error);
          })
        }
      >
        <FileCheck2 className="size-3.5" />
        {isPending ? "Hämtar …" : label}
      </button>
      <ErrorNote error={error} />
    </div>
  );
}

export function MarkVatDeclaredButton({ reportId, attBetala }: { reportId: string; attBetala: number }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  return (
    <div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-soft">
            Har du lämnat in deklarationen hos Skatteverket? Perioden låses efteråt.
          </span>
          <button
            className={buttonClasses("primary", "sm")}
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const res = await markVatDeclaredAction(reportId);
                setError(res.ok ? null : res.error);
                if (res.ok) setConfirming(false);
              })
            }
          >
            {isPending ? "Markerar …" : "Ja, markera som deklarerad"}
          </button>
          <button className={buttonClasses("ghost", "sm")} disabled={isPending} onClick={() => setConfirming(false)}>
            Avbryt
          </button>
        </div>
      ) : (
        <button className={buttonClasses("primary", "sm")} onClick={() => setConfirming(true)}>
          <Landmark className="size-3.5" />
          Markera som deklarerad
        </button>
      )}
      <p className="mt-1.5 text-[12px] text-muted">
        Driva skickar inget till Skatteverket – du deklarerar där som vanligt
        {attBetala >= 0 ? ` och betalar ${attBetala.toLocaleString("sv-SE")} kr` : ""}.
      </p>
      <ErrorNote error={error} />
    </div>
  );
}

/**
 * Företagets momsperiod. Speglar registreringen hos Skatteverket – produkten
 * gissar aldrig utifrån omsättningen, och bytet gäller framåt.
 */
export function VatPeriodicityPicker({
  value,
  readOnly,
}: {
  value: VatPeriodicity;
  readOnly?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState(value);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[13px] text-soft" htmlFor="momsperiod">
          Momsen redovisas
        </label>
        <select
          id="momsperiod"
          className="rounded-xl border border-line-strong bg-card px-3 py-1.5 text-[13px] text-ink focus:border-accent disabled:opacity-60"
          value={chosen}
          disabled={isPending || readOnly}
          onChange={(e) => {
            const next = e.target.value as VatPeriodicity;
            setChosen(next);
            startTransition(async () => {
              const res = await setVatPeriodicityAction(next);
              if (res.ok) {
                setError(null);
                return;
              }
              setChosen(value);
              setError(res.error);
            });
          }}
        >
          {(Object.keys(VAT_PERIODICITY) as VatPeriodicity[]).map((p) => (
            <option key={p} value={p}>
              {VAT_PERIODICITY[p].label.toLowerCase()}
            </option>
          ))}
        </select>
        {isPending ? <span className="text-[12px] text-muted">Sparar …</span> : null}
      </div>
      <p className="mt-1.5 text-[12px] text-muted">
        Ska stämma med vad Skatteverket registrerat företaget för. Kvartal är huvudregeln för ett litet aktiebolag.
        Deklarationsdagen följer med: kvartal och månad den 12:e i andra månaden efter perioden (17:e i januari och
        augusti), helår i samband med inkomstdeklarationen.
      </p>
      <ErrorNote error={error} />
    </div>
  );
}

export function BokslutAutomationButton({ fiscalYearId, businessId }: { fiscalYearId: string; businessId?: string }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        className={buttonClasses("primary", "sm")}
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const res = await runBokslutAutomationAction(fiscalYearId, businessId);
            if (res.ok) {
              setResult(
                [
                  `${res.depreciations ?? 0} avskrivning${(res.depreciations ?? 0) === 1 ? "" : "ar"}`,
                  `${res.accruals ?? 0} periodisering${(res.accruals ?? 0) === 1 ? "" : "ar"}`,
                  `${res.schedules ?? 0} bokslutsbilag${(res.schedules ?? 0) === 1 ? "a" : "or"}`,
                ].join(", ") + " bokfördes."
              );
              setError(null);
            } else {
              setError(res.error);
            }
          })
        }
      >
        <Play className="size-3.5" />
        {isPending ? "Bokför …" : "Bokför bokslutsposterna"}
      </button>
      {result ? (
        <p className="mt-2 flex items-center gap-1.5 text-[13px] font-medium text-ok">
          <Check className="size-4" /> {result}
        </p>
      ) : null}
      <ErrorNote error={error} />
    </div>
  );
}

export function CloseFiscalYearButton({
  fiscalYearId,
  label,
  disabled,
  businessId,
}: {
  fiscalYearId: string;
  label: string;
  disabled?: boolean;
  /** Klienten bokslutet gäller. Konsultytan skickar den; ägaren behöver den inte. */
  businessId?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  return (
    <div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-soft">
            Året låses och rättelser bokförs därefter i det nya året. Visar det sig efteråt att något hörde till{" "}
            {label.replace(/^Slutför bokslut /, "")} går året att öppna igen – då krävs ett skäl som sparas i loggen.
            Fortsätt?
          </span>
          <button
            className={buttonClasses("primary", "sm")}
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const res = await closeFiscalYearAction(fiscalYearId, businessId);
                setError(res.ok ? null : res.error);
                if (res.ok) setConfirming(false);
              })
            }
          >
            {isPending ? "Stänger året …" : "Ja, slutför bokslutet"}
          </button>
          <button className={buttonClasses("ghost", "sm")} disabled={isPending} onClick={() => setConfirming(false)}>
            Avbryt
          </button>
        </div>
      ) : (
        <button className={buttonClasses("primary", "md")} disabled={disabled} onClick={() => setConfirming(true)}>
          <Lock className="size-4" />
          {label}
        </button>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

/**
 * Öppna ett stängt räkenskapsår igen.
 *
 * Medvetet omständlig: skälet skrivs innan knappen går att trycka, och texten
 * säger rakt ut vad som händer med bokslutsposterna och årsredovisningen. Det
 * är en åtgärd man ska mena, inte råka göra.
 */
export function ReopenFiscalYearButton({
  fiscalYearId,
  yearLabel,
  hasReport,
  blockers,
  businessId,
}: {
  fiscalYearId: string;
  yearLabel: string;
  hasReport: boolean;
  blockers: string[];
  businessId?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (blockers.length > 0) {
    return <p className="text-[12.5px] text-muted">{blockers.join(" ")}</p>;
  }

  if (!open) {
    return (
      <button className={buttonClasses("ghost", "sm")} onClick={() => setOpen(true)}>
        <Undo2 className="size-3.5" />
        Öppna året igen
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl bg-canvas/70 px-4 py-3">
      <p className="text-[13px] font-medium">Öppna {yearLabel} igen</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-soft">
        Bokslutsposterna – beräknad skatt och årets resultat mot eget kapital – återförs så att nästa bokslut räknar om
        året från grunden. Verifikationerna står kvar; återföringarna syns som egna rader.
        {hasReport
          ? " Årsredovisningen markeras som ersatt och går inte längre att ändra, men den finns kvar att läsa. En ny upprättas när året stängs igen."
          : ""}{" "}
        {Number(yearLabel) + 1} har kvar sina ingående balanser tills {yearLabel} stängs igen.
      </p>
      <label className="mt-3 block text-[12.5px] font-medium text-soft" htmlFor={`reopen-reason-${fiscalYearId}`}>
        Varför öppnas året?
      </label>
      <textarea
        id={`reopen-reason-${fiscalYearId}`}
        className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px]"
        rows={2}
        placeholder="T.ex. Fakturan från Elbolaget kom i mars men avsåg december."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <p className="mt-1 text-[12px] text-muted">Skälet sparas i audit-loggen och är det en granskare läser.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className={buttonClasses("primary", "sm")}
          disabled={isPending || reason.trim().length < 5}
          onClick={() =>
            startTransition(async () => {
              const res = await reopenFiscalYearAction(fiscalYearId, reason, businessId);
              setError(res.ok ? null : res.error);
              if (res.ok) {
                setOpen(false);
                setReason("");
                router.refresh();
              }
            })
          }
        >
          {isPending ? "Öppnar året …" : `Ja, öppna ${yearLabel}`}
        </button>
        <button
          className={buttonClasses("ghost", "sm")}
          disabled={isPending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Avbryt
        </button>
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

export function UndoBookingButton({ expenseId }: { expenseId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  if (done) {
    return (
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-ok">
        <Check className="size-4" /> Ångrad – rättelse bokförd
      </span>
    );
  }
  return (
    <div>
      <button
        className={buttonClasses("ghost", "sm")}
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const res = await undoExpenseBookingAction(expenseId);
            if (res.ok) setDone(true);
            else setError(res.error);
          })
        }
      >
        <Undo2 className="size-3.5" />
        {isPending ? "Ångrar …" : "Ångra"}
      </button>
      <ErrorNote error={error} />
    </div>
  );
}

export function GenerateAnnualReportButton({
  fiscalYearId,
  businessId,
}: {
  fiscalYearId: string;
  businessId?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        className={buttonClasses("primary", "sm")}
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const res = await generateAnnualReportAction(fiscalYearId, businessId);
            setError(res.ok ? null : res.error);
          })
        }
      >
        <FileCheck2 className="size-3.5" />
        {isPending ? "Genererar …" : "Generera årsredovisning"}
      </button>
      <ErrorNote error={error} />
    </div>
  );
}

const NEXT_STATUS: Record<string, { to: "granskad" | "signerad" | "inlamnad_markerad"; label: string; hint: string }> = {
  genererad: { to: "granskad", label: "Markera som granskad", hint: "Läs igenom siffror och texter först." },
  granskad: { to: "signerad", label: "Markera som signerad", hint: "Skriv ut och signera – Driva har ingen BankID-signering för årsredovisningar." },
  signerad: {
    to: "inlamnad_markerad",
    label: "Markera som inlämnad",
    hint: "Lämna in hos Bolagsverket själv – Driva skickar ingenting.",
  },
};

/**
 * Nästa steg i årsredovisningens gång. Blockeringarna visas i förväg – att
 * upptäcka att underskrifterna saknas först när knappen vägrar är att låta
 * användaren gå in i en vägg.
 */
export function AnnualReportStatusButton({
  reportId,
  status,
  blockers = [],
  businessId,
}: {
  reportId: string;
  status: string;
  blockers?: string[];
  businessId?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const next = NEXT_STATUS[status];
  if (!next) return null;
  const blocked = blockers.length > 0;
  return (
    <div>
      <button
        className={buttonClasses("secondary", "sm")}
        disabled={isPending || blocked}
        onClick={() =>
          startTransition(async () => {
            const res = await advanceAnnualReportStatusAction(reportId, next.to, businessId);
            setError(res.ok ? null : res.error);
            if (res.ok) router.refresh();
          })
        }
      >
        {isPending ? "Sparar \u2026" : next.label}
      </button>
      {blocked ? (
        <ul className="mt-1.5 space-y-1 text-[12px] text-warn">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-[12px] text-muted">{next.hint}</p>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

export function PlanAccrualForm({
  sourceType,
  sourceId,
  fiscalYearId,
  defaultFrom,
  defaultTo,
  businessId,
}: {
  sourceType: "utgift" | "leverantorsfaktura";
  sourceId: string;
  fiscalYearId: string;
  defaultFrom: string;
  defaultTo: string;
  businessId?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  if (done) {
    return (
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-ok">
        <Check className="size-4" /> Periodisering planerad – bokförs i bokslutet
      </span>
    );
  }
  const inputCls =
    "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-accent/30";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock className="size-4 text-muted" />
        <label className="text-[13px] text-soft">
          Gäller från{" "}
          <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-[13px] text-soft">
          till{" "}
          <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button
          className={buttonClasses("secondary", "sm")}
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const res = await planAccrualAction({
                sourceType,
                sourceId,
                fromDate: from,
                toDate: to,
                fiscalYearId,
                businessId,
              });
              if (res.ok) setDone(true);
              else setError(res.error);
            })
          }
        >
          {isPending ? "Planerar …" : "Periodisera automatiskt"}
        </button>
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

export function PrintButton({ className }: { className?: string }) {
  return (
    <button className={cx(buttonClasses("secondary", "sm"), "print:hidden", className)} onClick={() => window.print()}>
      <Printer className="size-3.5" />
      Skriv ut / PDF
    </button>
  );
}
