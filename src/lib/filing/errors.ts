/**
 * Användarvända fel för inlämningen. Ren modul (inga server-beroenden) så att
 * både serverkod och klientkomponenter kan importera texterna.
 *
 * Regeln är densamma som för bankkopplingen: aldrig rå JSON, statuskoder eller
 * engelska felmeddelanden från myndigheten mot användaren. Och aldrig fejkad
 * framgång – saknas avtalet sägs det rakt ut.
 */

export const FILING_ERROR_TEXT = {
  notConfigured:
    "Inlämning direkt till myndigheten är inte påslagen för det här företaget. Hämta filen och lämna in den själv – den är komplett.",
  temporary: "Tillfälligt fel hos myndigheten. Försök igen.",
  declined: "Myndigheten tog inte emot filen. Kontrollera uppgifterna och försök igen.",
  notSigned: "Inlämningen måste signeras innan den lämnas in.",
  alreadySubmitted: "Inlämningen är redan lämnad in.",
  noSubmission: "Det finns ingen inlämning att arbeta med.",
} as const;

/** Miljön saknar avtalsuppgifter och företaget är inte demo. */
export class FilingNotConfiguredError extends Error {
  constructor() {
    super(FILING_ERROR_TEXT.notConfigured);
    this.name = "FilingNotConfiguredError";
  }
}

/** Fel med ett meddelande som får visas rakt av för användaren. */
export class FilingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilingError";
  }
}

/** Transportfel mot myndighetens API: HTTP-status och ev. felkod – för logg, aldrig för UI. */
export class FilingApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "FilingApiError";
  }
}

/**
 * Vilket fel som helst ur inlämningsflödet → text användaren får se. Okända fel
 * (nätverk, timeout, 5xx, oväntad JSON) blir "tillfälligt fel" – aldrig
 * felobjektets egna meddelande.
 */
export function userFacingFilingError(err: unknown): string {
  if (err instanceof FilingNotConfiguredError) return FILING_ERROR_TEXT.notConfigured;
  if (err instanceof FilingError) return err.message;
  if (err instanceof FilingApiError) {
    if (err.status === 401 || err.status === 403) return FILING_ERROR_TEXT.notConfigured;
    if (err.status === 400 || err.status === 422) return FILING_ERROR_TEXT.declined;
    return FILING_ERROR_TEXT.temporary;
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  return FILING_ERROR_TEXT.temporary;
}
