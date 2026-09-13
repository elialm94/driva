import type { VehicleKind } from "../types";
import { prisbasbeloppFor, yearOf } from "./prisbasbelopp";

/**
 * Skattefria kostnadsersättningar enligt Skatteverkets schabloner. Bolaget
 * får betala ut exakt schablonen till ägaren/anställda utan skatt eller
 * arbetsgivaravgifter – allt över blir lön. Ren data utan beroenden på lagret
 * så att formulärets förhandsvisning räknar på samma siffror som bokföringen.
 *
 * Källa: Skatteverket, "Traktamente" och "Milersättning" per inkomstår.
 */

/* ------------------------------ Milersättning ------------------------------ */

export type { VehicleKind };

export const VEHICLE_LABELS: Record<VehicleKind, string> = {
  egen: "Egen bil",
  formansbil: "Förmånsbil (bensin, diesel, hybrid)",
  formansbil_el: "Förmånsbil (el)",
};

/** Kronor per mil (10 km) som får betalas ut skattefritt. */
export interface MileageRates {
  egen: number;
  formansbil: number;
  formansbil_el: number;
}

const MILERSATTNING_PER_AR: Record<number, MileageRates> = {
  2022: { egen: 18.5, formansbil: 6.5, formansbil_el: 9.5 },
  2023: { egen: 25, formansbil: 12, formansbil_el: 9.5 },
  2024: { egen: 25, formansbil: 12, formansbil_el: 9.5 },
  2025: { egen: 25, formansbil: 12, formansbil_el: 9.5 },
  2026: { egen: 25, formansbil: 12, formansbil_el: 9.5 },
};

export function mileageRatesFor(year: number): MileageRates {
  const known = Object.keys(MILERSATTNING_PER_AR).map(Number);
  if (MILERSATTNING_PER_AR[year]) return MILERSATTNING_PER_AR[year];
  const clamped = Math.min(Math.max(year, Math.min(...known)), Math.max(...known));
  return MILERSATTNING_PER_AR[clamped];
}

/** Skattefri ersättning i kr per mil för bilslaget det år resan gjordes. */
export function mileageRatePerMil(date: string, vehicle: VehicleKind): number {
  return mileageRatesFor(yearOf(date))[vehicle];
}

/**
 * Skattefri milersättning i hela kronor för en sträcka i kilometer.
 * Sträckan får vara decimal (12,5 km) – beloppet avrundas till hela kronor
 * eftersom bokföringen är örefri.
 */
export function mileageAllowance(input: { date: string; km: number; vehicle: VehicleKind }): number {
  if (!Number.isFinite(input.km) || input.km <= 0) return 0;
  return Math.round((input.km / 10) * mileageRatePerMil(input.date, input.vehicle));
}

/* -------------------------------- Traktamente ------------------------------- */

export interface PerDiemRates {
  /** Hel dag: resan pågår mer än 12 timmar, minst en övernattning. */
  heldag: number;
  /** Halv dag: avresa efter kl 12 eller hemkomst före kl 19. */
  halvdag: number;
  /** Nattraktamente när bolaget inte betalat logi. */
  natt: number;
}

/**
 * Skattefritt inrikes traktamente per inkomstår: 0,5 % av prisbasbeloppet
 * avrundat till närmaste tiotal kronor (2026: 59 200 × 0,005 = 296 → 300 kr).
 * Halv dag och natt är hälften av heldagsbeloppet.
 */
export function perDiemRatesFor(year: number): PerDiemRates {
  const heldag = Math.round((prisbasbeloppFor(year) * 0.005) / 10) * 10;
  return { heldag, halvdag: heldag / 2, natt: heldag / 2 };
}

/**
 * Måltider som någon annan bjudit på under resan. Skatteverket minskar
 * dagtraktamentet med en andel av beloppet per nivå; natten rörs inte.
 */
export type FreeMeals = "inga" | "frukost" | "lunch_eller_middag" | "lunch_och_middag" | "alla";

export const FREE_MEALS_LABELS: Record<FreeMeals, string> = {
  inga: "Ingen fri kost",
  frukost: "Frukost",
  lunch_eller_middag: "Lunch eller middag",
  lunch_och_middag: "Lunch och middag",
  alla: "Alla måltider",
};

/** Andel av dagbeloppet som ska bort när måltiderna varit fria. */
const FREE_MEALS_SHARE: Record<FreeMeals, number> = {
  inga: 0,
  frukost: 0.15,
  lunch_eller_middag: 0.35,
  lunch_och_middag: 0.7,
  alla: 0.85,
};

/**
 * Minskningen i hela kronor för en hel eller halv dag med fri kost.
 * Räknas på dagens eget belopp, så en halv dag minskas på halvdagsbeloppet.
 */
export function freeMealsDeduction(dayAmount: number, meals: FreeMeals): number {
  if (!Number.isFinite(dayAmount) || dayAmount <= 0) return 0;
  const share = FREE_MEALS_SHARE[meals] ?? 0;
  return Math.min(dayAmount, Math.round(dayAmount * share));
}

