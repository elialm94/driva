import type { FiscalYear } from "../types";

/**
 * Rena datum- och periodhjälpare för bokföringen. Inga beroenden på lagret –
 * används av både motorn och migreringen (som körs innan store är initierad).
 */

const dateFmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Bokföringsdatum (YYYY-MM-DD i svensk tid) ur en ISO-sträng. */
export function bokforingsdatum(iso: string): string {
  // sv-SE formaterar redan som YYYY-MM-DD.
  return dateFmt.format(new Date(iso));
}

export function todayDate(): string {
  return bokforingsdatum(new Date().toISOString());
}

export function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Ren fabrik för ett kalenderår – används av både motorn och migreringen. */
export function calendarFiscalYear(year: number): FiscalYear {
  return {
    id: `fy-${year}`,
    label: String(year),
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
    status: "oppet",
    openingBalances: {},
    openingSource: "manuell",
  };
}

export interface Period {
  key: string;
  label: string;
  /** YYYY-MM-DD (inklusive). */
  start: string;
  end: string;
}

const MONTH_NAMES = [
  "januari", "februari", "mars", "april", "maj", "juni",
  "juli", "augusti", "september", "oktober", "november", "december",
];

function lastDayOfMonth(year: number, month1: number): string {
  const d = new Date(Date.UTC(year, month1, 0));
  return d.toISOString().slice(0, 10);
}

/** Månader i ett räkenskapsår (härledda, lagras inte). */
export function monthsOf(fy: FiscalYear): Period[] {
  const year = Number(fy.label);
  return MONTH_NAMES.map((name, i) => ({
    key: `${year}-${String(i + 1).padStart(2, "0")}`,
    label: `${name} ${year}`,
    start: `${year}-${String(i + 1).padStart(2, "0")}-01`,
    end: lastDayOfMonth(year, i + 1),
  }));
}

/** Kvartal (momsperioder) i ett räkenskapsår. */
export function quartersOf(fy: FiscalYear): Period[] {
  const year = Number(fy.label);
  const labels = ["januari–mars", "april–juni", "juli–september", "oktober–december"];
  return labels.map((label, q) => ({
    key: `${year}-K${q + 1}`,
    label: `${label} ${year}`,
    start: `${year}-${String(q * 3 + 1).padStart(2, "0")}-01`,
    end: lastDayOfMonth(year, q * 3 + 3),
  }));
}

/** Deklarations- och betaldatum för en momsperiod: 12:e i andra månaden efter periodens slut. */
export function vatDueDate(period: Period): string {
  const end = new Date(`${period.end}T12:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 2);
  return `${end.toISOString().slice(0, 8)}12`;
}
