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

export function isIsoDate(value: string): boolean {
  return DATE_ONLY.test(value);
}

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

/** Kalenderåret som räkenskapsåret slutar i – beskattningsår, fonder, avgifter. */
export function taxYearOf(fy: Pick<FiscalYear, "endDate">): number {
  return Number(fy.endDate.slice(0, 4));
}

/**
 * Visningsnamn: "2026" för kalenderår, "2025/2026" när året sträcker sig
 * över två kalenderår. Unikt per företag (Postgres unique på label).
 */
export function fiscalYearLabel(startDate: string, endDate: string): string {
  const startYear = startDate.slice(0, 4);
  const endYear = endDate.slice(0, 4);
  if (startDate === `${startYear}-01-01` && endDate === `${startYear}-12-31`) return startYear;
  return startYear === endYear ? startYear : `${startYear}/${endYear}`;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Samma månad+dag, ett antal kalenderår framåt eller bakåt. 29 feb → 28 feb om det inte är skottår. */
export function addCalendarYears(date: string, years: number): string {
  const year = Number(date.slice(0, 4)) + years;
  const monthDay = date.slice(5);
  if (monthDay === "02-29" && !isLeapYear(year)) return `${year}-02-28`;
  return `${year}-${monthDay}`;
}

/**
 * Ren fabrik för ett räkenskapsår med valfria datum (kalenderår eller brutet).
 * Id:t bär en slumpdel: id-kolumnen är en global text-PK i Postgres, så ett
 * deterministiskt `fy-2026` skulle kollidera mellan företag så fort två
 * tenants bokför samma år. Alla uppslag sker via datum/label – aldrig id-form.
 */
export function makeFiscalYear(startDate: string, endDate: string): FiscalYear {
  const label = fiscalYearLabel(startDate, endDate);
  return {
    id: `fy-${label.replace("/", "-")}-${Math.random().toString(36).slice(2, 10)}`,
    label,
    startDate,
    endDate,
    status: "oppet",
    openingBalances: {},
    openingSource: "manuell",
  };
}

/** Kalenderår 1 jan–31 dec – default för nya företag och demon. */
export function calendarFiscalYear(year: number): FiscalYear {
  return makeFiscalYear(`${year}-01-01`, `${year}-12-31`);
}

/** Nästa år: dagen efter slutdatum, lika långt fram som ett kalenderår. */
export function fiscalYearFollowing(fy: Pick<FiscalYear, "endDate">): FiscalYear {
  return makeFiscalYear(nextDay(fy.endDate), addCalendarYears(fy.endDate, 1));
}

/** Föregående år: samma mönster bakåt från startdatum. */
export function fiscalYearPreceding(fy: Pick<FiscalYear, "startDate">): FiscalYear {
  return makeFiscalYear(addCalendarYears(fy.startDate, -1), previousDay(fy.startDate));
}

function covers(fy: Pick<FiscalYear, "startDate" | "endDate">, date: string): boolean {
  return fy.startDate <= date && date <= fy.endDate;
}

/**
 * Året knappen "Skapa nästa år" ska utgå från: det senaste året som tagit
 * slut, annars innevarande, annars det senaste. Efterföljaren skapas en gång.
 */
export function fiscalYearToExtend<T extends { startDate: string; endDate: string }>(
  years: T[],
  today: string
): T | undefined {
  if (years.length === 0) return undefined;
  const sorted = [...years].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const ended = [...sorted].reverse().find((y) => y.endDate < today);
  return ended ?? sorted.find((y) => covers(y, today)) ?? sorted[sorted.length - 1];
}

/**
 * År som saknas för att `date` ska ligga i ett räkenskapsår. Följer mönstret
 * hos befintliga år (brutet år ger brutna år). Tom lista = datumet täcks redan.
 * Utan befintliga år skapas ett kalenderår.
 */
export function yearsToCoverDate(existing: FiscalYear[], date: string): FiscalYear[] {
  const all = [...existing].sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (all.some((f) => covers(f, date))) return [];
  if (all.length === 0) return [calendarFiscalYear(Number(date.slice(0, 4)))];

  const added: FiscalYear[] = [];
  const before = [...all].reverse().find((f) => f.endDate < date);
  const after = all.find((f) => f.startDate > date);

  if (before) {
    let cursor = before;
    while (cursor.endDate < date && added.length < 40) {
      const next = fiscalYearFollowing(cursor);
      if (after && next.startDate >= after.startDate) break;
      added.push(next);
      cursor = next;
    }
    if (added.some((f) => covers(f, date)) || covers(cursor, date)) return added;
  }

  if (after) {
    let cursor = after;
    const backward: FiscalYear[] = [];
    while (cursor.startDate > date && backward.length < 40) {
      const prev = fiscalYearPreceding(cursor);
      if (before && prev.endDate <= before.endDate) break;
      backward.push(prev);
      cursor = prev;
    }
    return [...added, ...backward];
  }

  return added;
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

/** Månader i ett räkenskapsår (härledda ur start/slut, lagras inte). */
export function monthsOf(fy: FiscalYear): Period[] {
  const periods: Period[] = [];
  let year = Number(fy.startDate.slice(0, 4));
  let month = Number(fy.startDate.slice(5, 7));
  const endYear = Number(fy.endDate.slice(0, 4));
  const endMonth = Number(fy.endDate.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const monthEnd = lastDayOfMonth(year, month);
    periods.push({
      key: `${year}-${String(month).padStart(2, "0")}`,
      label: `${MONTH_NAMES[month - 1]} ${year}`,
      start: periods.length === 0 ? fy.startDate : monthStart,
      end: monthEnd < fy.endDate ? monthEnd : fy.endDate,
    });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return periods;
}

function quarterLabel(chunk: Period[]): string {
  const first = chunk[0];
  const last = chunk[chunk.length - 1];
  const firstName = MONTH_NAMES[Number(first.start.slice(5, 7)) - 1];
  const lastName = MONTH_NAMES[Number(last.end.slice(5, 7)) - 1];
  const firstYear = first.start.slice(0, 4);
  const lastYear = last.end.slice(0, 4);
  if (firstYear === lastYear) return `${firstName}–${lastName} ${firstYear}`;
  return `${firstName} ${firstYear}–${lastName} ${lastYear}`;
}

/** Kvartal (momsperioder) i ett räkenskapsår – tre-månadersskivor från starten. */
export function quartersOf(fy: FiscalYear): Period[] {
  const months = monthsOf(fy);
  const quarters: Period[] = [];
  for (let i = 0; i < months.length; i += 3) {
    const chunk = months.slice(i, i + 3);
    const q = quarters.length + 1;
    quarters.push({
      key: `${fy.label}-K${q}`,
      label: quarterLabel(chunk),
      start: chunk[0].start,
      end: chunk[chunk.length - 1].end,
    });
  }
  return quarters;
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