export interface PerDiemInput {
  date: string;
  fullDays: number;
  halfDays: number;
  /** Nätter utan betald logi. */
  nights: number;
  /** Fria måltider under resan. Saknas = ingen fri kost. */
  freeMeals?: FreeMeals;
  /**
   * Schablonen att räkna med. Saknas = det svenska beloppet för resans år.
   * Utlandsresor skickar in normalbeloppet för landet.
   */
  rates?: PerDiemRates;
}

/** Skattefritt traktamente i hela kronor för en tjänsteresa. */
export function perDiemAllowance(input: PerDiemInput): number {
  const rates = input.rates ?? perDiemRatesFor(yearOf(input.date));
  const meals = input.freeMeals ?? "inga";
  const whole = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  const heldag = rates.heldag - freeMealsDeduction(rates.heldag, meals);
  const halvdag = rates.halvdag - freeMealsDeduction(rates.halvdag, meals);
  return whole(input.fullDays) * heldag + whole(input.halfDays) * halvdag + whole(input.nights) * rates.natt;
}

/* ---------------------------- Resans dagar ur tiderna --------------------------- */

export interface TripDays {
  fullDays: number;
  halfDays: number;
  nights: number;
}

/** Avresedagen är hel dag när resan börjar före den här timmen. */
const FULL_DEPARTURE_BEFORE_HOUR = 12;
/** Hemkomstdagen är hel dag när resan slutar efter den här timmen. */
const FULL_RETURN_AFTER_HOUR = 19;

const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/;

/** Lokal datumtid ("2026-03-10T07:30") som minuter sedan epoch, utan tidszon. */
function parseLocalDateTime(value: string | undefined): { date: string; minutes: number } | null {
  const m = LOCAL_DATETIME.exec(value?.trim() ?? "");
  if (!m) return null;
  const [, year, month, day, hour, minute] = m;
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (Number.isNaN(utc)) return null;
  const date = `${year}-${month}-${day}`;
  // Datumet måste vara verkligt: 2026-02-30 rullar vidare i Date.UTC.
  if (new Date(utc).toISOString().slice(0, 10) !== date) return null;
  return { date, minutes: Math.round(utc / 60_000) };
}

/**
 * Hel dag, halv dag och natt räknat ur avresa och hemkomst. Skatteverkets
 * regler: avresedagen är hel dag om resan börjar före kl 12 och hemkomstdagen
 * hel dag om den slutar efter kl 19, dagarna mellan är alltid hela, och varje
 * dygnsbyte är en natt.
 *
 * null betyder att resan inte ger traktamente: ogiltiga tider, hemkomst före
 * avresa eller ingen övernattning (samma dygn).
 */
export function tripDays(departure: string | undefined, arrival: string | undefined): TripDays | null {
  const from = parseLocalDateTime(departure);
  const to = parseLocalDateTime(arrival);
  if (!from || !to || to.minutes <= from.minutes) return null;
  const nights = Math.round((Date.parse(`${to.date}T00:00:00Z`) - Date.parse(`${from.date}T00:00:00Z`)) / 86_400_000);
  if (nights < 1) return null;
  const departureHour = (from.minutes % 1_440) / 60;
  const arrivalHour = (to.minutes % 1_440) / 60;
  const fullDeparture = departureHour < FULL_DEPARTURE_BEFORE_HOUR;
  const fullReturn = arrivalHour > FULL_RETURN_AFTER_HOUR;
  return {
    fullDays: (fullDeparture ? 1 : 0) + (fullReturn ? 1 : 0) + (nights - 1),
    halfDays: (fullDeparture ? 0 : 1) + (fullReturn ? 0 : 1),
    nights,
  };
}

/* --------------------------------- Utlandsresor -------------------------------- */

export type ForeignPerDiemTable = Record<string, Record<number, PerDiemRates>>;

/**
 * Skatteverkets normalbelopp per land och inkomstår. Tabellen är tom: listan
 * är på hundratals länder och finns inte i repot. Tills den importeras får en
 * utlandsresa inte bokföras - det svenska beloppet är inte en rimlig gissning.
 */
export const FOREIGN_PER_DIEM_RATES: ForeignPerDiemTable = {};

/** Normalbeloppet för ett land (ISO 3166-1 alpha-2), eller undefined när det saknas. */
export function foreignPerDiemRatesFor(
  countryCode: string,
  year: number,
  table: ForeignPerDiemTable = FOREIGN_PER_DIEM_RATES
): PerDiemRates | undefined {
  const code = countryCode?.trim().toUpperCase();
  if (!code) return undefined;
  return table[code]?.[year];
}

/** Landskoden för Sverige - allt annat är en utlandsresa. */
export const SWEDEN = "SE";

export function isSweden(countryCode: string | undefined): boolean {
  const code = countryCode?.trim().toUpperCase();
  return !code || code === SWEDEN;
}

/**
 * Traktamente kräver övernattning och att resmålet ligger mer än 50 km från
 * både bostaden och den vanliga arbetsplatsen. Villkoret går inte att räkna
 * fram – det är en fråga till användaren.
 */
export const PER_DIEM_DISTANCE_KM = 50;
