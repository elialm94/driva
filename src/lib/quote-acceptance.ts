import { datumLang, kr } from "./format";

/**
 * Rena hjälpfunktioner för offertgodkännandet (ingen db, används av
 * kundsidan, servertjänsten, seed och tester).
 *
 * Godkännandet är en enkel elektronisk underskrift: kunden skriver sitt namn
 * och trycker på en knapp. Det som gör det bevisbart är inte knappen utan
 * vad som sparas runt den – se QuoteAcceptance i types.ts.
 */

export const ACCEPT_NAME_MAX_LENGTH = 120;

/** Trimma, slå ihop inre blanksteg, kapa. Tom sträng = ogiltigt namn. */
export function normalizeAcceptName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, ACCEPT_NAME_MAX_LENGTH);
}

export interface AcceptanceStatementInput {
  title: string;
  companyName: string;
  /** Offertdatum (versionens createdAt). */
  datedIso: string;
  /** Totalt inkl. moms – avtalspriset. */
  total: number;
  /** Preliminärt ROT/RUT-avdrag som dragits av på dokumentet, 0 utan ROT/RUT. */
  deduction?: number;
}

/**
 * Den mening kunden godkänner. Sparas ordagrant på godkännandet så att man
 * senare kan visa exakt vad som stod. Beloppet är avtalspriset inkl. moms;
 * ROT/RUT-avdraget nämns eftersom det är preliminärt och kan nekas.
 */
export function acceptanceStatement(input: AcceptanceStatementInput): string {
  const deduction = input.deduction ?? 0;
  const rot = deduction > 0 ? `, varav ${kr(deduction)} är ett preliminärt ROT/RUT-avdrag` : "";
  return `Genom att godkänna accepterar du offerten “${input.title}” från ${input.companyName} daterad ${datumLang(input.datedIso)} till ett totalt belopp om ${kr(input.total)}${rot}.`;
}

/** Kort fotnot under knappen – vad som faktiskt sparas. */
export const ACCEPTANCE_FOOTNOTE = "Godkännandet sparas tillsammans med offertens innehåll och tidpunkt.";

/** Kompakt enhetsbeskrivning ur user agent för underlaget ("Safari på iPhone"). */
export function describeUserAgent(ua: string | undefined): string | undefined {
  if (!ua) return undefined;
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : undefined;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua) && !/Chromium/.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : undefined;
  if (!device && !browser) return undefined;
  return [browser, device].filter(Boolean).join(" på ");
}
