import { isPersonnummerFormat } from "./personnummer";
import type { TaxReductionDetails } from "./types";

export type TaxReductionGapScope = "invoice" | "application";

/**
 * "workPeriod" returneras aldrig längre. Arbetsperioden finns inte i
 * Skatteverkets husarbetsbegäran (se hus-begaran.ts och
 * docs/skatteverket/hus/) och härleds i stället med deriveWorkPeriod, så den
 * kan varken vara en lucka i editorn eller spärra exporten. Koden står kvar i
 * unionen för äldre data och äldre tester.
 */
export type TaxReductionMissingCode =
  | "personnummer"
  | "workAddress"
  | "workPeriod"
  | "dwellingType"
  | "propertyDesignation"
  | "brfOrgNumber"
  | "apartmentNumber";

export interface TaxReductionMissingField {
  code: TaxReductionMissingCode;
  label: string;
}

const MONTHS = [
  "januari",
  "februari",
  "mars",
  "april",
  "maj",
  "juni",
  "juli",
  "augusti",
  "september",
  "oktober",
  "november",
  "december",
];

function isoDate(value?: string): string {
  return value ? value.slice(0, 10) : "";
}

function hasText(value?: string): boolean {
  return Boolean(value?.trim());
}

/** Ny faktura: bara det som saknas för att välja ROT/RUT. Ansökan kan kräva mer. */
export function taxReductionMissingFields(input: {
  type: "rot" | "rut";
  personalIdentityNumber?: string;
  details?: TaxReductionDetails | null;
  scope?: TaxReductionGapScope;
}): TaxReductionMissingField[] {
  const missing: TaxReductionMissingField[] = [];
  const details = input.details ?? {};
  const scope = input.scope ?? "invoice";

  if (!isPersonnummerFormat(input.personalIdentityNumber ?? "")) {
    missing.push({ code: "personnummer", label: "Personnummer" });
  }

  if (scope === "application" && !hasText(details.workAddress)) {
    missing.push({ code: "workAddress", label: "Adress där arbetet utförts" });
  }

  if (input.type === "rot") {
    const dwelling = details.housing?.dwellingType;
    if (!dwelling) {
      missing.push({ code: "dwellingType", label: "Bostadstyp" });
    } else if (dwelling === "smahus") {
      if (!hasText(details.housing?.propertyDesignation)) {
        missing.push({ code: "propertyDesignation", label: "Fastighetsbeteckning" });
      }
    } else if (dwelling === "bostadsratt") {
      if (!hasText(details.housing?.brfOrgNumber)) {
        missing.push({ code: "brfOrgNumber", label: "BRF organisationsnummer" });
      }
      if (!hasText(details.housing?.apartmentNumber)) {
        missing.push({ code: "apartmentNumber", label: "Lägenhetsnummer" });
      }
    }
  }

  return missing;
}

export function taxReductionMissingHint(type: "rot" | "rut", missing: TaxReductionMissingField[]): string | null {
  const kind = type === "rot" ? "ROT" : "RUT";
  if (missing.length === 0) return null;
  if (missing.length === 1) return `${missing[0].label} saknas för ${kind}-ansökan`;
  return `${missing.length} uppgifter saknas för ${kind}-ansökan`;
}

/**
 * Utförandedatum att föreslå utifrån perioden. Aktuell månad ger inget förslag:
 * den säger ingenting om när arbetet gjordes.
 */
export function suggestedServiceDate(
  details?: Pick<TaxReductionDetails, "workPeriodStart" | "workPeriodEnd" | "workPeriodSource"> | null
): string {
  if (details?.workPeriodSource === "derived") return "";
  return isoDate(details?.workPeriodEnd) || isoDate(details?.workPeriodStart);
}

/* ------------------------------- arbetsperiod ------------------------------- */

/** "invoice" = manuellt angivet på fakturan. Bara det får skrivas till uppdraget. */
export type WorkPeriodSource = NonNullable<TaxReductionDetails["workPeriodSource"]>;

/** Perioden är manuell när den skrivits in på fakturan. Äldre fakturor saknar källa. */
export function isManualWorkPeriod(
  details?: Pick<TaxReductionDetails, "workPeriodSource"> | null
): boolean {
  return !details?.workPeriodSource || details.workPeriodSource === "invoice";
}

export interface WorkPeriod {
  start: string;
  end: string;
}

export interface ResolvedWorkPeriod extends WorkPeriod {
  source: WorkPeriodSource;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Månadens första och sista dag. Ren strängmatematik, ingen tidszon. */
export function currentMonthPeriod(today: string): WorkPeriod {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const mm = today.slice(5, 7);
  const days = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${days}` };
}

/**
 * Arbetsperioden i läsordning: fakturans manuellt angivna period, annars
 * uppdragets start och slut, annars uppdragets completedAt, annars aktuell
 * månad. Härledningen ligger sist så att ett manuellt värde alltid vinner och
 * befintliga fakturor behåller sitt.
 *
 * Perioden härleds för visning och för ansökningsunderlaget. Den skrivs ALDRIG
 * tillbaka till uppdraget: ett uppdrag som medvetet saknar datum ska inte få
 * påhittade sådana. Därför bär en härledd period sin källa i
 * workPeriodSource, och allt utom "invoice" räknas här som frånvarande så att
 * det räknas om när uppdraget senare får riktiga datum.
 */
export function deriveWorkPeriod(input: {
  details?: Pick<TaxReductionDetails, "workPeriodStart" | "workPeriodEnd" | "workPeriodSource"> | null;
  job?: { startDate?: string; endDate?: string; completedAt?: string } | null;
  today: string;
}): ResolvedWorkPeriod {
  const manual = isManualWorkPeriod(input.details) ? input.details : null;
  const manualStart = isoDate(manual?.workPeriodStart);
  const manualEnd = isoDate(manual?.workPeriodEnd);
  if (manualStart || manualEnd) {
    return { start: manualStart || manualEnd, end: manualEnd || manualStart, source: "invoice" };
  }

  const jobStart = isoDate(input.job?.startDate);
  const jobEnd = isoDate(input.job?.endDate);
  if (jobStart || jobEnd) {
    return { start: jobStart || jobEnd, end: jobEnd || jobStart, source: "job" };
  }

  const completed = isoDate(input.job?.completedAt);
  if (completed) return { start: completed, end: completed, source: "job" };

  return { ...currentMonthPeriod(input.today), source: "derived" };
}

/** "12–19 augusti 2026" när månad och år är samma. */
export function formatWorkPeriodRange(start?: string, end?: string): string {
  const s = isoDate(start);
  const e = isoDate(end);
  if (!s && !e) return "";
  if (s && e && s !== e) {
    const [sy, sm, sd] = s.split("-").map(Number);
    const [ey, em, ed] = e.split("-").map(Number);
    if (sy === ey && sm === em) return `${sd}–${ed} ${MONTHS[em - 1]} ${ey}`;
    if (sy === ey) return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]} ${ey}`;
    return `${sd} ${MONTHS[sm - 1]} ${sy} – ${ed} ${MONTHS[em - 1]} ${ey}`;
  }
  const one = s || e;
  const [y, m, d] = one.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
