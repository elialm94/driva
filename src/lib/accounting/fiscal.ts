import { db, save } from "../store";
import type { DB, FiscalYear } from "../types";
import { logAudit } from "./audit";
import {
  bokforingsdatum,
  fiscalYearFollowing,
  fiscalYearLabel,
  fiscalYearToExtend,
  isIsoDate,
  isVatPeriodicity,
  nextDay,
  todayDate,
  vatPeriodsOf,
  yearsToCoverDate,
  type Period,
  type VatPeriodicity,
} from "./dates";

export {
  bokforingsdatum,
  calendarFiscalYear,
  fiscalYearFollowing,
  fiscalYearLabel,
  fiscalYearPreceding,
  fiscalYearToExtend,
  fullYearOf,
  makeFiscalYear,
  monthsOf,
  quartersOf,
  taxYearOf,
  todayDate,
  vatDueDate,
  vatPeriodsOf,
  VAT_PERIODICITY,
  type Period,
  type VatPeriodicity,
} from "./dates";

/**
 * Räkenskapsår och periodlås.
 *
 * Default är kalenderår (1 jan–31 dec), skapat utan setup-wizard. Företaget
 * kan byta till ett brutet år i Inställningar → Företag. Nästa år följer
 * samma mönster. Månader och kvartal härleds ur årets start/slut.
 *
 * Periodlås: `db().accounting.lockedThrough` (YYYY-MM-DD). Allt till och med
 * det datumet är låst – inga nya verifikationer får bokföringsdatum där och
 * inget får ändras. Rättelser bokförs i öppen period.
 */

export function fiscalYears(data: DB = db()): FiscalYear[] {
  return [...data.fiscalYears].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export function getFiscalYear(id: string): FiscalYear | undefined {
  return db().fiscalYears.find((f) => f.id === id);
}

/** Räkenskapsåret som innehåller datumet (YYYY-MM-DD eller ISO). */
export function fiscalYearFor(date: string, data: DB = db()): FiscalYear | undefined {
  const d = date.length > 10 ? bokforingsdatum(date) : date;
  return data.fiscalYears.find((f) => f.startDate <= d && d <= f.endDate);
}

/**
 * Hämta eller skapa räkenskapsåret för ett datum. Utan befintliga år skapas
 * ett kalenderår. Finns redan år följs deras mönster (brutet år ger brutet år).
 * Nya år får IB från föregående års UB först när det året stängs.
 */
export function ensureFiscalYearFor(date: string, actor: "anvandare" | "assistent" | "system" = "system"): FiscalYear {
  const data = db();
  const d = date.length > 10 ? bokforingsdatum(date) : date;
  const existing = fiscalYearFor(d, data);
  if (existing) return existing;
  const created = yearsToCoverDate(data.fiscalYears, d);
  for (const fy of created) {
    data.fiscalYears.push(fy);
    logAudit(actor, "rakenskapsar_skapat", `Räkenskapsåret ${fy.label} skapades automatiskt.`, {
      targetType: "rakenskapsar",
      targetId: fy.id,
    });
  }
  const found = fiscalYearFor(d, data);
  if (!found) throw new Error(`Kunde inte skapa räkenskapsår för ${d}.`);
  return found;
}

/** Det räkenskapsår som "pågår nu" (skapas vid behov). */
export function currentFiscalYear(): FiscalYear {
  return ensureFiscalYearFor(todayDate());
}

/** År som vyerna ska visa: query-param `ar` (label eller id), annars innevarande. */
export function resolveViewFiscalYear(param?: string | null): FiscalYear {
  if (param) {
    const found = fiscalYears().find((f) => f.id === param || f.label === param);
    if (found) return found;
  }
  return currentFiscalYear();
}

export function findFiscalYearByParam(param: string | null | undefined, data: DB = db()): FiscalYear | undefined {
  if (!param) return undefined;
  return fiscalYears(data).find((f) => f.id === param || f.label === param);
}

/** Datum att visa balans för: idag om året pågår, annars årets slut (eller start om det inte börjat). */
export function fiscalYearAsOf(fy: FiscalYear, today: string = todayDate()): string {
  if (today < fy.startDate) return fy.startDate;
  if (today > fy.endDate) return fy.endDate;
  return today;
}

/** Året som kommer efter `fy`, om det redan finns. */
export function fiscalYearAfter(fy: FiscalYear, data: DB = db()): FiscalYear | undefined {
  const start = nextDay(fy.endDate);
  return data.fiscalYears.find((f) => f.startDate === start);
}

export class FiscalYearError extends Error {}

/**
 * Ändra start och slut för ett öppet år. Verifikationernas bokföringsdatum
 * rörs inte – perioden är ett filter, inte en omskrivning.
 */
export function updateFiscalYearPeriod(
  fiscalYearId: string,
  startDate: string,
  endDate: string,
  actor: "anvandare" | "assistent" | "system" = "anvandare"
): FiscalYear {
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) throw new FiscalYearError("Räkenskapsåret finns inte.");
  if (fy.status === "stangt") throw new FiscalYearError("Ett stängt räkenskapsår kan inte ändras.");
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    throw new FiscalYearError("Ange start- och slutdatum.");
  }
  if (endDate <= startDate) throw new FiscalYearError("Slutdatum måste vara efter startdatum.");
  const previous = `${fy.startDate}–${fy.endDate}`;
  fy.startDate = startDate;
  fy.endDate = endDate;
  fy.label = fiscalYearLabel(startDate, endDate);
  logAudit(actor, "rakenskapsar_andrat", `Räkenskapsåret ändrades från ${previous} till ${startDate}–${endDate}.`, {
    targetType: "rakenskapsar",
    targetId: fy.id,
  });
  save();
  return fy;
}

