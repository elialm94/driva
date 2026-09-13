import type { FilingDocumentType } from "./instructions";

/**
 * Ägaradressen till ett deklarationsärende. Ren funktion utan lagerberoenden
 * så att klientkomponenter kan länka dit; konsultytan skriver om adressen.
 */
export function filingCaseHref(type: FilingDocumentType, subjectId: string): string {
  return `/bokforing/deklarationer/${type}/${encodeURIComponent(subjectId)}`;
}
