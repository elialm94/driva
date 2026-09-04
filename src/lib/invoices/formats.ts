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

/** Alias – kanoniskt namn för delad validering. */
export const normalizeSwedishOrganizationNumber = normalizeOrgnr;
export const formatSwedishOrganizationNumber = formatOrgnr;

export function isOrgnrFormat(value: string): boolean {
  return ORGNR_DIGITS.test(digitsOnly(value));
}

export function isVatNumberFormat(value: string): boolean {
  return VAT_SE.test(value.trim().toUpperCase().replace(/\s/g, ""));
}

/**
 * Grov rimlighetskontroll för utländska momsnummer: landskod + 2–20 tecken.
 * Formaten skiljer sig per land och vi kontrollerar inget mot VIES – därför
 * en bred kontroll som bara fångar uppenbart skräp.
 */
const VAT_FOREIGN = /^[A-Z]{2}[A-Z0-9]{2,20}$/;

export function isForeignVatNumberFormat(value: string): boolean {
  return VAT_FOREIGN.test(normalizeVatNumber(value));
}

export function vatMatchesOrgnr(vatNumber: string, orgNumber: string): boolean {
  const derived = deriveSwedishVatNumber(orgNumber);
  if (!derived) return false;
  return normalizeVatNumber(vatNumber) === derived;
}

export function normalizeVatNumber(value: string): string {
  return value.trim().toUpperCase().replace(/\s/g, "");
}

/**
 * ENDA vägen till ett svenskt momsreg.nr: SE + organisationsnummerets 10
 * siffror + 01. Organisationsnumret är sanningen – användaren skriver aldrig
 * momsnumret själv, så de två kan inte glida isär.
 *
 * Tom sträng när organisationsnumret inte är 10 siffror: ett halvskrivet
 * org.nr ska aldrig visas som ett halvt momsnummer.
 *
 * Härledningen är syntaktisk. Den säger INTE att företaget är momsregistrerat
 * – det avgör Skatteverket, och Driva kontrollerar inget mot dem.
 */
export function deriveSwedishVatNumber(orgNumber: string): string {
  const org = digitsOnly(orgNumber);
  if (org.length !== 10) return "";
  return `SE${org}01`;
}

/** Tomt/utelämnat land = Sverige (samma default som CompanySettings.country). */
const SWEDISH_COUNTRY_NAMES = new Set(["", "sverige", "sweden", "se", "swe"]);

export function isSwedishCountry(country?: string | null): boolean {
  return SWEDISH_COUNTRY_NAMES.has((country ?? "").trim().toLowerCase());
}

export interface VatNumberSource {
  orgNumber: string;
  vatNumber?: string;
  country?: string;
}

/**
 * Momsreg.nr för ett företag. Svenska företag: härlett ur org.nr. Utländska:
 * det sparade värdet oförändrat – utländska momsnummerformat varierar och
 * ska inte tvingas in i den svenska mallen.
 */
export function companyVatNumber(company: VatNumberSource): string {
  if (isSwedishCountry(company.country)) return deriveSwedishVatNumber(company.orgNumber);
  return normalizeVatNumber(company.vatNumber ?? "");
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

/** Progressiv visning: 11624 → 116 24. */
export function formatPostalCode(value: string): string {
  const d = digitsOnly(value).slice(0, 5);
  if (d.length <= 3) return d;
  return `${d.slice(0, 3)} ${d.slice(3)}`;
}

export function normalizePostalCode(value: string): string {
  const d = digitsOnly(value);
  if (d.length === 5) return formatPostalCode(d);
  return value.trim();
}

export function isPostalCodeFormat(value: string): boolean {
  return digitsOnly(value).length === 5;
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