/** Skapa nästa räkenskapsår efter innevarande (eller det som just tagit slut). */
export function createNextFiscalYear(actor: "anvandare" | "assistent" | "system" = "anvandare"): FiscalYear {
  const data = db();
  const years = fiscalYears(data);
  if (years.length === 0) {
    const fy = ensureFiscalYearFor(todayDate(), actor);
    save();
    return fy;
  }
  const base = fiscalYearToExtend(years, todayDate()) ?? years[years.length - 1];
  const existing = fiscalYearAfter(base, data);
  if (existing) return existing;
  const next = fiscalYearFollowing(base);
  data.fiscalYears.push(next);
  logAudit(actor, "rakenskapsar_skapat", `Räkenskapsåret ${next.label} skapades (${next.startDate}–${next.endDate}).`, {
    targetType: "rakenskapsar",
    targetId: next.id,
  });
  save();
  return next;
}

export function lockedThrough(): string | undefined {
  return db().accounting.lockedThrough;
}

export function isDateLocked(date: string): boolean {
  const d = date.length > 10 ? bokforingsdatum(date) : date;
  const lock = db().accounting.lockedThrough;
  if (lock && d <= lock) return true;
  const fy = fiscalYearFor(d);
  return fy?.status === "stangt";
}

/**
 * Första öppna bokföringsdatum för en händelse. Om händelsedatumet ligger i
 * låst period flyttas bokföringsdatumet fram till första öppna dag – händelsen
 * i sig ändras aldrig.
 */
export function clampToOpenDate(date: string): { date: string; adjusted: boolean; originalDate: string } {
  const d = date.length > 10 ? bokforingsdatum(date) : date;
  if (!isDateLocked(d)) return { date: d, adjusted: false, originalDate: d };
  const lock = db().accounting.lockedThrough;
  let candidate = lock && lock >= d ? nextDay(lock) : d;
  // Hoppa förbi stängda räkenskapsår.
  for (let i = 0; i < 12; i++) {
    const fy = fiscalYearFor(candidate);
    if (!fy || fy.status !== "stangt") break;
    candidate = nextDay(fy.endDate);
  }
  return { date: candidate, adjusted: true, originalDate: d };
}

/** Lås bokföringen till och med ett datum. Kan aldrig backas till ett tidigare datum. */
export function lockPeriod(throughDate: string, actor: "anvandare" | "assistent" | "system"): void {
  const data = db();
  const d = throughDate.length > 10 ? bokforingsdatum(throughDate) : throughDate;
  const current = data.accounting.lockedThrough;
  if (current && d <= current) return;
  data.accounting.lockedThrough = d;
  logAudit(actor, "period_last", `Bokföringen låstes till och med ${d}.`);
  save();
}

/**
 * Flytta periodlåset bakåt. Enda vägen bakåt, och den finns bara för
 * återöppning av ett räkenskapsår (se accounting/close.ts): ett år som är
 * öppet men låst går inte att rätta, och då vore återöppningen bara på papperet.
 *
 * Låset är ett enda vattenmärke, så en återöppning av 2025 låser också upp
 * början av 2026. Det är inte gratis, men det är inte heller farligt: en
 * deklarerad momsperiod och en lämnad arbetsgivardeklaration vaktas av sin egen
 * status, inte av låset. Ursprungslåset sparas på återöppningen och sätts
 * tillbaka när året stängs igen.
 */
export function unlockPeriodThrough(
  throughDate: string | undefined,
  actor: "anvandare" | "assistent" | "system",
  reason: string
): void {
  const data = db();
  const current = data.accounting.lockedThrough;
  const d = throughDate && throughDate.length > 10 ? bokforingsdatum(throughDate) : throughDate;
  if (current === d) return;
  if (d) data.accounting.lockedThrough = d;
  else delete data.accounting.lockedThrough;
  logAudit(
    actor,
    "period_upplast",
    d
      ? `Periodlåset flyttades bakåt från ${current ?? "inget lås"} till ${d}. ${reason}`
      : `Periodlåset togs bort (var ${current ?? "inget lås"}). ${reason}`
  );
  save();
}

/**
 * Företagets momsperiodicitet. Speglar registreringen hos Skatteverket och är
 * ett val – kvartal är huvudregeln för ett litet aktiebolag och därför default.
 */
export function vatPeriodicity(data: DB = db()): VatPeriodicity {
  const chosen = data.settings.vatPeriodicity;
  return isVatPeriodicity(chosen) ? chosen : "kvartal";
}

/** Momsperioden som innehåller datumet, enligt företagets periodicitet. */
export function vatPeriodFor(date: string): Period {
  const d = date.length > 10 ? bokforingsdatum(date) : date;
  const fy = ensureFiscalYearFor(d);
  const p = vatPeriodsOf(fy, vatPeriodicity()).find((x) => x.start <= d && d <= x.end);
  if (!p) throw new Error(`Ingen momsperiod för ${d}`);
  return p;
}
