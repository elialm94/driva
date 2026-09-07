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

export interface PerDiemInput {
  date: string;
  fullDays: number;
  halfDays: number;
  /** Nätter utan betald logi. */
  nights: number;
}

/** Skattefritt traktamente i hela kronor för en tjänsteresa i Sverige. */
export function perDiemAllowance(input: PerDiemInput): number {
  const rates = perDiemRatesFor(yearOf(input.date));
  const whole = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  return whole(input.fullDays) * rates.heldag + whole(input.halfDays) * rates.halvdag + whole(input.nights) * rates.natt;
}

/**
 * Traktamente kräver övernattning och att resmålet ligger mer än 50 km från
 * både bostaden och den vanliga arbetsplatsen. Villkoret går inte att räkna
 * fram – det är en fråga till användaren.
 */
export const PER_DIEM_DISTANCE_KM = 50;
