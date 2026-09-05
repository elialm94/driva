"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookCheck, Calculator, Plus } from "lucide-react";
import { buttonClasses, Card, cx } from "./ui";
import { DateField } from "./date-field";
import { kr } from "@/lib/format";
import {
  planManualAccrualAction,
  previewYearEndScheduleAction,
  saveAndBookYearEndScheduleAction,
} from "@/app/bokforing-actions";
import { SCHEDULE_PURPOSE, vacationDayValue } from "@/lib/accounting/year-end-model";
import type { AccrualKind, YearEndScheduleInputs, YearEndScheduleKind, YearEndScheduleLine } from "@/lib/types";

/**
 * Bokslutsbilagorna i gränssnittet. Tre av dem kräver en uppgift bokföringen
 * inte känner – sparade semesterdagar, vilka fordringar som är osäkra, hur stor
 * avsättning bolaget vill göra – så widgeten frågar och servern räknar.
 */

const fieldCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2.5 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="mt-2 text-[13px] font-medium text-danger">{error}</p>;
}

function amount(value: string): number {
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

interface Draft {
  closingAmount: number;
  lines: YearEndScheduleLine[];
  bookedAmount: number;
  change: number;
  contribution?: { closingAmount: number; bookedAmount: number; change: number; percent: number };
  explanation: string;
  errors: string[];
}

/** Vad bokföringen kommer att göra, i klartext. Ingen bilaga bokförs blint. */
function DraftPreview({ draft }: { draft: Draft }) {
  const rows = draft.lines.filter((l) => l.amount !== 0 || draft.lines.length <= 3);
  return (
    <div className="mt-4 rounded-xl border border-line bg-subtle p-4">
      {rows.length > 0 && (
        <table className="w-full text-[13px]">
          <tbody>
            {rows.map((line, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="py-2 pr-3 align-top">
                  <span className="text-ink">{line.label}</span>
                  {line.note && <span className="mt-0.5 block text-[12px] text-soft">{line.note}</span>}
                </td>
                <td className="py-2 text-right align-top font-medium tabular-nums text-ink">{kr(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-3 flex items-baseline justify-between border-t border-line-strong pt-3">
        <span className="text-[13px] font-semibold text-ink">Utgående saldo</span>
        <span className="text-[15px] font-semibold tabular-nums text-ink">{kr(draft.closingAmount)}</span>
      </div>
      <p className="mt-2 text-[12px] text-soft">
        Kontot visar {kr(draft.bookedAmount)}.{" "}
        {draft.change === 0 ? (
          "Bilagan stämmer med bokföringen – inget att bokföra."
        ) : (
          <>
            Bilagan bokför förändringen: <strong className="text-ink">{kr(draft.change)}</strong>.
          </>
        )}
        {draft.contribution && draft.contribution.change !== 0 && (
          <> Sociala avgifter justeras med {kr(draft.contribution.change)}.</>
        )}
      </p>
      {draft.errors.length > 0 && (
        <ul className="mt-3 space-y-1">
          {draft.errors.map((e, i) => (
            <li key={i} className="text-[13px] font-medium text-danger">
              {e}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Gemensamt skal: räknar om bilagan på servern när underlaget ändras och
 * bokför när användaren godkänner. Formuläret för varje bilaga fyller i
 * children och lämnar inputs.
 */
function ScheduleShell({
  fiscalYearId,
  kind,
  inputs,
  ready,
  children,
  bookLabel = "Bokför bilagan",
}: {
  fiscalYearId: string;
  kind: YearEndScheduleKind;
  inputs: YearEndScheduleInputs;
  ready: boolean;
  children: React.ReactNode;
  bookLabel?: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booking, startBooking] = useTransition();
  const serialized = JSON.stringify(inputs);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    const timer = setTimeout(async () => {
      const res = await previewYearEndScheduleAction({ fiscalYearId, kind, inputs: JSON.parse(serialized) });
      if (!live) return;
      if (res.ok) {
        setDraft(res.draft);
        setError(null);
      } else {
        setDraft(null);
        setError(res.error);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // serialized fångar inputs; objektet är nytt vid varje rendering.
  }, [fiscalYearId, kind, serialized, ready]);

  // Utkastet visas bara när underlaget är ifyllt – annars är det från ett läge användaren lämnat.
  const shown = ready ? draft : null;
  const blocked = !shown || shown.errors.length > 0 || shown.change === 0;

  return (
    <Card className="p-5">
      <h3 className="text-[15px] font-semibold text-ink">{SCHEDULE_TITLE[kind]}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-soft">{SCHEDULE_PURPOSE[kind]}</p>
      <div className="mt-4 space-y-4">{children}</div>
      {shown && <DraftPreview draft={shown} />}
      <div className="mt-4 flex items-center gap-3">
        <button
          className={buttonClasses("primary", "sm")}
          disabled={blocked || booking}
          onClick={() =>
            startBooking(async () => {
              const res = await saveAndBookYearEndScheduleAction({ fiscalYearId, kind, inputs });
              if (res.ok) {
                setError(null);
                router.refresh();
              } else setError(res.error);
            })
          }
        >
          <BookCheck className="size-3.5" />
          {booking ? "Bokför …" : bookLabel}
        </button>
        {shown && shown.change === 0 && shown.errors.length === 0 && (
          <span className="text-[13px] text-soft">Inget att bokföra.</span>
        )}
      </div>
      <ErrorNote error={error} />
    </Card>
  );
}

const SCHEDULE_TITLE: Record<YearEndScheduleKind, string> = {
  semesterloneskuld: "Semesterlöneskuld",
  kundfordringar_nedskrivning: "Nedskrivning av kundfordringar",
  periodiseringsfond: "Periodiseringsfond",
};

/* --------------------------- Semesterlöneskuld ---------------------------- */

export function VacationLiabilityForm({
  fiscalYearId,
  savedDays,
  monthlySalary,
}: {
  fiscalYearId: string;
  savedDays: number;
  monthlySalary: number;
}) {
  const [days, setDays] = useState(String(savedDays || ""));
  const value = vacationDayValue(monthlySalary);
  const parsed = Math.max(0, Math.round(Number(days.replace(",", ".")) || 0));

  return (
    <ScheduleShell
      fiscalYearId={fiscalYearId}
      kind="semesterloneskuld"
      inputs={{ savedVacationDays: parsed }}
      ready={days.trim() !== ""}
    >
      <div className="max-w-[220px]">
        <label className={labelCls} htmlFor="saved-days">
          Sparade betalda semesterdagar
        </label>
        <input
          id="saved-days"
          className={fieldCls}
          inputMode="numeric"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          placeholder="0"
        />
      </div>
      <p className="text-[12px] text-soft">
        Dagar som är intjänade men inte uttagna vid årets slut. Varje dag är värd {kr(value.perDay)} –{" "}
        {kr(value.semesterlon)} semesterlön och {kr(value.tillagg)} semestertillägg på månadslönen{" "}
        {kr(monthlySalary)}.
      </p>
    </ScheduleShell>
  );
}

/* ----------------------- Nedskrivning av kundfordringar -------------------- */

export interface DoubtfulRow {
  id: string;
  label: string;
  daysOverdue: number;
  amountExcludingVat: number;
  outstanding: number;
}

export function DoubtfulReceivablesForm({
  fiscalYearId,
  suggestions,
  selected,
}: {
  fiscalYearId: string;
  suggestions: DoubtfulRow[];
  selected: string[];
}) {
  const [picked, setPicked] = useState<string[]>(selected);
  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  if (suggestions.length === 0 && picked.length === 0) {
    return (
      <Card className="p-5">
        <h3 className="text-[15px] font-semibold text-ink">Nedskrivning av kundfordringar</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-soft">{SCHEDULE_PURPOSE.kundfordringar_nedskrivning}</p>
        <p className="mt-4 text-[13px] text-soft">
          Ingen kundfordring har legat förfallen länge nog att kallas osäker. Inget att göra.
        </p>
      </Card>
    );
  }

  return (
    <ScheduleShell
      fiscalYearId={fiscalYearId}
      kind="kundfordringar_nedskrivning"
      inputs={{ doubtfulInvoiceIds: picked }}
      ready
    >
      <ul className="space-y-2">
        {suggestions.map((s) => (
          <li key={s.id}>
            <label
              className={cx(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3",
                picked.includes(s.id) ? "border-accent bg-accent-soft" : "border-line bg-card"
              )}
            >
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--accent)]"
                checked={picked.includes(s.id)}
                onChange={() => toggle(s.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium text-ink">{s.label}</span>
                <span className="block text-[12px] text-soft">
                  {s.daysOverdue} dagar förfallen · {kr(s.outstanding)} obetalt · {kr(s.amountExcludingVat)}{" "}
                  exklusive moms
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-soft">
        Bedömningen är din. En förfallen faktura kan fortfarande betalas – nedskrivningen tar inte bort fordran,
        den sänker bara värdet i balansräkningen.
      </p>
    </ScheduleShell>
  );
}

/* --------------------------- Periodiseringsfond ---------------------------- */

export interface FundLotRow {
  year: number;
  amount: number;
  lastYear: number;
  mustReverse: boolean;
}

export function FundForm({
  fiscalYearId,
  maxAllocation,
  lots,
  allocation: initialAllocation,
}: {
  fiscalYearId: string;
  maxAllocation: number;
  lots: FundLotRow[];
  allocation: number;
}) {
  const [allocation, setAllocation] = useState(initialAllocation ? String(initialAllocation) : "");
  const [reversals, setReversals] = useState<Record<number, string>>(() =>
    Object.fromEntries(lots.filter((l) => l.mustReverse).map((l) => [l.year, String(l.amount)]))
  );

  const inputs: YearEndScheduleInputs = {
    fundAllocation: amount(allocation),
    fundReversals: lots
      .map((l) => ({ year: l.year, amount: amount(reversals[l.year] ?? "") }))
      .filter((r) => r.amount > 0),
  };

  return (
    <ScheduleShell fiscalYearId={fiscalYearId} kind="periodiseringsfond" inputs={inputs} ready>
      <div className="max-w-[260px]">
        <label className={labelCls} htmlFor="fund-allocation">
          Avsättning i år
        </label>
        <input
          id="fund-allocation"
          className={fieldCls}
          inputMode="numeric"
          value={allocation}
          onChange={(e) => setAllocation(e.target.value)}
          placeholder="0"
        />
        <p className="mt-1 text-[12px] text-soft">
          Högst {kr(maxAllocation)} – 25 % av det skattemässiga resultatet före avsättning.
        </p>
        {maxAllocation > 0 && (
          <button
            className="mt-2 text-[13px] font-medium text-accent hover:underline"
            onClick={() => setAllocation(String(maxAllocation))}
          >
            Sätt av maxbeloppet
          </button>
        )}
      </div>

      {lots.length > 0 && (
        <div>
          <p className={labelCls}>Tidigare fonder – återför helt eller delvis</p>
          <ul className="space-y-2">
            {lots.map((lot) => (
              <li key={lot.year} className="flex items-center gap-3 rounded-xl border border-line bg-card p-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium text-ink">
                    Avsatt {lot.year} · {kr(lot.amount)}
                  </span>
                  <span className="block text-[12px] text-soft">
                    {lot.mustReverse
                      ? `Måste återföras i år – sista året var ${lot.lastYear}.`
                      : `Ska vara återförd senast räkenskapsåret ${lot.lastYear}.`}
                  </span>
                </span>
                <input
                  className={cx(fieldCls, "w-[130px]")}
                  inputMode="numeric"
                  aria-label={`Återför från ${lot.year}`}
                  value={reversals[lot.year] ?? ""}
                  onChange={(e) => setReversals((prev) => ({ ...prev, [lot.year]: e.target.value }))}
                  placeholder="0"
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </ScheduleShell>
  );
}

/* ---------------------------- Manuell periodisering ------------------------ */

const ACCRUAL_KINDS: { kind: AccrualKind; label: string; hint: string; counterHint: string }[] = [
  {
    kind: "forutbetald_kostnad",
    label: "Förutbetald kostnad",
    hint: "Betalt i år för något som hör till nästa år – en försäkring eller hyra som sträcker sig över årsskiftet.",
    counterHint: "Kostnadskontot fakturan bokfördes på, till exempel 6310 för försäkringar.",
  },
  {
    kind: "upplupen_kostnad",
    label: "Upplupen kostnad",
    hint: "Kostnaden hör till i år men fakturan kommer nästa år – revisionsarvodet eller decembers el.",
    counterHint: "Kostnadskontot kostnaden hör till, till exempel 6420 för revision.",
  },
  {
    kind: "forutbetald_intakt",
    label: "Förutbetald intäkt",
    hint: "Du har fått betalt för något du ska leverera nästa år – en förskottsfakturerad prenumeration.",
    counterHint: "Intäktskontot fakturan bokfördes på, till exempel 3001.",
  },
  {
    kind: "upplupen_intakt",
    label: "Upplupen intäkt",
    hint: "Arbetet är utfört i år men faktureras nästa år.",
    counterHint: "Intäktskontot arbetet hör till, till exempel 3001.",
  },
];

/**
 * Periodiseringar utan bokfört underlag. En upplupen kostnad – revisionsarvodet
 * för i år som faktureras nästa år – har ingen faktura att utgå från, så belopp,
 * konto och period anges för hand.
 */
export function ManualAccrualForm({ fiscalYearId, yearEnd }: { fiscalYearId: string; yearEnd: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AccrualKind>("upplupen_kostnad");
  const [description, setDescription] = useState("");
  const [total, setTotal] = useState("");
  const [account, setAccount] = useState("");
  const [fromDate, setFromDate] = useState(yearEnd);
  const [toDate, setToDate] = useState(`${Number(yearEnd.slice(0, 4)) + 1}-${yearEnd.slice(5)}`);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const chosen = ACCRUAL_KINDS.find((k) => k.kind === kind)!;
  const valid = description.trim() !== "" && amount(total) > 0 && amount(account) >= 1000;

  if (!open) {
    return (
      <button className={buttonClasses("secondary", "sm")} onClick={() => setOpen(true)}>
        <Plus className="size-3.5" />
        Periodisera manuellt
      </button>
    );
  }

  return (
    <Card className="p-5">
      <h3 className="text-[15px] font-semibold text-ink">Periodisera manuellt</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-soft">
        För poster som saknar bokfört underlag. Driva bokar upp beloppet vid årsskiftet och löser upp det i takt med
        perioden.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelCls}>Typ</label>
          <div className="grid gap-2 sm:grid-cols-2">
            {ACCRUAL_KINDS.map((k) => (
              <label
                key={k.kind}
                className={cx(
                  "flex cursor-pointer items-start gap-2 rounded-xl border p-3",
                  kind === k.kind ? "border-accent bg-accent-soft" : "border-line bg-card"
                )}
              >
                <input
                  type="radio"
                  name="accrual-kind"
                  className="mt-0.5 size-4 accent-[var(--accent)]"
                  checked={kind === k.kind}
                  onChange={() => setKind(k.kind)}
                />
                <span>
                  <span className="block text-[14px] font-medium text-ink">{k.label}</span>
                  <span className="block text-[12px] text-soft">{k.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="accrual-description">
            Vad gäller det?
          </label>
          <input
            id="accrual-description"
            className={fieldCls}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Revisionsarvode 2026"
          />
        </div>

        <div>
          <label className={labelCls} htmlFor="accrual-total">
            Belopp exklusive moms
          </label>
          <input
            id="accrual-total"
            className={fieldCls}
            inputMode="numeric"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            placeholder="0"
          />
        </div>

        <div>
          <label className={labelCls} htmlFor="accrual-account">
            Motkonto
          </label>
          <input
            id="accrual-account"
            className={fieldCls}
            inputMode="numeric"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder="6420"
          />
          <p className="mt-1 text-[12px] text-soft">{chosen.counterHint}</p>
        </div>

        <div>
          <label className={labelCls} htmlFor="accrual-from">
            Perioden börjar
          </label>
          <DateField id="accrual-from" value={fromDate} onChange={setFromDate} />
        </div>

        <div>
          <label className={labelCls} htmlFor="accrual-to">
            Perioden slutar
          </label>
          <DateField id="accrual-to" value={toDate} onChange={setToDate} />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          className={buttonClasses("primary", "sm")}
          disabled={!valid || pending}
          onClick={() =>
            startTransition(async () => {
              const res = await planManualAccrualAction({
                kind,
                description: description.trim(),
                totalAmount: amount(total),
                counterAccount: amount(account),
                fromDate,
                toDate,
                fiscalYearId,
              });
              if (res.ok) {
                setOpen(false);
                setDescription("");
                setTotal("");
                setAccount("");
                setError(null);
                router.refresh();
              } else setError(res.error);
            })
          }
        >
          <Calculator className="size-3.5" />
          {pending ? "Bokför …" : "Bokför periodiseringen"}
        </button>
        <button className={buttonClasses("ghost", "sm")} onClick={() => setOpen(false)}>
          Avbryt
        </button>
      </div>
      <ErrorNote error={error} />
    </Card>
  );
}
