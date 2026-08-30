import { InvoiceNotReadyError } from "./validate";

export const INVOICE_ISSUE_FAILED = "Fakturan kunde inte utfärdas. Kontrollera uppgifterna och försök igen.";
export const INVOICE_SEND_FAILED_GENERIC = "Fakturan kunde inte skickas. Försök igen.";

const KNOWN: Array<{ test: (raw: string) => boolean; message: string }> = [
  {
    test: (raw) => /issue_invalid/i.test(raw),
    message: "Fakturan kunde inte utfärdas. Nummer och OCR tilldelas när du skickar – försök igen.",
  },
  {
    test: (raw) => /issue_conflict/i.test(raw),
    message: "Fakturan är redan utfärdad eller har ändrats. Ladda om sidan och försök igen.",
  },
  {
    test: (raw) => /sequence_conflict/i.test(raw),
    message: "Någon annan utfärdade en faktura samtidigt. Ladda om sidan och försök igen.",
  },
  {
    test: (raw) => /immutability/i.test(raw),
    message: "En utfärdad faktura kan inte ändras. Kreditera den i stället.",
  },
  {
    test: (raw) => /payment_conflict/i.test(raw),
    message: "Fakturan kunde inte uppdateras. Ladda om sidan och försök igen.",
  },
  {
    test: (raw) => /verifikation_ogiltig/i.test(raw),
    message: "Bokföringen kunde inte sparas. Försök igen.",
  },
];

function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "";
}

/** API-/SQL-koder och stackspår ska aldrig synas i UI. */
export function looksLikeInternalError(message: string): boolean {
  if (!message) return true;
  if (/^[a-z][a-z0-9_]*:/i.test(message)) return true;
  if (/\b(P0001|40001|40P01|XX000|22P02)\b/.test(message)) return true;
  if (/^\s*error:/i.test(message)) return true;
  if (/\bat\s+\S+\s+\(/.test(message)) return true;
  return false;
}

/**
 * Svensk, lugn text till UI. Aldrig råa koder som `issue_invalid: …`.
 * InvoiceNotReadyError behåller checklistans formuleringar.
 */
export function userFacingIssueError(err: unknown, fallback = INVOICE_ISSUE_FAILED): string {
  if (err instanceof InvoiceNotReadyError) {
    const text = err.blockers.map((b) => b.message).filter(Boolean).join(" ");
    return text || fallback;
  }
  const raw = rawMessage(err);
  for (const row of KNOWN) {
    if (row.test(raw)) return row.message;
  }
  if (looksLikeInternalError(raw)) return fallback;
  return raw || fallback;
}

export function userFacingInvoiceSendError(err: unknown): string {
  return userFacingIssueError(err, INVOICE_SEND_FAILED_GENERIC);
}
