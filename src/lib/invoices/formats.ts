/**
 * Formatkontroll av svenska företagsuppgifter.
 * Det här är inte en kontroll mot Skatteverket, Bolagsverket eller Bankgirot.
 */

const ORGNR_DIGITS = /^\d{10}$/;
const VAT_SE = /^SE\d{12}$/;
const BANKGIRO = /^\d{3,4}-\d{4}$/;

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** Progressiv visning: bara siffror, max 10, bindestreck efter 6 (`NNNNNN-NNNN`). */
export function formatOrgnr(value: string): string {
  const d = digitsOnly(value).slice(0, 10);
  if (d.length <= 6) return d;
  return `${d.slice(0, 6)}-${d.slice(6)}`;
}

export function normalizeOrgnr(value: string): string {
  const d = digitsOnly(value);
  if (d.length === 10) return formatOrgnr(d);
  return value.trim();
}

export function isOrgnrFormat(value: string): boolean {
  return ORGNR_DIGITS.test(digitsOnly(value));
}

export function isVatNumberFormat(value: string): boolean {
  return VAT_SE.test(value.trim().toUpperCase().replace(/\s/g, ""));
}

export function vatMatchesOrgnr(vatNumber: string, orgNumber: string): boolean {
  const vat = vatNumber.trim().toUpperCase().replace(/\s/g, "");
  const org = digitsOnly(orgNumber);
  if (!isVatNumberFormat(vat) || org.length !== 10) return false;
  return vat === `SE${org}01`;
}

export function isBankgiroFormat(value: string): boolean {
  const trimmed = value.trim();
  if (BANKGIRO.test(trimmed)) return true;
  const d = digitsOnly(trimmed);
  return d.length === 7 || d.length === 8;
}

export function normalizeBankgiro(value: string): string {
  const trimmed = value.trim();
  if (BANKGIRO.test(trimmed)) return trimmed;
  const d = digitsOnly(trimmed);
  if (d.length === 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return trimmed;
}

export function formatVatNumber(orgNumber: string): string {
  const org = digitsOnly(orgNumber);
  if (org.length !== 10) return "";
  return `SE${org}01`;
}

const PLUSGIRO = /^\d{2,8}-\d$/;
const IBAN_SE = /^SE\d{22}$/;
const BIC = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

export function isPlusgiroFormat(value: string): boolean {
  const trimmed = value.trim();
  if (PLUSGIRO.test(trimmed)) return true;
  const d = digitsOnly(trimmed);
  return d.length >= 2 && d.length <= 8;
}

export function normalizePlusgiro(value: string): string {
  const trimmed = value.trim();
  if (PLUSGIRO.test(trimmed)) return trimmed;
  const d = digitsOnly(trimmed);
  if (d.length >= 2) return `${d.slice(0, -1)}-${d.slice(-1)}`;
  return trimmed;
}

export function isIbanFormat(value: string): boolean {
  const v = value.trim().toUpperCase().replace(/\s/g, "");
  return IBAN_SE.test(v) || /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v);
}

export function normalizeIban(value: string): string {
  return value.trim().toUpperCase().replace(/\s/g, "");
}

export function isBicFormat(value: string): boolean {
  return BIC.test(value.trim().toUpperCase().replace(/\s/g, ""));
}

export function normalizeBic(value: string): string {
  return value.trim().toUpperCase().replace(/\s/g, "");
}

export function hasAnyPaymentMethod(input: {
  bankgiro?: string;
  plusgiro?: string;
  iban?: string;
  bankAccount?: string;
}): boolean {
  return Boolean(
    input.bankgiro?.trim() || input.plusgiro?.trim() || input.iban?.trim() || input.bankAccount?.trim()
  );
}
