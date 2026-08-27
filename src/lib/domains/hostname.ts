import type { DomainTld } from "../types";
import { DomainError } from "./errors";

export const SUPPORTED_TLDS: DomainTld[] = ["se"];
export const DEFAULT_TLD: DomainTld = "se";

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface ParsedHostname {
  hostname: string;
  label: string;
  tld: DomainTld;
}

/** Normalisera sökinput: sodermalmssnickeri → sodermalmssnickeri.se */
export function parseHostnameInput(raw: string): ParsedHostname {
  let value = raw.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/^www\./, "");
  value = value.split("/")[0]?.split("?")[0] ?? "";
  value = value.replace(/\.$/, "");
  if (!value) throw new DomainError("validation", "Skriv namnet du vill ha, till exempel sodermalmssnickeri.");
  if (/[^a-z0-9.-]/.test(value)) {
    throw new DomainError("validation", "Adressen får bara innehålla bokstäver, siffror och bindestreck.");
  }

  let label: string;
  let tld: string;
  if (value.includes(".")) {
    const parts = value.split(".");
    if (parts.length !== 2) {
      throw new DomainError("validation", "Just nu kan du bara skaffa en .se-adress, till exempel dittforetag.se.");
    }
    label = parts[0];
    tld = parts[1];
  } else {
    label = value;
    tld = DEFAULT_TLD;
  }

  if (!SUPPORTED_TLDS.includes(tld as DomainTld)) {
    throw new DomainError("validation", "Just nu kan du bara skaffa en .se-adress.");
  }
  if (label.length < 2) {
    throw new DomainError("validation", "Namnet behöver vara minst två tecken.");
  }
  if (!LABEL.test(label)) {
    throw new DomainError("validation", "Namnet får inte börja eller sluta med bindestreck.");
  }

  return { hostname: `${label}.${tld}`, label, tld: tld as DomainTld };
}

export function wwwAlias(hostname: string): string {
  return hostname.startsWith("www.") ? hostname : `www.${hostname}`;
}

export function apexOf(hostname: string): string {
  return hostname.replace(/^www\./, "");
}

export function isWww(hostname: string): boolean {
  return hostname.startsWith("www.");
}

/** Ett fåtal enkla alternativ när adressen är upptagen. */
export function suggestAlternatives(label: string, tld: DomainTld, taken: Set<string>): string[] {
  const candidates = [
    `${label}ab.${tld}`,
    `${hyphenateCompound(label)}.${tld}`,
    `${label}-ab.${tld}`,
  ];
  const out: string[] = [];
  const seen = new Set<string>([`${label}.${tld}`]);
  for (const c of candidates) {
    if (seen.has(c) || taken.has(c) || c === `${label}.${tld}`) continue;
    try {
      parseHostnameInput(c);
    } catch {
      continue;
    }
    seen.add(c);
    out.push(c);
    if (out.length >= 3) break;
  }
  return out;
}

function hyphenateCompound(label: string): string {
  if (label.includes("-")) return `${label}ab`;
  const suffixes = ["snickeri", "bygg", "el", "stad", "foto", "konsult", "byra", "ab"];
  for (const s of suffixes) {
    if (label.endsWith(s) && label.length > s.length + 2) {
      return `${label.slice(0, -s.length)}-${s}`;
    }
  }
  return `${label}-ab`;
}
