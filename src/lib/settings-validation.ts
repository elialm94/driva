import type { VatRate } from "./types";
import { DEFAULT_QUOTE_TERMS_MAX } from "./standard-quote-terms";
import {
  isBicFormat,
  isForeignVatNumberFormat,
  isIbanFormat,
  isSwedishCountry,
} from "./invoices/formats";
import {
  validateSwedishBankgiro,
  validateSwedishOrganizationNumber,
  validateSwedishPhone,
  validateSwedishPlusgiro,
  validateSwedishPostalCode,
} from "./validation";

/**
 * Ren fältvalidering för inställningarna. Samma källa används av
 * updateCompanySettings (servern) och SettingsForm (realtid i klienten),
 * så meddelandena kan aldrig glida isär.
 */

export type SettingsTab = "foretag" | "fakturering";

export interface SettingsFieldError {
  /** Nyckel i formuläret; fält-id i UI:t är `installningar-${field}`. */
  field: string;
  /** Kort etikett för summeringslistan, t.ex. "Organisationsnummer". */
  label: string;
  message: string;
  tab: SettingsTab;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailFormat(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export const SETTINGS_VAT_RATES: VatRate[] = [0, 6, 12, 25];

export interface SettingsProfileFields {
  name: string;
  orgNumber: string;
  /** Härlett för svenska företag – bara utländska företag skriver in det själva. */
  vatNumber: string;
  /** Tomt/utelämnat = Sverige. Styr om momsreg.nr härleds eller skrivs in. */
  country?: string;
  email?: string;
  websiteNotificationEmail?: string;
  phone?: string;
  postalCode?: string;
  bankgiro: string;
  plusgiro?: string;
  iban?: string;
  bic?: string;
  /** Företagets BETALKONTO (utbetalningar/bankfiler) – skilt från mottagaruppgifterna ovan. */
  payerBankName?: string;
  payerIban?: string;
  payerBic?: string;
  logoDataUrl?: string | null;
}

export interface SettingsDefaultsFields {
  paymentTermsDays: number;
  lateInterestRate: number;
  quoteValidityDays: number;
  defaultVatRate: VatRate;
  /** Tomt / saknas = inte satt. Annars hela kronor. */
  defaultHourlyRate?: number | string | null;
  /** Tomt = fallback till STANDARD_TERMS på nya offerter. */
  defaultQuoteTerms?: string | null;
}

/** Tolkar valfritt timpris. Tomt och 0 = inte satt. */
export function parseOptionalHourlyRate(
  value: unknown
): { ok: true; value?: number } | { ok: false; message: string } {
  if (value == null || String(value).trim() === "") return { ok: true };
  const raw = typeof value === "number" ? value : Number(String(value).trim().replace(",", ".").replace(/\s/g, ""));
  if (!Number.isFinite(raw)) {
    return { ok: false, message: "Timpriset ska anges i hela kronor, t.ex. 650." };
  }
  const n = Math.round(raw);
  if (n < 0) return { ok: false, message: "Timpriset kan inte vara negativt." };
  if (n === 0) return { ok: true };
  if (n > 1_000_000) return { ok: false, message: "Timpriset är orimligt högt." };
  return { ok: true, value: n };
}

export function settingsProfileFieldErrors(input: SettingsProfileFields): SettingsFieldError[] {
  const errors: SettingsFieldError[] = [];
  if (!input.name.trim()) {
    errors.push({ field: "name", label: "Företagsnamn", message: "Företagsnamn saknas.", tab: "foretag" });
  }
  if (input.orgNumber.trim()) {
    const org = validateSwedishOrganizationNumber(input.orgNumber);
    if (!org.ok) {
      errors.push({
        field: "orgNumber",
        label: "Organisationsnummer",
        message: org.message,
        tab: "foretag",
      });
    }
  }
  // Svenska företag skriver aldrig momsreg.nr själva – det härleds ur org.nr
  // (companyVatNumber), så det finns inget eget fält att validera. Utländska
  // företag har ett manuellt fält, men utländska momsnummerformat varierar:
  // vi kräver bara att det inte är tomt-med-blanktecken.
  if (!isSwedishCountry(input.country) && input.vatNumber.trim() && !isForeignVatNumberFormat(input.vatNumber)) {
    errors.push({
      field: "vatNumber",
      label: "Momsregistreringsnummer",
      message: "Ange momsregistreringsnumret med landskod, t.ex. DE123456789.",
      tab: "foretag",
    });
  }
  if (input.email?.trim() && !isEmailFormat(input.email)) {
    errors.push({
      field: "email",
      label: "E-post",
      message: "Ange en giltig e-postadress.",
      tab: "foretag",
    });
  }
  if (input.phone?.trim()) {
    const phone = validateSwedishPhone(input.phone);
    if (!phone.ok) {
      errors.push({ field: "phone", label: "Telefon", message: phone.message, tab: "foretag" });
    }
  }
  if (input.postalCode?.trim()) {
    const postal = validateSwedishPostalCode(input.postalCode);
    if (!postal.ok) {
      errors.push({ field: "postalCode", label: "Postnummer", message: postal.message, tab: "foretag" });
    }
  }
  const notify = input.websiteNotificationEmail?.trim();
  if (notify && !isEmailFormat(notify)) {
    errors.push({
      field: "websiteNotificationEmail",
      label: "E-post för uppdrag från hemsidan",
      message: "Ange en giltig e-postadress för nya uppdrag från hemsidan.",
      tab: "foretag",
    });
  }
  if (input.logoDataUrl && input.logoDataUrl !== "$undefined" && !input.logoDataUrl.startsWith("data:image/")) {
    errors.push({ field: "logoDataUrl", label: "Logotyp", message: "Logotypen måste vara en bild.", tab: "foretag" });
  }
  // Servergräns (klienten komprimerar redan): en logotyp ska aldrig kunna
  // blåsa upp företagstillståndet – gäller alla, inte bara demon.
  if (input.logoDataUrl && input.logoDataUrl.length > 1_000_000) {
    errors.push({
      field: "logoDataUrl",
      label: "Logotyp",
      message: "Logotypen är för stor. Välj en mindre bild.",
      tab: "foretag",
    });
  }
  if (input.bankgiro.trim()) {
    const bg = validateSwedishBankgiro(input.bankgiro);
    if (!bg.ok) {
      errors.push({ field: "bankgiro", label: "Bankgiro", message: bg.message, tab: "fakturering" });
    }
  }
  if (input.plusgiro?.trim()) {
    const pg = validateSwedishPlusgiro(input.plusgiro);
    if (!pg.ok) {
      errors.push({ field: "plusgiro", label: "PlusGiro", message: pg.message, tab: "fakturering" });
    }
  }
  if (input.iban?.trim() && !isIbanFormat(input.iban)) {
    errors.push({
      field: "iban",
      label: "IBAN",
      message: "IBAN ska anges som landskod plus kontonummer, t.ex. SE följt av 22 tecken.",
      tab: "fakturering",
    });
  }
  if (input.bic?.trim() && !isBicFormat(input.bic)) {
    errors.push({ field: "bic", label: "BIC/SWIFT", message: "BIC/SWIFT ska vara 8 eller 11 tecken.", tab: "fakturering" });
  }
  if (input.payerIban?.trim() && !isIbanFormat(input.payerIban)) {
    errors.push({
      field: "payerIban",
      label: "Betalkonto (IBAN)",
      message: "Betalkontots IBAN ska anges som landskod plus kontonummer, t.ex. SE följt av 22 tecken.",
      tab: "fakturering",
    });
  }
  if (input.payerBic?.trim() && !isBicFormat(input.payerBic)) {
    errors.push({
      field: "payerBic",
      label: "Betalkonto (BIC)",
      message: "Betalkontots BIC/SWIFT ska vara 8 eller 11 tecken.",
      tab: "fakturering",
    });
  }
  return errors;
}

export function settingsDefaultsFieldErrors(input: SettingsDefaultsFields): SettingsFieldError[] {
  const errors: SettingsFieldError[] = [];
  if (!Number.isFinite(input.paymentTermsDays) || input.paymentTermsDays < 1) {
    errors.push({
      field: "paymentTermsDays",
      label: "Betalningsvillkor",
      message: "Betalningsvillkor måste vara minst 1 dag.",
      tab: "fakturering",
    });
  }
  if (!Number.isFinite(input.lateInterestRate) || input.lateInterestRate < 0) {
    errors.push({
      field: "lateInterestRate",
      label: "Dröjsmålsränta",
      message: "Dröjsmålsränta kan inte vara negativ.",
      tab: "fakturering",
    });
  }
  if (!Number.isFinite(input.quoteValidityDays) || input.quoteValidityDays < 1) {
    errors.push({
      field: "quoteValidityDays",
      label: "Offertens giltighetstid",
      message: "Offertens giltighetstid måste vara minst 1 dag.",
      tab: "fakturering",
    });
  }
  if (!SETTINGS_VAT_RATES.includes(input.defaultVatRate)) {
    errors.push({
      field: "defaultVatRate",
      label: "Vanlig momssats",
      message: "Vanlig momssats måste vara 0, 6, 12 eller 25 %.",
      tab: "fakturering",
    });
  }
  const hourly = parseOptionalHourlyRate(input.defaultHourlyRate);
  if (!hourly.ok) {
    errors.push({
      field: "defaultHourlyRate",
      label: "Standard timpris",
      message: hourly.message,
      tab: "fakturering",
    });
  }
  const quoteTerms = input.defaultQuoteTerms ?? "";
  if (quoteTerms.length > DEFAULT_QUOTE_TERMS_MAX) {
    errors.push({
      field: "defaultQuoteTerms",
      label: "Standardvillkor för offerter",
      message: `Standardvillkoren får vara högst ${DEFAULT_QUOTE_TERMS_MAX} tecken.`,
      tab: "fakturering",
    });
  }
  return errors;
}

export function settingsFieldErrors(input: SettingsProfileFields & SettingsDefaultsFields): SettingsFieldError[] {
  return [...settingsProfileFieldErrors(input), ...settingsDefaultsFieldErrors(input)];
}
