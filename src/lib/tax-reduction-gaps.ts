import { isPersonnummerFormat } from "./personnummer";
import type { TaxReductionDetails } from "./types";

export type TaxReductionGapScope = "invoice" | "application";

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

  if (scope === "application") {
    if (!hasText(details.workAddress)) {
      missing.push({ code: "workAddress", label: "Adress där arbetet utförts" });
    }
    if (!isoDate(details.workPeriodStart)) {
      missing.push({ code: "workPeriod", label: "När arbetet utfördes" });
    }
  } else if (!isoDate(details.workPeriodStart) && !isoDate(details.workPeriodEnd)) {
    missing.push({ code: "workPeriod", label: "Arbetsperiod" });
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

export function suggestedServiceDate(details?: Pick<TaxReductionDetails, "workPeriodStart" | "workPeriodEnd"> | null): string {
  return isoDate(details?.workPeriodEnd) || isoDate(details?.workPeriodStart);
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
