import { db, save } from "../store";
import { bokforingsdatum, monthsOf, todayDate, vatPeriodsOf, type Period } from "./dates";
import { fiscalYears, lockPeriod, lockedThrough, vatPeriodicity } from "./fiscal";
import { bankReconciliationAt } from "./reconciliation";
import { currentEmployee, employerDeclarations, payrollRuns } from "./payroll";
import { logAudit } from "./audit";

/**
 * Periodstängning: månadsavstämningen som ett flöde, inte bara en filtertyp.
 *
 * Att stänga en månad är att säga "den här månaden är färdig" och sedan låsa
 * den. Låset finns redan i motorn och flyttas automatiskt när en momsperiod
 * deklareras eller en arbetsgivardeklaration lämnas – men allt däremellan står
 * öppet, och för en klient med helårsmoms står hela året öppet. Då kan en
 * händelse i januari ändras i november utan att någon märker det, och en
 * avstämning som gjordes i februari betyder ingenting längre.
 *
 * Kontrollerna är avsiktligt desamma som bokslutets, fast per månad: banken,
 * underlagen, momsen och lönen. En månad som klarar dem är inte "nästan klar",
 * den är klar, och då är låset ett konstaterande snarare än ett löfte.
 *
 * Det som INTE kontrolleras är lika medvetet: kundfordringarnas värde och
 * periodiseringar hör till bokslutet, inte till en månad. Att kräva dem här
 * vore att göra tolv bokslut om året.
 */

export interface PeriodCheckItem {
  key: string;
  /**
   * Kravet, inte ett påstående om att det är uppfyllt. "Banken avstämd" läser
   * rätt både med bock och med varningstriangel; "Banken är avstämd" intill en
   * varning om tre ohanterade transaktioner motsäger sig själv.
   */
  label: string;
  ok: boolean;
  /** Blockerar stängning (annars bara upplysning). */
  blocking: boolean;
  detail?: string;
  href?: string;
  /** Länketikett som namnger destinationen – aldrig vaga "Åtgärda". */
  hrefLabel?: string;
}

export type PeriodCloseState = "kommande" | "pagaende" | "att_stanga" | "stangd";

export interface PeriodCloseStatus {
  period: Period;
  state: PeriodCloseState;
  checks: PeriodCheckItem[];
  blockers: PeriodCheckItem[];
  /** Verifikationer med bokföringsdatum i månaden. */
  verifications: number;
  /**
   * Månaden avslutar en momsperiod. Då är stängningen inte bara städning: efter
   * låset går momsunderlaget inte längre att rätta.
   */
  endsVatPeriod: boolean;
}

export class PeriodCloseError extends Error {}

/** Månaderna i alla öppna räkenskapsår, äldst först. */
export function closableMonths(): Period[] {
  return fiscalYears()
    .filter((f) => f.status === "oppet")
    .flatMap((f) => monthsOf(f));
}

function monthState(period: Period, today: string, lock: string | undefined): PeriodCloseState {
  if (lock && period.end <= lock) return "stangd";
  if (period.start > today) return "kommande";
  if (period.end >= today) return "pagaende";
  return "att_stanga";
}

/**
 * Månaderna som väntar på stängning: avslutade, olåsta och i ordning. Ordningen
 * är inte kosmetisk – låset är ett enda vattenmärke, så mars kan inte stängas
 * medan februari står öppen.
 */
export function monthsAwaitingClose(today: string = todayDate()): Period[] {
  const lock = lockedThrough();
  return closableMonths().filter((p) => monthState(p, today, lock) === "att_stanga");
}

/** Nästa månad att stänga, alltså den äldsta olåsta avslutade månaden. */
export function nextMonthToClose(today: string = todayDate()): PeriodCloseStatus | undefined {
  const first = monthsAwaitingClose(today)[0];
  return first ? periodCloseStatus(first, today) : undefined;
}

