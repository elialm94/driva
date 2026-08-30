/**
 * Central normalisering och validering av svenska fält.
 *
 * UI visar fel. Servern är sanningen. Användaren skriver uppgiften –
 * Driva sköter formatet (bindestreck, mellanslag, landskod).
 *
 * Befintliga formatfunktioner i invoices/formats.ts och personnummer.ts
 * återanvänds här så regex inte dupliceras.
 */

import {
  digitsOnly,
  formatOrgnr,
  isBankgiroFormat,
  isOrgnrFormat,
  isPlusgiroFormat,
  normalizeBankgiro,
  normalizeOrgnr,
  normalizePlusgiro,
} from "../invoices/formats";
import {
  formatPersonnummer,
  isPersonnummerFormat,
  normalizePersonnummer,
} from "../personnummer";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function looksLikeEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export type SwedishFieldCode = "empty" | "too_few" | "invalid";

export type SwedishFieldResult =
  | { ok: true; normalized: string; formatted: string }
  | { ok: false; code: SwedishFieldCode; message: string };

const ok = (normalized: string, formatted = normalized): SwedishFieldResult => ({
  ok: true,
  normalized,
  formatted,
});

function emptyResult(required: boolean | undefined, message: string): SwedishFieldResult {
  if (required) return { ok: false, code: "empty", message };
  return ok("", "");
}

/* ----------------------------- Organisationsnummer ----------------------------- */

export function normalizeSwedishOrganizationNumber(value: string): string {
  return normalizeOrgnr(value);
}

export function formatSwedishOrganizationNumber(value: string): string {
  return formatOrgnr(value);
}

export function isSwedishOrganizationNumber(value: string): boolean {
  return isOrgnrFormat(value);
}

/**
 * Godkänner 5555555555, 555555-5555 och "555 555 5555".
 * Kanoniskt värde: NNNNNN-NNNN.
 */
export function validateSwedishOrganizationNumber(
  value: string,
  opts?: { required?: boolean; emptyMessage?: string }
): SwedishFieldResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return emptyResult(opts?.required, opts?.emptyMessage ?? "Ange företagets organisationsnummer.");
  }
  if (/[^\d\s.-]/.test(trimmed)) {
    return { ok: false, code: "invalid", message: "Ange ett giltigt organisationsnummer med 10 siffror." };
  }
  const digits = digitsOnly(trimmed);
  if (digits.length < 10) {
    return { ok: false, code: "too_few", message: "Organisationsnumret ska innehålla 10 siffror." };
  }
  if (digits.length > 10 || !isOrgnrFormat(trimmed)) {
    return { ok: false, code: "invalid", message: "Ange ett giltigt organisationsnummer med 10 siffror." };
  }
  const normalized = normalizeOrgnr(trimmed);
  return ok(normalized, formatOrgnr(normalized));
}

export const swedishOrgnrInputProps = {
  inputMode: "numeric" as const,
  autoComplete: "off" as const,
  spellCheck: false,
  placeholder: "555555-5555",
};

/* -------------------------------- Personnummer -------------------------------- */

export function normalizeSwedishPersonalIdentityNumber(value: string): string {
  return normalizePersonnummer(value);
}

export function formatSwedishPersonalIdentityNumber(value: string): string {
  return formatPersonnummer(value);
}

export function isSwedishPersonalIdentityNumber(value: string): boolean {
  return isPersonnummerFormat(value);
}

export function validateSwedishPersonalIdentityNumber(
  value: string,
  opts?: { required?: boolean }
): SwedishFieldResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return emptyResult(opts?.required, "Ange ett giltigt personnummer.");
  }
  if (/[^\d\s+-]/.test(trimmed)) {
    return { ok: false, code: "invalid", message: "Ange ett giltigt personnummer." };
  }
  const digits = digitsOnly(trimmed);
  if (digits.length !== 10 && digits.length !== 12) {
    return { ok: false, code: "too_few", message: "Ange personnummer med 10 eller 12 siffror." };
  }
  if (!isPersonnummerFormat(trimmed)) {
    return { ok: false, code: "invalid", message: "Ange ett giltigt personnummer." };
  }
  const normalized = normalizePersonnummer(trimmed);
  return ok(normalized, formatPersonnummer(normalized));
}

