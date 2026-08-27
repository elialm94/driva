import { db, save } from "../store";
import type { DB, FiscalYear } from "../types";
import { logAudit } from "./audit";
import { bokforingsdatum, calendarFiscalYear, nextDay, quartersOf, todayDate, type Period } from "./dates";

export {
  bokforingsdatum,
  calendarFiscalYear,
  monthsOf,
  quartersOf,
  todayDate,
  vatDueDate,
  type Period,
} from "./dates";

/**
 * Räkenskapsår och periodlås.
 *
 * V1: kalenderår (1 jan–31 dec). Åren skapas automatiskt när något ska
 * bokföras i dem – användaren behöver aldrig "sätta upp" ett räkenskapsår.
 * Månader och kvartal härleds deterministiskt ur året (ingen lagrad kopia).
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
 * Hämta eller skapa räkenskapsåret för ett datum. Skapar kalenderår.
 * Nya år får IB från föregående års UB först när det året stängs.
 */
export function ensureFiscalYearFor(date: string, actor: "anvandare" | "assistent" | "system" = "system"): FiscalYear {
  const data = db();
  const existing = fiscalYearFor(date, data);
  if (existing) return existing;
  const year = Number((date.length > 10 ? bokforingsdatum(date) : date).slice(0, 4));
  const fy = calendarFiscalYear(year);
  data.fiscalYears.push(fy);
  logAudit(actor, "rakenskapsar_skapat", `Räkenskapsåret ${fy.label} skapades automatiskt.`, {
    targetType: "rakenskapsar",
    targetId: fy.id,
  });
  return fy;
}

/** Det räkenskapsår som "pågår nu" (skapas vid behov). */
export function currentFiscalYear(): FiscalYear {
  return ensureFiscalYearFor(todayDate());
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

/** Momsperioden (kvartal) som innehåller datumet. */
export function vatPeriodFor(date: string): Period {
  const d = date.length > 10 ? bokforingsdatum(date) : date;
  const fy = ensureFiscalYearFor(d);
  const q = quartersOf(fy).find((p) => p.start <= d && d <= p.end);
  if (!q) throw new Error(`Ingen momsperiod för ${d}`);
  return q;
}
