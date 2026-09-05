import { db, save } from "../store";
import { uid } from "../ids";
import type {
  FiscalYear,
  Invoice,
  Verification,
  YearEndSchedule,
  YearEndScheduleInputs,
  YearEndScheduleKind,
  YearEndScheduleLine,
} from "../types";
import { logAudit } from "./audit";
import { postVerification } from "./engine";
import { getFiscalYear, todayDate } from "./fiscal";
import { accountBalance } from "./ledger";
import { contributionRateFor } from "./payroll-model";
import { birthDateOf, currentEmployee } from "./payroll";
import { computeTaxCalculation } from "./tax";
import { invoiceOutstanding, invoiceTotals, isOpenReceivable } from "../services/data";
import { bokforingsdatum } from "./dates";
import {
  ATERFORING_PERIODISERINGSFOND,
  AVSATTNING_PERIODISERINGSFOND,
  BEFARADE_KUNDFORLUSTER,
  DOUBTFUL_AFTER_DAYS,
  NEDSKRIVNING_KUNDFORDRINGAR,
  PERIODISERINGSFOND,
  PERIODISERINGSFOND_MAX_ANDEL,
  PERIODISERINGSFOND_MAX_AR,
  SCHEDULE_LABEL,
  SEMESTERLONESKULD,
  SEMESTERLONESKULD_KOSTNAD,
  SOCIALA_AVGIFTER_SKULD_KOSTNAD,
  UPPLUPNA_SOCIALA_AVGIFTER,
  vacationDayValue,
} from "./year-end-model";

/**
 * Bokslutsbilagor: specifikationen bakom ett balanskonto.
 *
 * Saldot på 2920 är ett tal. Bilagan är svaret på frågan revisorn ställer –
 * VAD består talet av? Tre bilagor kräver en uppgift som inte finns i
 * bokföringen och som Driva därför inte får gissa:
 *
 *   semesterloneskuld              antal sparade betalda semesterdagar
 *   kundfordringar_nedskrivning    bedömningen av vilka fordringar som är osäkra
 *   periodiseringsfond             hur stor avsättning bolaget VILL göra
 *
 * Resten räknas ur bokföringen. Bilagan bokförs som en justering mot vad
 * kontot redan visar, aldrig som ett nytt totalbelopp – annars skulle andra
 * årets bilaga dubbla första årets skuld.
 */

export {
  ATERFORING_PERIODISERINGSFOND,
  AVSATTNING_PERIODISERINGSFOND,
  BEFARADE_KUNDFORLUSTER,
  DOUBTFUL_AFTER_DAYS,
  NEDSKRIVNING_KUNDFORDRINGAR,
  PERIODISERINGSFOND,
  PERIODISERINGSFOND_MAX_ANDEL,
  PERIODISERINGSFOND_MAX_AR,
  SCHEDULE_LABEL,
  SCHEDULE_PURPOSE,
  SEMESTERDAGAR_PER_AR,
  SEMESTERLON_PER_DAG_PROCENT,
  SEMESTERLONESKULD,
  SEMESTERLONESKULD_KOSTNAD,
  SEMESTERTILLAGG_PER_DAG_PROCENT,
  SOCIALA_AVGIFTER_SKULD_KOSTNAD,
  UPPLUPNA_SOCIALA_AVGIFTER,
  vacationDayValue,
  type VacationDayValue,
} from "./year-end-model";

/**
 * Balanskontona varje bilaga specificerar. Avstämningen frågar den här
 * tabellen, så en ny bilaga blir avstämd utan följdändringar.
 */
export const SCHEDULE_ACCOUNTS: Record<YearEndScheduleKind, number[]> = {
  semesterloneskuld: [SEMESTERLONESKULD, UPPLUPNA_SOCIALA_AVGIFTER],
  kundfordringar_nedskrivning: [NEDSKRIVNING_KUNDFORDRINGAR],
  periodiseringsfond: [PERIODISERINGSFOND],
};

/* --------------------------------- Register -------------------------------- */

