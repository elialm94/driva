import type { VatRate } from "./types";
import {
  isBankgiroFormat,
  isBicFormat,
  isIbanFormat,
  isOrgnrFormat,
  isPlusgiroFormat,
  isVatNumberFormat,
} from "./invoices/formats";

/**
 * Ren fältvalidering för inställningarna. Samma källa används av
 * updateCompanySettings (servern) och SettingsForm (realtid i klienten),
 * så meddelandena kan aldrig glida isär.
 */

export type SettingsTab = "foretag" | "fakturering" | "standardval";

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
  vatNumber: string;
  email?: string;
  inquiryNotificationEmail?: string;
  bankgiro: string;
  plusgiro?: string;
  iban?: string;
  bic?: string;
  logoDataUrl?: string;
}

export interface SettingsDefaultsFields {
  paymentTermsDays: number;
  lateInterestRate: number;
  quoteValidityDays: number;
  defaultVatRate: VatRate;
}

export function settingsProfileFieldErrors(input: SettingsProfileFields): SettingsFieldError[] {
  const errors: SettingsFieldError[] = [];
  if (!input.name.trim()) {
    errors.push({ field: "name", label: "Företagsnamn", message: "Företagsnamn saknas.", tab: "foretag" });
  }
  if (input.orgNumber.trim() && !isOrgnrFormat(input.orgNumber)) {
    errors.push({
      field: "orgNumber",
      label: "Organisationsnummer",
      message: "Organisationsnumret ska anges som NNNNNN-NNNN (10 siffror). Vi kontrollerar inte mot Skatteverket.",
      tab: "foretag",
    });
  }
  if (input.vatNumber.trim() && !isVatNumberFormat(input.vatNumber)) {
    errors.push({
      field: "vatNumber",
      label: "Momsregistreringsnummer",
      message: "Momsregistreringsnumret ska anges som SE följt av 12 siffror.",
      tab: "foretag",
    });
  }
  if (input.email?.trim() && !isEmailFormat(input.email)) {
    errors.push({
      field: "email",
      label: "E-post",
      message: "Ange e-postadressen som namn@företag.se.",
      tab: "foretag",
    });
  }
  const notify = input.inquiryNotificationEmail?.trim();
  if (notify && !isEmailFormat(notify)) {
    errors.push({
      field: "inquiryNotificationEmail",
      label: "E-post för förfrågningar",
      message: "Ange en giltig e-postadress för förfrågningar.",
      tab: "foretag",
    });
  }
  if (input.logoDataUrl && !input.logoDataUrl.startsWith("data:image/")) {
    errors.push({ field: "logoDataUrl", label: "Logotyp", message: "Logotypen måste vara en bild.", tab: "foretag" });
  }
  if (input.bankgiro.trim() && !isBankgiroFormat(input.bankgiro)) {
    errors.push({
      field: "bankgiro",
      label: "Bankgiro",
      message: "Bankgiro ska anges som NNN-NNNN eller NNNN-NNNN.",
      tab: "fakturering",
    });
  }
  if (input.plusgiro?.trim() && !isPlusgiroFormat(input.plusgiro)) {
    errors.push({
      field: "plusgiro",
      label: "PlusGiro",
      message: "PlusGiro ska anges med 2–8 siffror, t.ex. 123456-1.",
      tab: "fakturering",
    });
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
  return errors;
}

export function settingsDefaultsFieldErrors(input: SettingsDefaultsFields): SettingsFieldError[] {
  const errors: SettingsFieldError[] = [];
  if (!Number.isFinite(input.paymentTermsDays) || input.paymentTermsDays < 1) {
    errors.push({
      field: "paymentTermsDays",
      label: "Betalningsvillkor",
      message: "Betalningsvillkor måste vara minst 1 dag.",
      tab: "standardval",
    });
  }
  if (!Number.isFinite(input.lateInterestRate) || input.lateInterestRate < 0) {
    errors.push({
      field: "lateInterestRate",
      label: "Dröjsmålsränta",
      message: "Dröjsmålsränta kan inte vara negativ.",
      tab: "standardval",
    });
  }
  if (!Number.isFinite(input.quoteValidityDays) || input.quoteValidityDays < 1) {
    errors.push({
      field: "quoteValidityDays",
      label: "Offertens giltighetstid",
      message: "Offertens giltighetstid måste vara minst 1 dag.",
      tab: "standardval",
    });
  }
  if (!SETTINGS_VAT_RATES.includes(input.defaultVatRate)) {
    errors.push({
      field: "defaultVatRate",
      label: "Vanlig momssats",
      message: "Vanlig momssats måste vara 0, 6, 12 eller 25 %.",
      tab: "standardval",
    });
  }
  return errors;
}

export function settingsFieldErrors(input: SettingsProfileFields & SettingsDefaultsFields): SettingsFieldError[] {
  return [...settingsProfileFieldErrors(input), ...settingsDefaultsFieldErrors(input)];
}
