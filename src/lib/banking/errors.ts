/**
 * Användarvända fel för bankkopplingen. Ren modul (inga server-beroenden) så
 * att både serverkod och klientkomponenter kan importera texterna.
 *
 * Regeln: aldrig rå Tink-JSON, statuskoder eller engelska felmeddelanden mot
 * användaren. Alla vägar ut mynnar i en av meningarna nedan.
 */

export const BANK_ERROR_TEXT = {
  notConfigured: "Bankkoppling är inte konfigurerad",
  declined: "Banken godkände inte kopplingen. Försök igen.",
  temporary: "Tillfälligt fel hos banken. Försök igen.",
  stateMismatch: "Kopplingen kunde inte verifieras. Försök igen.",
  notConnected: "Ingen bank är kopplad.",
} as const;

/** Miljön saknar TINK_* och företaget är inte demo. */
export class BankNotConfiguredError extends Error {
  constructor() {
    super(BANK_ERROR_TEXT.notConfigured);
    this.name = "BankNotConfiguredError";
  }
}

/** Fel med ett meddelande som får visas rakt av för användaren. */
export class BankConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BankConnectionError";
  }
}

/** Transportfel mot Tinks API: HTTP-status + (eventuellt) Tinks felkod – för logg, aldrig för UI. */
export class TinkApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "TinkApiError";
  }
}

/**
 * Tink Links redirect-fel (query-parametern `error`) → svensk mening.
 * USER_CANCELLED är inte ett fel (returnerar null) – användaren stängde bara flödet.
 */
export function tinkLinkErrorMessage(error: string | undefined | null, reason?: string | null): string | null {
  const code = (error ?? "").toUpperCase();
  if (!code) return null;
  if (code === "USER_CANCELLED" && (reason ?? "").toUpperCase() !== "USER_DECLINED") return null;
  if (code === "USER_CANCELLED" || code === "AUTHENTICATION_ERROR" || code === "BAD_REQUEST") {
    return BANK_ERROR_TEXT.declined;
  }
  return BANK_ERROR_TEXT.temporary;
}

/** Tink credentials-status → svensk mening (null = inget fel). */
export function tinkCredentialsStatusMessage(status: string | undefined | null): string | null {
  const s = (status ?? "").toUpperCase();
  if (!s) return null;
  if (s === "AUTHENTICATION_ERROR" || s === "PERMANENT_ERROR" || s === "SESSION_EXPIRED" || s === "DISABLED") {
    return BANK_ERROR_TEXT.declined;
  }
  if (s === "TEMPORARY_ERROR" || s === "UNKNOWN") return BANK_ERROR_TEXT.temporary;
  return null;
}

/**
 * Vilket fel som helst ur bankflödet → text användaren får se. Okända fel
 * (nätverk, timeout, 5xx, oväntad JSON) blir "tillfälligt fel" – aldrig
 * felobjektets egna meddelande.
 */
export function userFacingBankError(err: unknown): string {
  if (err instanceof BankNotConfiguredError) return BANK_ERROR_TEXT.notConfigured;
  if (err instanceof BankConnectionError) return err.message;
  if (err instanceof TinkApiError) {
    if (err.status === 401 || err.status === 403) return BANK_ERROR_TEXT.declined;
    return BANK_ERROR_TEXT.temporary;
  }
  return BANK_ERROR_TEXT.temporary;
}