export function yearEndSchedules(fiscalYearId?: string): YearEndSchedule[] {
  const all = db().yearEndSchedules ?? [];
  return fiscalYearId ? all.filter((s) => s.fiscalYearId === fiscalYearId) : all;
}

export function yearEndScheduleFor(fiscalYearId: string, kind: YearEndScheduleKind): YearEndSchedule | undefined {
  return yearEndSchedules(fiscalYearId).find((s) => s.kind === kind);
}

export function yearEndScheduleById(id: string): YearEndSchedule | undefined {
  return yearEndSchedules().find((s) => s.id === id);
}

/* -------------------------------- Beräkning -------------------------------- */

export interface ScheduleDraft {
  kind: YearEndScheduleKind;
  closingAmount: number;
  lines: YearEndScheduleLine[];
  inputs: YearEndScheduleInputs;
  /** Vad kontot redan visar. Justeringen är skillnaden. */
  bookedAmount: number;
  change: number;
  /** Sociala avgifter på skulden, för semesterlöneskulden. */
  contribution?: { closingAmount: number; bookedAmount: number; change: number; percent: number };
  /** Varför bilagan ser ut som den gör – visas för användaren. */
  explanation: string;
  /** Hinder användaren måste rätta innan bilagan kan bokföras. */
  errors: string[];
}

/**
 * Semesterlöneskulden vid årets slut. Antalet sparade dagar kan inte härledas
 * ur bokföringen – Driva vet vilken lön som betalats, inte vilka dagar som
 * tagits ut – så det är en uppgift användaren anger.
 */
