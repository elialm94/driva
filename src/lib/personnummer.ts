import { digitsOnly } from "./invoices/formats";

/**
 * Svenskt personnummer: 10 eller 12 siffror, visat med bindestreck.
 * Känsligt – använd maskPersonnummer i vanliga vyer och i modellkontext.
 */

function looksLikeCentury(digits: string): boolean {
  return digits.length >= 2 && /^(18|19|20)/.test(digits);
}

/** Progressiv visning: YYYYMMDD-NNNN eller YYMMDD-NNNN. */
export function formatPersonnummer(value: string): string {
  const d = digitsOnly(value).slice(0, 12);
  if (looksLikeCentury(d)) {
    if (d.length <= 8) return d;
    return `${d.slice(0, 8)}-${d.slice(8)}`;
  }
  if (d.length <= 6) return d;
  return `${d.slice(0, 6)}-${d.slice(6, 10)}`;
}

export function normalizePersonnummer(value: string): string {
  const d = digitsOnly(value);
  if (d.length === 12) return `${d.slice(0, 8)}-${d.slice(8)}`;
  if (d.length === 10) return `${d.slice(0, 6)}-${d.slice(6)}`;
  return value.trim();
}

export function isPersonnummerFormat(value: string): boolean {
  const d = digitsOnly(value);
  return d.length === 10 || d.length === 12;
}

/** Vanliga vyer: `1985••••-1234`. */
export function maskPersonnummer(value: string): string {
  const d = digitsOnly(value);
  if (d.length === 12) return `${d.slice(0, 4)}••••-${d.slice(8)}`;
  if (d.length === 10) return `${d.slice(0, 2)}••••-${d.slice(6)}`;
  return value.trim() ? "••••" : "";
}