export function periodCloseStatus(period: Period, today: string = todayDate()): PeriodCloseStatus {
  const data = db();
  const lock = lockedThrough();
  const state = monthState(period, today, lock);
  const inPeriod = (date: string) => {
    const d = bokforingsdatum(date);
    return d >= period.start && d <= period.end;
  };

  const recon = bankReconciliationAt(period.end);
  const unbookedBank = data.bankTransactions.filter((t) => t.status !== "bokford" && inPeriod(t.date));
  const openExpenses = data.expenses.filter((e) => e.status !== "bokford" && inPeriod(e.date));
  const openInbox = (data.inboxItems ?? []).filter((i) => i.status === "ny" && bokforingsdatum(i.createdAt) <= period.end);
  const unbookedSupplier = data.supplierInvoices.filter(
    (s) => s.accountingStatus !== "bokford" && inPeriod(s.date)
  );
  const draftInvoices = data.invoices.filter((i) => i.status === "utkast" && inPeriod(i.issueDate));
  const verifications = data.verifications.filter((v) => inPeriod(v.date)).length;

  // Momsperioden som slutar samma dag som månaden – bara då är momsen ett krav
  // för att stänga, för dess underlag går inte att rätta efter låset.
  const fy = fiscalYears().find((f) => f.startDate <= period.start && period.end <= f.endDate);
  const vatPeriod = fy ? vatPeriodsOf(fy, vatPeriodicity()).find((p) => p.end === period.end) : undefined;
  const vatReport = vatPeriod
    ? data.vatReports.find((r) => r.periodStart === vatPeriod.start && r.periodEnd === vatPeriod.end)
    : undefined;

  const employee = currentEmployee();
  const employedInMonth =
    employee != null &&
    employee.startDate.slice(0, 7) <= period.key &&
    (!employee.endDate || employee.endDate.slice(0, 7) >= period.key);
  const payrollBooked = payrollRuns().some((r) => r.month === period.key);
  const declaration = employerDeclarations().find((d) => d.month === period.key);

  const checks: PeriodCheckItem[] = [
    {
      key: "manaden_slut",
      label: "Månaden avslutad",
      ok: state === "att_stanga" || state === "stangd",
      blocking: true,
      detail:
        state === "kommande"
          ? `Månaden börjar ${period.start}.`
          : state === "pagaende"
            ? `Månaden pågår till ${period.end}. Stängningen görs efter att den är slut.`
            : `Månaden avslutades ${period.end}.`,
    },
    {
      key: "bank",
      label: "Banken avstämd",
      ok: unbookedBank.length === 0 && recon.unexplained === 0,
      blocking: true,
      detail:
        unbookedBank.length > 0
          ? `${unbookedBank.length} banktransaktion${unbookedBank.length > 1 ? "er" : ""} i ${period.label} behöver hanteras.`
          : recon.unexplained !== 0
            ? `${Math.abs(recon.unexplained)} kr skiljer mellan banken och bokföringen den ${period.end} utan förklaring.`
            : "Kontot stämmer mot bokföringen vid månadens slut.",
      href: "/ekonomi?flik=bank",
      hrefLabel: "Öppna banken",
    },
    {
      key: "underlag",
      label: "Alla köp bokförda med underlag",
      ok: openExpenses.length === 0 && openInbox.length === 0 && unbookedSupplier.length === 0,
      blocking: true,
      detail:
        openExpenses.length + openInbox.length + unbookedSupplier.length > 0
          ? [
              openExpenses.length > 0 ? `${openExpenses.length} köp saknar kvitto eller svar` : null,
              unbookedSupplier.length > 0 ? `${unbookedSupplier.length} leverantörsfaktura är inte bokförd` : null,
              openInbox.length > 0 ? `${openInbox.length} dokument ligger ogranskat i inboxen` : null,
            ]
              .filter(Boolean)
              .join(", ") + "."
          : "Inga underlag väntar.",
      href: "/bokforing",
      hrefLabel: "Öppna bokföringen",
    },
    {
      key: "fakturor",
      label: "Kundfakturorna utfärdade",
      ok: draftInvoices.length === 0,
      blocking: false,
      detail: draftInvoices.length
        ? `${draftInvoices.length} fakturautkast är daterade i ${period.label} men inte utfärdade – utfärda eller kasta dem.`
        : "Utfärdade fakturor bokförs automatiskt.",
      href: "/ekonomi?flik=fakturor",
      hrefLabel: "Visa fakturorna",
    },
  ];

  if (employedInMonth) {
    checks.push({
      key: "lon",
      label: "Lönen bokförd och deklarerad",
      ok: payrollBooked && declaration?.status === "deklarerad",
      blocking: true,
      detail: !payrollBooked
        ? `Lönen för ${period.label} är inte bokförd.`
        : declaration?.status !== "deklarerad"
          ? `Arbetsgivardeklarationen för ${period.label} är inte lämnad.`
          : "Lön och arbetsgivardeklaration är klara.",
      href: "/bokforing/lon",
      hrefLabel: "Öppna lönen",
    });
  }

  if (vatPeriod) {
    checks.push({
      key: "moms",
      label: `Momsen för ${vatPeriod.label} deklarerad`,
      ok: vatReport?.status === "deklarerad",
      blocking: true,
      detail:
        vatReport?.status === "deklarerad"
          ? "Perioden är deklarerad, så underlaget är avslutat."
          : `${period.label} avslutar momsperioden. Efter låset går underlaget inte att rätta, så momsen deklareras först.`,
      href: "/bokforing/moms",
      hrefLabel: "Öppna momsöversikten",
    });
  }

  return {
    period,
    state,
    checks,
    blockers: checks.filter((c) => c.blocking && !c.ok),
    verifications,
    endsVatPeriod: vatPeriod != null,
  };
}

/**
 * Stäng en månad: lås bokföringen till och med månadens sista dag.
 *
 * Låset är monotont och kan bara backas genom en återöppning av räkenskapsåret,
 * så stängningen är en riktig händelse och inte en flagga att växla. Därför
 * körs kontrollerna om här – knappen kan ha varit klickbar i en flik som stått
 * öppen sedan i morse.
 */
export function closePeriod(
  periodKey: string,
  actor: "anvandare" | "assistent" | "system" = "anvandare"
): PeriodCloseStatus {
  const period = closableMonths().find((p) => p.key === periodKey);
  if (!period) throw new PeriodCloseError(`Perioden ${periodKey} hör inte till ett öppet räkenskapsår.`);
  const status = periodCloseStatus(period);
  if (status.state === "stangd") throw new PeriodCloseError(`${period.label} är redan stängd.`);
  if (status.state !== "att_stanga") {
    throw new PeriodCloseError(`${period.label} är inte slut ännu. En period stängs efter att den är avslutad.`);
  }
  const earlier = monthsAwaitingClose().filter((p) => p.end < period.end);
  if (earlier.length > 0) {
    throw new PeriodCloseError(
      `${earlier[0].label} måste stängas först. Periodlåset är ett enda datum, så månaderna stängs i ordning.`
    );
  }
  if (status.blockers.length > 0) {
    throw new PeriodCloseError(
      `${period.label} kan inte stängas ännu: ${status.blockers.map((b) => b.detail ?? b.label).join(" ")}`
    );
  }

  lockPeriod(period.end, actor);
  logAudit(
    actor,
    "period_stangd",
    `${period.label} stängdes. ${status.verifications} verifikation${status.verifications === 1 ? "" : "er"} i månaden, bokföringen är låst till och med ${period.end}.`,
    { targetType: "period", targetId: period.key }
  );
  save();
  return periodCloseStatus(period);
}