export const swedishPersonnummerInputProps = {
  inputMode: "numeric" as const,
  autoComplete: "off" as const,
  spellCheck: false,
  placeholder: "YYYYMMDD-XXXX",
};

/* --------------------------------- Postnummer --------------------------------- */

export function formatSwedishPostalCode(value: string): string {
  const d = digitsOnly(value).slice(0, 5);
  if (d.length <= 3) return d;
  return `${d.slice(0, 3)} ${d.slice(3)}`;
}

export function normalizeSwedishPostalCode(value: string): string {
  const d = digitsOnly(value);
  if (d.length === 5) return formatSwedishPostalCode(d);
  return value.trim();
}

export function isSwedishPostalCode(value: string): boolean {
  return digitsOnly(value).length === 5;
}

export function validateSwedishPostalCode(
  value: string,
  opts?: { required?: boolean }
): SwedishFieldResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return emptyResult(opts?.required, "Ange ett giltigt postnummer.");
  }
  if (/[^\d\s]/.test(trimmed) || digitsOnly(trimmed).length !== 5) {
    return { ok: false, code: "invalid", message: "Ange ett giltigt postnummer." };
  }
  const formatted = formatSwedishPostalCode(trimmed);
  return ok(formatted, formatted);
}

export const swedishPostalCodeInputProps = {
  inputMode: "numeric" as const,
  autoComplete: "postal-code" as const,
  placeholder: "116 24",
};

/* ----------------------------------- Telefon ---------------------------------- */

/** Siffror, ev. med +46. Mellanslag och bindestreck tas bort. */
export function compactSwedishPhone(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  if (trimmed.startsWith("+") || trimmed.startsWith("00")) {
    const intl = trimmed.startsWith("00") ? digits.slice(2) : digits;
    return intl ? `+${intl}` : "";
  }
  return digits;
}

export function isSwedishPhoneFormat(value: string): boolean {
  if (/[a-zA-ZåäöÅÄÖ]/.test(value)) return false;
  const compact = compactSwedishPhone(value);
  if (!compact) return false;
  if (compact.startsWith("+46")) {
    const rest = compact.slice(3);
    return /^\d{7,13}$/.test(rest);
  }
  if (compact.startsWith("+")) {
    return /^\+\d{8,15}$/.test(compact);
  }
  return /^0\d{7,12}$/.test(compact);
}

export function formatSwedishPhone(value: string): string {
  const compact = compactSwedishPhone(value);
  if (!compact) return value.trim();
  if (compact.startsWith("+46")) {
    const rest = compact.slice(3);
    if (rest.length === 9 && rest.startsWith("7")) {
      return `+46 ${rest.slice(0, 2)} ${rest.slice(2, 5)} ${rest.slice(5, 7)} ${rest.slice(7)}`;
    }
    return `+46 ${rest}`;
  }
  if (compact.startsWith("07") && compact.length === 10) {
    return `${compact.slice(0, 3)}-${compact.slice(3, 6)} ${compact.slice(6, 8)} ${compact.slice(8)}`;
  }
  if (compact.startsWith("08") && compact.length >= 8 && compact.length <= 10) {
    return `${compact.slice(0, 2)}-${compact.slice(2)}`;
  }
  return compact;
}

export function normalizeSwedishPhone(value: string): string {
  if (!value.trim()) return "";
  if (!isSwedishPhoneFormat(value)) return value.trim();
  return formatSwedishPhone(value);
}

export function validateSwedishPhone(
  value: string,
  opts?: { required?: boolean }
): SwedishFieldResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return emptyResult(opts?.required, "Ange ett giltigt telefonnummer.");
  }
  if (!isSwedishPhoneFormat(trimmed)) {
    return { ok: false, code: "invalid", message: "Ange ett giltigt telefonnummer." };
  }
  const formatted = formatSwedishPhone(trimmed);
  return ok(formatted, formatted);
}

export const swedishPhoneInputProps = {
  type: "tel" as const,
  inputMode: "tel" as const,
  autoComplete: "tel" as const,
  placeholder: "070-123 45 67",
};

/* ------------------------------------ E-post ---------------------------------- */

export function normalizeSwedishEmail(value: string): string {
  return value.trim();
}