export function vacationLiabilityDraft(fiscalYearId: string, savedDays: number): ScheduleDraft {
  const fy = requireYear(fiscalYearId);
  const employee = currentEmployee();
  const errors: string[] = [];
  if (!Number.isFinite(savedDays) || savedDays < 0) errors.push("Antalet sparade semesterdagar kan inte vara negativt.");
  if (!employee) errors.push("Ingen anställd är upplagd – utan lön finns ingen semesterlöneskuld.");

  const days = Math.max(0, Math.round(savedDays));
  const monthlySalary = employee?.monthlySalary ?? 0;
  const value = vacationDayValue(monthlySalary);
  const closingAmount = days * value.perDay;

  let percent = 0;
  if (employee) {
    try {
      percent = contributionRateFor(birthDateOf(employee), Number(fy.label)).percent;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  const contributionClosing = Math.round((closingAmount * percent) / 100);

  const lines: YearEndScheduleLine[] = [
    {
      label: `${days} sparade betalda semesterdagar`,
      amount: closingAmount,
      note: `${days} dagar × ${value.perDay} kr (semesterlön ${value.semesterlon} kr + semestertillägg ${value.tillagg} kr per dag, räknat på månadslönen ${monthlySalary} kr).`,
    },
    {
      label: `Sociala avgifter ${fmtPercent(percent)} %`,
      amount: contributionClosing,
      note: "Arbetsgivaravgifter betalas när semesterlönen betalas ut, så skulden bär dem redan nu.",
    },
  ];

  return {
    kind: "semesterloneskuld",
    closingAmount,
    lines,
    inputs: { savedVacationDays: days },
    bookedAmount: liabilityBalance(SEMESTERLONESKULD, fy),
    change: closingAmount - liabilityBalance(SEMESTERLONESKULD, fy),
    contribution: {
      closingAmount: contributionClosing,
      bookedAmount: liabilityBalance(UPPLUPNA_SOCIALA_AVGIFTER, fy),
      change: contributionClosing - liabilityBalance(UPPLUPNA_SOCIALA_AVGIFTER, fy),
      percent,
    },
    explanation:
      `${days} sparade dagar × ${value.perDay} kr = ${closingAmount} kr, plus ${contributionClosing} kr sociala avgifter. ` +
      `Bara förändringen mot vad kontot redan visar bokförs.`,
    errors,
  };
}

/**
 * Osäkra kundfordringar. Bedömningen är användarens – att en faktura är
 * förfallen betyder inte att den är förlorad – så Driva föreslår men avgör
 * aldrig. Beloppet skrivs ned exklusive moms: momsen justeras först när
 * förlusten är konstaterad, inte när den är befarad.
 */
export function doubtfulReceivablesDraft(fiscalYearId: string, invoiceIds: string[]): ScheduleDraft {
  const fy = requireYear(fiscalYearId);
  const errors: string[] = [];
  const lines: YearEndScheduleLine[] = [];
  let closingAmount = 0;
  const chosen: string[] = [];

  for (const id of invoiceIds) {
    const invoice = db().invoices.find((i) => i.id === id);
    if (!invoice) {
      errors.push(`En vald faktura finns inte längre (${id}).`);
      continue;
    }
    const net = receivableExcludingVat(invoice);
    if (net <= 0) continue;
    chosen.push(id);
    closingAmount += net;
    lines.push({
      label: `Faktura #${invoice.number} – ${customerName(invoice)}`,
      amount: net,
      note: `${invoiceOutstanding(invoice)} kr obetalt, varav ${net} kr exklusive moms. Förfallen ${invoice.dueDate}.`,
    });
  }

  const booked = liabilityBalance(NEDSKRIVNING_KUNDFORDRINGAR, fy);
  return {
    kind: "kundfordringar_nedskrivning",
    closingAmount,
    lines,
    inputs: { doubtfulInvoiceIds: chosen },
    bookedAmount: booked,
    change: closingAmount - booked,
    explanation:
      lines.length === 0
        ? "Ingen kundfordring är bedömd som osäker."
        : `${lines.length} fordring${lines.length > 1 ? "ar" : ""} bedöms som osäker${lines.length > 1 ? "a" : ""}: ${closingAmount} kr exklusive moms. ` +
          "Momsen justeras först när förlusten är konstaterad.",
    errors,
  };
}

/**
 * Periodiseringsfond. Ett aktiebolag får sätta av upp till 25 % av det
 * skattemässiga resultatet före avsättning och skjuta skatten framåt. Varje
 * avsättning ska återföras senast sjätte året efter avsättningsåret.
 *
 * Avsättningen är ett VAL, inte en beräkning: Driva räknar ut taket och
 * återföringarna som måste göras, men beloppet är bolagets beslut.
 */
export interface FundLot {
  year: number;
  amount: number;
  /** Sista räkenskapsår avsättningen får stå kvar. */
  lastYear: number;
}

/** Fonderna per avsättningsår, ur bilagorna – kontot visar bara totalen. */
export function fundLots(throughFiscalYearId: string): FundLot[] {
  const fy = requireYear(throughFiscalYearId);
  const through = Number(fy.label);
  const byYear = new Map<number, number>();
  for (const schedule of yearEndSchedules()) {
    if (schedule.kind !== "periodiseringsfond" || schedule.status !== "bokford") continue;
    const year = Number(getFiscalYear(schedule.fiscalYearId)?.label ?? 0);
    if (!year || year > through) continue;
    const allocation = schedule.inputs.fundAllocation ?? 0;
    if (allocation > 0) byYear.set(year, (byYear.get(year) ?? 0) + allocation);
    for (const reversal of schedule.inputs.fundReversals ?? []) {
      byYear.set(reversal.year, (byYear.get(reversal.year) ?? 0) - reversal.amount);
    }
  }
  return [...byYear.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([year, amount]) => ({ year, amount, lastYear: year + PERIODISERINGSFOND_MAX_AR }))
    .sort((a, b) => a.year - b.year);
}

/** Fonder som MÅSTE återföras i året – sjätte året efter avsättningen har passerat. */
export function fundReversalsDue(fiscalYearId: string): FundLot[] {
  const fy = requireYear(fiscalYearId);
  const year = Number(fy.label);
  return fundLots(fiscalYearId).filter((lot) => lot.lastYear <= year);
}

/** Taket för årets avsättning: 25 % av det skattemässiga resultatet före avsättning. */
export function maxFundAllocation(fiscalYearId: string): number {
  const fy = requireYear(fiscalYearId);
  if ((db().settings.companyForm ?? "ab") !== "ab") return 0;
  const tax = computeTaxCalculation(fy);
  const bookedAllocation = accountMovement(AVSATTNING_PERIODISERINGSFOND, fy);
  const base = tax.skattemassigtResultat + bookedAllocation;
  return base > 0 ? Math.floor((base * PERIODISERINGSFOND_MAX_ANDEL) / 100) * 100 : 0;
}

export function fundDraft(
  fiscalYearId: string,
  input: { allocation: number; reversals: { year: number; amount: number }[] }
): ScheduleDraft {
  const fy = requireYear(fiscalYearId);
  const errors: string[] = [];
  const allocation = Math.max(0, Math.round(input.allocation));
  const max = maxFundAllocation(fiscalYearId);
  if ((db().settings.companyForm ?? "ab") !== "ab") {
    errors.push("Periodiseringsfond fungerar annorlunda för enskild firma och stöds inte i Driva.");
  }
  if (allocation > max) {
    errors.push(`Avsättningen får vara högst ${max} kr – 25 % av det skattemässiga resultatet före avsättning.`);
  }

  const lots = fundLots(fiscalYearId);
  const reversals: { year: number; amount: number }[] = [];
  for (const reversal of input.reversals) {
    const lot = lots.find((l) => l.year === reversal.year);
    const amount = Math.max(0, Math.round(reversal.amount));
    if (amount === 0) continue;
    if (!lot) {
      errors.push(`Det finns ingen periodiseringsfond avsatt ${reversal.year} att återföra.`);
      continue;
    }
    if (amount > lot.amount) {
      errors.push(`Fonden från ${reversal.year} är ${lot.amount} kr – mer än så går inte att återföra.`);
      continue;
    }
    reversals.push({ year: reversal.year, amount });
  }

  const due = fundReversalsDue(fiscalYearId);
  for (const lot of due) {
    const planned = reversals.find((r) => r.year === lot.year)?.amount ?? 0;
    if (planned < lot.amount) {
      errors.push(
        `Fonden från ${lot.year} ska vara återförd senast räkenskapsåret ${lot.lastYear} – återför hela ${lot.amount} kr.`
      );
    }
  }

  const reversalSum = reversals.reduce((s, r) => s + r.amount, 0);
  const booked = liabilityBalance(PERIODISERINGSFOND, fy);
  const closingAmount = booked + allocation - reversalSum;

  const lines: YearEndScheduleLine[] = [];
  for (const lot of lots) {
    const reversed = reversals.find((r) => r.year === lot.year)?.amount ?? 0;
    lines.push({
      label: `Fond avsatt ${lot.year}`,
      amount: lot.amount - reversed,
      note:
        reversed > 0
          ? `${lot.amount} kr avsatt, ${reversed} kr återförs i år. Ska vara återförd senast ${lot.lastYear}.`
          : `Ska vara återförd senast räkenskapsåret ${lot.lastYear}.`,
    });
  }
  if (allocation > 0) {
    lines.push({
      label: `Fond avsatt ${fy.label}`,
      amount: allocation,
      note: `Högst ${max} kr fick sättas av – 25 % av det skattemässiga resultatet före avsättning. Ska vara återförd senast ${Number(fy.label) + PERIODISERINGSFOND_MAX_AR}.`,
    });
  }

  return {
    kind: "periodiseringsfond",
    closingAmount,
    lines,
    inputs: { fundAllocation: allocation, fundReversals: reversals },
    bookedAmount: booked,
    change: closingAmount - booked,
    explanation:
      `${allocation} kr sätts av och ${reversalSum} kr återförs. Fonden skjuter skatten framåt – ` +
      `skatten är inte borta, den betalas det år fonden återförs.`,
    errors,
  };
}

export function scheduleDraft(fiscalYearId: string, kind: YearEndScheduleKind, inputs: YearEndScheduleInputs): ScheduleDraft {
  switch (kind) {
    case "semesterloneskuld":
      return vacationLiabilityDraft(fiscalYearId, inputs.savedVacationDays ?? 0);
    case "kundfordringar_nedskrivning":
      return doubtfulReceivablesDraft(fiscalYearId, inputs.doubtfulInvoiceIds ?? []);
    case "periodiseringsfond":
      return fundDraft(fiscalYearId, {
        allocation: inputs.fundAllocation ?? 0,
        reversals: inputs.fundReversals ?? [],
      });
  }
}

/* -------------------------------- Spara ----------------------------------- */

/**
 * Spara bilagan som utkast. Bilagan räknas alltid om ur bokföringen när den
 * sparas, så ett utkast kan inte visa ett belopp bokföringen inte stöder.
 */
export function saveYearEndSchedule(
  fiscalYearId: string,
  kind: YearEndScheduleKind,
  inputs: YearEndScheduleInputs,
  by: "anvandare" | "assistent"
): YearEndSchedule {
  const fy = requireYear(fiscalYearId);
  if (fy.status === "stangt") throw new Error(`Räkenskapsåret ${fy.label} är stängt.`);
  const draft = scheduleDraft(fiscalYearId, kind, inputs);
  if (draft.errors.length) throw new Error(draft.errors.join(" "));

  const data = db();
  data.yearEndSchedules ??= [];
  const existing = yearEndScheduleFor(fiscalYearId, kind);
  if (existing?.status === "bokford") {
    throw new Error(`${SCHEDULE_LABEL[kind]} är redan bokförd för ${fy.label}. Rätta genom en ny verifikation.`);
  }

  const schedule: YearEndSchedule = existing
    ? Object.assign(existing, { closingAmount: draft.closingAmount, lines: draft.lines, inputs: draft.inputs })
    : {
        id: uid(),
        kind,
        fiscalYearId,
        closingAmount: draft.closingAmount,
        lines: draft.lines,
        inputs: draft.inputs,
        status: "utkast" as const,
        verificationIds: [],
        createdBy: by,
        createdAt: new Date().toISOString(),
      };
  if (!existing) data.yearEndSchedules.push(schedule);

  logAudit(by, "bokslutsbilaga_andrad", `${SCHEDULE_LABEL[kind]} ${fy.label}: ${draft.closingAmount} kr. ${draft.explanation}`, {
    targetType: "bokslutsbilaga",
    targetId: schedule.id,
  });
  save();
  return schedule;
}

/* -------------------------------- Bokföring -------------------------------- */

/**
 * Bokför bilagan. Justeringen är skillnaden mot vad kontot redan visar, så
 * bilagan kan bokföras år efter år utan att skulden växer av sig själv.
 */
export function bookYearEndSchedule(id: string, by: "anvandare" | "assistent"): YearEndSchedule {
  const schedule = yearEndScheduleById(id);
  if (!schedule) throw new Error("Bokslutsbilagan finns inte.");
  if (schedule.status === "bokford") return schedule;
  const fy = requireYear(schedule.fiscalYearId);
  if (fy.status === "stangt") throw new Error(`Räkenskapsåret ${fy.label} är stängt.`);

  const draft = scheduleDraft(schedule.fiscalYearId, schedule.kind, schedule.inputs);
  if (draft.errors.length) throw new Error(draft.errors.join(" "));

  const verifications: Verification[] = [];
  switch (schedule.kind) {
    case "semesterloneskuld": {
      if (draft.change !== 0) {
        verifications.push(
          postLiabilityChange({
            fy,
            schedule,
            change: draft.change,
            liabilityAccount: SEMESTERLONESKULD,
            costAccount: SEMESTERLONESKULD_KOSTNAD,
            description: `Semesterlöneskuld ${fy.label}`,
            explanation: `${draft.explanation} Skulden är intjänad semester som inte tagits ut och hör därför till ${fy.label}, inte till året den betalas.`,
            by,
          })
        );
      }
      const contribution = draft.contribution;
      if (contribution && contribution.change !== 0) {
        verifications.push(
          postLiabilityChange({
            fy,
            schedule,
            change: contribution.change,
            liabilityAccount: UPPLUPNA_SOCIALA_AVGIFTER,
            costAccount: SOCIALA_AVGIFTER_SKULD_KOSTNAD,
            description: `Sociala avgifter på semesterlöneskuld ${fy.label}`,
            explanation: `Arbetsgivaravgifter ${fmtPercent(contribution.percent)} % på semesterlöneskulden. Avgiften betalas när lönen betalas, men kostnaden hör till ${fy.label}.`,
            by,
          })
        );
      }
      break;
    }
    case "kundfordringar_nedskrivning": {
      if (draft.change !== 0) {
        verifications.push(
          postLiabilityChange({
            fy,
            schedule,
            change: draft.change,
            liabilityAccount: NEDSKRIVNING_KUNDFORDRINGAR,
            costAccount: BEFARADE_KUNDFORLUSTER,
            description: `Nedskrivning av kundfordringar ${fy.label}`,
            explanation: `${draft.explanation} Fordran står kvar i bokföringen – nedskrivningen är en bedömning, inte en avskrivning.`,
            by,
          })
        );
      }
      break;
    }
    case "periodiseringsfond": {
      const allocation = schedule.inputs.fundAllocation ?? 0;
      const reversals = schedule.inputs.fundReversals ?? [];
      if (allocation > 0) {
        verifications.push(
          postVerification(
            {
              date: fy.endDate,
              description: `Avsättning till periodiseringsfond ${fy.label}`,
              entries: [
                { account: AVSATTNING_PERIODISERINGSFOND, debit: allocation },
                { account: PERIODISERINGSFOND, credit: allocation },
              ],
              source: { type: "bokslut", id: schedule.id },
              createdBy: by,
              explanation: `${allocation} kr sätts av till periodiseringsfond och sänker årets skatt. Skatten är uppskjuten, inte borta: fonden ska återföras senast räkenskapsåret ${Number(fy.label) + PERIODISERINGSFOND_MAX_AR}.`,
            },
            { bypassPeriodLock: true }
          )
        );
      }
      const reversalSum = reversals.reduce((s, r) => s + r.amount, 0);
      if (reversalSum > 0) {
        verifications.push(
          postVerification(
            {
              date: fy.endDate,
              description: `Återföring från periodiseringsfond ${fy.label}`,
              entries: [
                { account: PERIODISERINGSFOND, debit: reversalSum },
                { account: ATERFORING_PERIODISERINGSFOND, credit: reversalSum },
              ],
              source: { type: "bokslut", id: schedule.id },
              createdBy: by,
              explanation: `${reversals.map((r) => `${r.amount} kr från fonden avsatt ${r.year}`).join(", ")} återförs och beskattas i ${fy.label}.`,
            },
            { bypassPeriodLock: true }
          )
        );
      }
      break;
    }
  }

  schedule.closingAmount = draft.closingAmount;
  schedule.lines = draft.lines;
  schedule.status = "bokford";
  schedule.bookedAt = new Date().toISOString();
  schedule.verificationIds = verifications.map((v) => v.id);

  logAudit(by, "bokslutsbilaga_bokford", `${SCHEDULE_LABEL[schedule.kind]} ${fy.label} bokfördes: ${draft.closingAmount} kr.`, {
    targetType: "bokslutsbilaga",
    targetId: schedule.id,
  });
  save();
  return schedule;
}

function postLiabilityChange(args: {
  fy: FiscalYear;
  schedule: YearEndSchedule;
  change: number;
  liabilityAccount: number;
  costAccount: number;
  description: string;
  explanation: string;
  by: "anvandare" | "assistent";
}): Verification {
  const { change } = args;
  // Ökad skuld: kostnad debet, skuld kredit. Minskad skuld: omvänt.
  const entries =
    change > 0
      ? [
          { account: args.costAccount, debit: change },
          { account: args.liabilityAccount, credit: change },
        ]
      : [
          { account: args.liabilityAccount, debit: -change },
          { account: args.costAccount, credit: -change },
        ];
  return postVerification(
    {
      date: args.fy.endDate,
      description: args.description,
      entries,
      source: { type: "bokslut", id: args.schedule.id },
      createdBy: args.by,
      explanation: args.explanation,
    },
    { bypassPeriodLock: true }
  );
}

/* -------------------------------- Förslag ---------------------------------- */

export interface DoubtfulSuggestion {
  invoice: Invoice;
  daysOverdue: number;
  amountExcludingVat: number;
}

/**
 * Förfallna fordringar som är gamla nog att behöva en bedömning. Ett förslag –
 * att en faktura är sen betyder inte att pengarna är förlorade.
 */
export function doubtfulSuggestions(fiscalYearId: string, today: string = todayDate()): DoubtfulSuggestion[] {
  const fy = requireYear(fiscalYearId);
  const out: DoubtfulSuggestion[] = [];
  for (const invoice of db().invoices) {
    if (!isOpenReceivable(invoice)) continue;
    if (bokforingsdatum(invoice.issueDate) > fy.endDate) continue;
    const days = daysBetween(invoice.dueDate, today);
    if (days < DOUBTFUL_AFTER_DAYS) continue;
    const net = receivableExcludingVat(invoice);
    if (net <= 0) continue;
    out.push({ invoice, daysOverdue: days, amountExcludingVat: net });
  }
  return out.sort((a, b) => b.daysOverdue - a.daysOverdue);
}

/** Bilagor som året behöver men som inte är bokförda. */
export function schedulesAwaitingBooking(fiscalYearId: string): { kind: YearEndScheduleKind; reason: string }[] {
  const out: { kind: YearEndScheduleKind; reason: string }[] = [];
  const vacation = yearEndScheduleFor(fiscalYearId, "semesterloneskuld");
  if (currentEmployee() && vacation?.status !== "bokford") {
    out.push({
      kind: "semesterloneskuld",
      reason: vacation
        ? "Bilagan är ett utkast och behöver bokföras."
        : "Bolaget har lön, så intjänad men inte uttagen semester är en skuld som ska med i bokslutet.",
    });
  }
  const doubtful = yearEndScheduleFor(fiscalYearId, "kundfordringar_nedskrivning");
  if (doubtful && doubtful.status !== "bokford") {
    out.push({ kind: "kundfordringar_nedskrivning", reason: "Bilagan är ett utkast och behöver bokföras." });
  }
  const fund = yearEndScheduleFor(fiscalYearId, "periodiseringsfond");
  if (fund && fund.status !== "bokford") {
    out.push({ kind: "periodiseringsfond", reason: "Bilagan är ett utkast och behöver bokföras." });
  } else if (!fund && fundReversalsDue(fiscalYearId).length > 0) {
    out.push({
      kind: "periodiseringsfond",
      reason: "En periodiseringsfond har nått sjätte året och måste återföras.",
    });
  }
  return out;
}

/* -------------------------------- Hjälpare -------------------------------- */

function requireYear(fiscalYearId: string): FiscalYear {
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) throw new Error("Räkenskapsåret finns inte.");
  return fy;
}

/**
 * Skuldkontots saldo som ett POSITIVT tal. Huvudboken räknar debet minus
 * kredit, så en skuld är negativ där – bilagorna talar om skulden som ett
 * belopp och vänder därför tecknet.
 */
function liabilityBalance(account: number, fy: FiscalYear): number {
  return -accountBalance(account, fy.endDate);
}

/** Årets rörelse på ett konto (debet minus kredit), utan ingående balans. */
function accountMovement(account: number, fy: FiscalYear): number {
  let sum = 0;
  for (const v of db().verifications) {
    const d = bokforingsdatum(v.date);
    if (d < fy.startDate || d > fy.endDate) continue;
    for (const e of v.entries) {
      if (e.account === account) sum += e.debit - e.credit;
    }
  }
  return sum;
}

/** Obetald del av fordran exklusive moms – befarad förlust skrivs ned utan moms. */
function receivableExcludingVat(invoice: Invoice): number {
  const outstanding = invoiceOutstanding(invoice);
  if (outstanding <= 0) return 0;
  const totals = invoiceTotals(invoice);
  if (totals.total <= 0) return 0;
  return Math.round((outstanding * totals.subtotal) / totals.total);
}

function customerName(invoice: Invoice): string {
  return db().customers.find((c) => c.id === invoice.customerId)?.name ?? "Okänd kund";
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T12:00:00Z`) - Date.parse(`${fromDate}T12:00:00Z`)) / 86_400_000);
}

function fmtPercent(p: number): string {
  return String(p).replace(".", ",");
}
