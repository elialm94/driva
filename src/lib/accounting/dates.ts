import type { FiscalYear, VatPeriodicity } from "../types";

export type { VatPeriodicity } from "../types";

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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Bokföringsdatum (YYYY-MM-DD i svensk tid) ur en ISO-sträng. */
export function bokforingsdatum(iso: string): string {
  // Rena datum är redan bokföringsdatum – hoppa över Date/Intl, som annars
  // dominerar huvudbok/saldobalans-kostnaden vid många verifikationer.
  if (DATE_ONLY.test(iso)) return iso;
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

export function previousDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Ren fabrik för ett kalenderår – används av både motorn och migreringen.
 * Id:t bär en slumpdel: id-kolumnen är en global text-PK i Postgres, så ett
 * deterministiskt `fy-2026` skulle kollidera mellan företag så fort två
 * tenants bokför samma år. Alla uppslag sker via datum/label – aldrig id-form.
 */
export function calendarFiscalYear(year: number): FiscalYear {
  return {
    id: `fy-${year}-${Math.random().toString(36).slice(2, 10)}`,
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

/** Hela räkenskapsåret som en momsperiod (helårsmoms). */
export function fullYearOf(fy: FiscalYear): Period {
  return {
    key: `${fy.label}-H`,
    label: `helår ${fy.label}`,
    start: fy.startDate,
    end: fy.endDate,
  };
}

export const VAT_PERIODICITY: Record<VatPeriodicity, { label: string; short: string }> = {
  manad: { label: "Varje månad", short: "Månadsmoms" },
  kvartal: { label: "Varje kvartal", short: "Kvartalsmoms" },
  helar: { label: "En gång per år", short: "Helårsmoms" },
};

export function isVatPeriodicity(v: unknown): v is VatPeriodicity {
  return v === "manad" || v === "kvartal" || v === "helar";
}

/** Momsperioderna i ett räkenskapsår för en given periodicitet. */
export function vatPeriodsOf(fy: FiscalYear, periodicity: VatPeriodicity): Period[] {
  if (periodicity === "helar") return [fullYearOf(fy)];
  if (periodicity === "manad") return monthsOf(fy);
  return quartersOf(fy);
}

/** Antal hela månader ett datumintervall täcker (1 för en enskild månad). */
function monthSpan(start: string, end: string): number {
  const y = Number(end.slice(0, 4)) - Number(start.slice(0, 4));
  return y * 12 + (Number(end.slice(5, 7)) - Number(start.slice(5, 7))) + 1;
}

/**
 * Periodiciteten ett intervall representerar. Härledd ur längden i stället för
 * ur företagets aktuella inställning: en momsrapport som redovisades per
 * kvartal behåller sin förfallodag även om företaget senare byter till månad.
 */
export function vatPeriodicityOfRange(start: string, end: string): VatPeriodicity {
  const months = monthSpan(start, end);
  if (months >= 12) return "helar";
  return months >= 2 ? "kvartal" : "manad";
}

/**
 * Deklarations- och betaldatum (samma dag) för en momsperiod, enligt
 * skatteförfarandelagen 26 kap.
 *
 * Månad och kvartal: den 12:e i andra månaden efter periodens slut, utom i
 * januari och augusti där det är den 17:e. Kvartalen för ett kalenderår
 * hamnar alltså på 12 maj, 17 augusti, 12 november och 12 februari.
 *
 * Helår: aktiebolag utan EU-handel deklarerar momsen i anslutning till
 * inkomstdeklarationen, och datumet styrs av när räkenskapsåret slutar.
 * Tabellen nedan är Skatteverkets datum för DIGITAL inlämning – produkten
 * lämnar aldrig på pappersblankett. EU-handel (som i stället ger den 26:e i
 * andra månaden efter) stöds inte av produkten.
 *
 * Datumen är de lagstadgade – ingen justering för helgdag görs här, eftersom
 * en framflyttning till nästa bankdag kräver en svensk röddagskalender.
 */
export function vatDueDate(period: Period): string {
  if (vatPeriodicityOfRange(period.start, period.end) === "helar") {
    return fullYearVatDueDate(period.end);
  }
  // Räkna på år/månad direkt: Date.setUTCMonth på den 31:a spiller över till
  // nästa månad (31 december + 2 månader blir 3 mars, inte februari).
  const shifted = Number(period.end.slice(5, 7)) + 2;
  const year = Number(period.end.slice(0, 4)) + (shifted > 12 ? 1 : 0);
  const month = shifted > 12 ? shifted - 12 : shifted;
  const day = month === 1 || month === 8 ? 17 : 12;
  return `${year}-${String(month).padStart(2, "0")}-${day}`;
}

function fullYearVatDueDate(end: string): string {
  const year = Number(end.slice(0, 4));
  const month = Number(end.slice(5, 7));
  if (month <= 4) return `${year}-12-12`;
  if (month <= 6) return `${year + 1}-01-17`;
  if (month <= 8) return `${year + 1}-04-12`;
  return `${year + 1}-08-17`;
}