export function validateSwedishEmail(
  value: string,
  opts?: { required?: boolean; emptyMessage?: string }
): SwedishFieldResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return emptyResult(opts?.required, opts?.emptyMessage ?? "Ange en giltig e-postadress.");
  }
  if (!looksLikeEmail(trimmed)) {
    return { ok: false, code: "invalid", message: "Ange en giltig e-postadress." };
  }
  return ok(trimmed, trimmed);
}

export const swedishEmailInputProps = {
  type: "email" as const,
  inputMode: "email" as const,
  autoComplete: "email" as const,
  autoCapitalize: "none" as const,
};

/* ----------------------------- Bankgiro / Plusgiro / OCR ----------------------------- */

export function normalizeSwedishBankgiro(value: string): string {
  return normalizeBankgiro(value);
}

export function formatSwedishBankgiro(value: string): string {
  return normalizeBankgiro(value);
}

export function validateSwedishBankgiro(
  value: string,
  opts?: { required?: boolean }
): SwedishFieldResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return emptyResult(opts?.required, "Ange ett bankgiro.");
  }
  if (!isBankgiroFormat(trimmed)) {
    return { ok: false, code: "invalid", message: "Ange ett giltigt Bankgiro med 7–8 siffror." };
  }
  const normalized = normalizeBankgiro(trimmed);
  return ok(normalized, normalized);
}

export function normalizeSwedishPlusgiro(value: string): string {
  return normalizePlusgiro(value);
}

export function formatSwedishPlusgiro(value: string): string {
  return normalizePlusgiro(value);
}

export function validateSwedishPlusgiro(
  value: string,
  opts?: { required?: boolean }
): SwedishFieldResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return emptyResult(opts?.required, "Ange ett plusgiro.");
  }
  if (!isPlusgiroFormat(trimmed)) {
    return { ok: false, code: "invalid", message: "Ange ett giltigt plusgiro." };
  }
  const normalized = normalizePlusgiro(trimmed);
  return ok(normalized, normalized);
}

/**
 * OCR/referens: ta bort mellanslag och bindestreck, ändra inte siffrornas
 * betydelse. Kontrollsiffra valideras där den redan hör hemma (matchning).
 */
export function normalizeSwedishOcr(value: string): string {
  return value.trim().replace(/[\s-]+/g, "");
}

export function formatSwedishOcr(value: string): string {
  return normalizeSwedishOcr(value);
}

export function validateSwedishOcr(
  value: string,
  opts?: { required?: boolean }
): SwedishFieldResult {
  const normalized = normalizeSwedishOcr(value);
  if (!normalized) {
    return emptyResult(opts?.required, "Ange OCR-nummer.");
  }
  if (!/^\d{2,25}$/.test(normalized)) {
    return { ok: false, code: "invalid", message: "Ange ett giltigt OCR-nummer." };
  }
  return ok(normalized, normalized);
}

export const swedishBankgiroInputProps = {
  inputMode: "numeric" as const,
  autoComplete: "off" as const,
  placeholder: "5678-1234",
};

export const swedishPlusgiroInputProps = {
  inputMode: "numeric" as const,
  autoComplete: "off" as const,
  placeholder: "123456-1",
};

export const swedishOcrInputProps = {
  inputMode: "numeric" as const,
  autoComplete: "off" as const,
  placeholder: "OCR-nummer",
};

/* ----------------------------------- Belopp ----------------------------------- */

export function swedishAmountError(
  raw: string,
  opts?: { min?: number; required?: boolean; emptyMessage?: string; minMessage?: string }
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return opts?.required ? (opts.emptyMessage ?? "Ange ett belopp.") : null;
  }
  const n = Number(trimmed.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return "Ange ett giltigt belopp.";
  const min = opts?.min ?? 0;
  if (n < min || (min === 0 && n <= 0 && opts?.min === undefined && opts?.required)) {
    return opts?.minMessage ?? (min > 0 ? `Ange ett belopp på minst ${min}.` : "Ange ett belopp större än 0.");
  }
  if (opts?.min !== undefined && n < opts.min) {
    return opts.minMessage ?? (opts.min > 0 ? `Ange ett belopp på minst ${opts.min}.` : "Ange ett belopp större än 0.");
  }
  return null;
}
