import { db, save } from "../store";
import type { CompanySettings, VatRate } from "../types";
import { logActivity } from "./activity";
import { collectSellerBlockers, type IssueBlocker } from "../invoices/validate";
import {
  formatVatNumber,
  isBankgiroFormat,
  isBicFormat,
  isIbanFormat,
  isOrgnrFormat,
  isPlusgiroFormat,
  isVatNumberFormat,
  normalizeBankgiro,
  normalizeBic,
  normalizeIban,
  normalizeOrgnr,
  normalizePlusgiro,
} from "../invoices/formats";

export function getBusinessProfile(): CompanySettings {
  return db().settings;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailFormat(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Vart nya sajtförfrågningar mejlas. Följer företagets e-post tills en annan adress sparas. */
export function getInquiryNotificationEmail(profile: CompanySettings = db().settings): string {
  return (profile.inquiryNotificationEmail?.trim() || profile.email).trim();
}

export type BusinessProfileInput = Pick<
  CompanySettings,
  | "name"
  | "orgNumber"
  | "vatNumber"
  | "email"
  | "inquiryNotificationEmail"
  | "phone"
  | "websiteUrl"
  | "address"
  | "postalCode"
  | "city"
  | "sate"
  | "country"
  | "bankgiro"
  | "plusgiro"
  | "bankAccount"
  | "iban"
  | "bic"
  | "logoInitials"
  | "logoDataUrl"
>;

export interface InvoiceDefaults {
  paymentTermsDays: number;
  lateInterestRate: number;
  quoteValidityDays: number;
  defaultVatRate: VatRate;
}

const VAT_RATES: VatRate[] = [0, 6, 12, 25];

export function getInvoiceDefaults(): InvoiceDefaults {
  const s = db().settings;
  return {
    paymentTermsDays: s.paymentTermsDays,
    lateInterestRate: s.lateInterestRate,
    quoteValidityDays: s.quoteValidityDays ?? 30,
    defaultVatRate: s.defaultVatRate ?? 25,
  };
}

export type CompanySettingsInput = BusinessProfileInput & InvoiceDefaults;

function initialsFromName(name: string): string {
  const parts = name
    .replace(/\bAB\b/gi, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "FÖ";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}

function optional(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function validateProfile(input: BusinessProfileInput): string[] {
  const errors: string[] = [];
  if (!input.name.trim()) errors.push("Företagsnamn saknas.");
  if (input.orgNumber.trim() && !isOrgnrFormat(input.orgNumber)) {
    errors.push("Organisationsnumret ska anges som NNNNNN-NNNN (10 siffror). Vi kontrollerar inte mot Skatteverket.");
  }
  if (input.vatNumber.trim() && !isVatNumberFormat(input.vatNumber)) {
    errors.push("Momsregistreringsnumret ska anges som SE följt av 12 siffror.");
  }
  if (input.bankgiro.trim() && !isBankgiroFormat(input.bankgiro)) {
    errors.push("Bankgiro ska anges som NNN-NNNN eller NNNN-NNNN.");
  }
  if (input.plusgiro?.trim() && !isPlusgiroFormat(input.plusgiro)) {
    errors.push("PlusGiro ska anges med 2–8 siffror, t.ex. 123456-1.");
  }
  if (input.iban?.trim() && !isIbanFormat(input.iban)) {
    errors.push("IBAN ska anges som landskod plus kontonummer, t.ex. SE följt av 22 tecken.");
  }
  if (input.bic?.trim() && !isBicFormat(input.bic)) {
    errors.push("BIC/SWIFT ska vara 8 eller 11 tecken.");
  }
  if (input.logoDataUrl && !input.logoDataUrl.startsWith("data:image/")) {
    errors.push("Logotypen måste vara en bild.");
  }
  const notify = input.inquiryNotificationEmail?.trim();
  if (notify && !isEmailFormat(notify)) {
    errors.push("Ange en giltig e-postadress för förfrågningar.");
  }
  return errors;
}

function applyProfile(s: CompanySettings, input: BusinessProfileInput): void {
  s.name = input.name.trim();
  s.orgNumber = input.orgNumber.trim() ? normalizeOrgnr(input.orgNumber) : "";
  s.vatNumber = input.vatNumber.trim().toUpperCase().replace(/\s/g, "");
  s.email = input.email.trim();
  const notify = optional(input.inquiryNotificationEmail);
  s.inquiryNotificationEmail =
    notify && notify.toLowerCase() !== s.email.toLowerCase() ? notify : undefined;
  s.phone = input.phone.trim();
  s.websiteUrl = optional(input.websiteUrl);
  s.address = input.address.trim();
  s.postalCode = input.postalCode.trim();
  s.city = input.city.trim();
  s.sate = optional(input.sate);
  s.country = optional(input.country) || "Sverige";
  s.bankgiro = input.bankgiro.trim() ? normalizeBankgiro(input.bankgiro) : "";
  s.plusgiro = input.plusgiro?.trim() ? normalizePlusgiro(input.plusgiro) : undefined;
  s.bankAccount = optional(input.bankAccount);
  s.iban = input.iban?.trim() ? normalizeIban(input.iban) : undefined;
  s.bic = input.bic?.trim() ? normalizeBic(input.bic) : undefined;
  s.logoDataUrl = optional(input.logoDataUrl);
  s.logoInitials = input.logoInitials.trim() || initialsFromName(s.name);
}

function validateDefaults(input: InvoiceDefaults): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(input.paymentTermsDays) || input.paymentTermsDays < 1) {
    errors.push("Betalningsvillkor måste vara minst 1 dag.");
  }
  if (!Number.isFinite(input.lateInterestRate) || input.lateInterestRate < 0) {
    errors.push("Dröjsmålsränta kan inte vara negativ.");
  }
  if (!Number.isFinite(input.quoteValidityDays) || input.quoteValidityDays < 1) {
    errors.push("Offertens giltighetstid måste vara minst 1 dag.");
  }
  if (!VAT_RATES.includes(input.defaultVatRate)) {
    errors.push("Vanlig momssats måste vara 0, 6, 12 eller 25 %.");
  }
  return errors;
}

export function updateBusinessProfile(input: BusinessProfileInput): CompanySettings {
  const errors = validateProfile(input);
  if (errors.length) throw new Error(errors.join(" "));
  const s = db().settings;
  applyProfile(s, input);
  logActivity("Företagsuppgifterna uppdaterades.");
  save();
  return s;
}

export function updateInvoiceDefaults(input: InvoiceDefaults): InvoiceDefaults {
  const errors = validateDefaults(input);
  if (errors.length) throw new Error(errors.join(" "));
  const s = db().settings;
  s.paymentTermsDays = Math.round(input.paymentTermsDays);
  s.lateInterestRate = input.lateInterestRate;
  s.quoteValidityDays = Math.round(input.quoteValidityDays);
  s.defaultVatRate = input.defaultVatRate;
  logActivity("Standardval för offerter och fakturor uppdaterades.");
  save();
  return getInvoiceDefaults();
}

/** Sparar både företagsuppgifter och standardval i ett steg (samma källa). */
export function updateCompanySettings(input: CompanySettingsInput): CompanySettings {
  const errors = [...validateProfile(input), ...validateDefaults(input)];
  if (errors.length) throw new Error(errors.join(" "));
  const s = db().settings;
  applyProfile(s, input);
  s.paymentTermsDays = Math.round(input.paymentTermsDays);
  s.lateInterestRate = input.lateInterestRate;
  s.quoteValidityDays = Math.round(input.quoteValidityDays);
  s.defaultVatRate = input.defaultVatRate;
  logActivity("Inställningarna uppdaterades.");
  save();
  return s;
}

export function suggestedVatNumber(orgNumber: string): string {
  return formatVatNumber(orgNumber);
}

export function billingReadiness(profile: CompanySettings = db().settings): {
  ready: boolean;
  missingCount: number;
  blockers: IssueBlocker[];
} {
  const blockers = collectSellerBlockers(profile);
  return { ready: blockers.length === 0, missingCount: blockers.length, blockers };
}

export function connectedBankSummary(): { label: string; href: string } | null {
  const account = db().bankAccounts[0];
  if (!account) return null;
  return { label: `${account.name} · ${account.accountNumber}`, href: "/ekonomi?flik=bank" };
}

const PATCHABLE: (keyof CompanySettingsInput)[] = [
  "name",
  "orgNumber",
  "vatNumber",
  "email",
  "phone",
  "websiteUrl",
  "address",
  "postalCode",
  "city",
  "sate",
  "country",
  "bankgiro",
  "plusgiro",
  "bankAccount",
  "iban",
  "bic",
  "paymentTermsDays",
  "lateInterestRate",
  "quoteValidityDays",
  "defaultVatRate",
];

export const SETTINGS_FIELD_LABELS: Record<string, string> = {
  name: "Företagsnamn",
  orgNumber: "Organisationsnummer",
  vatNumber: "Momsregistreringsnummer",
  email: "E-post",
  inquiryNotificationEmail: "Skicka nya förfrågningar till",
  phone: "Telefon",
  websiteUrl: "Webbplats",
  address: "Adress",
  postalCode: "Postnummer",
  city: "Ort",
  sate: "Säte",
  country: "Land",
  bankgiro: "Bankgiro",
  plusgiro: "PlusGiro",
  bankAccount: "Bankkonto",
  iban: "IBAN",
  bic: "BIC",
  paymentTermsDays: "Betalningsvillkor (dagar)",
  lateInterestRate: "Dröjsmålsränta (%)",
  quoteValidityDays: "Offertens giltighetstid (dagar)",
  defaultVatRate: "Vanlig momssats",
};

export function applyBusinessProfilePatch(patch: Record<string, string | number | null>): CompanySettings {
  const s = db().settings;
  const next: CompanySettingsInput = {
    name: s.name,
    orgNumber: s.orgNumber,
    vatNumber: s.vatNumber,
    email: s.email,
    inquiryNotificationEmail: s.inquiryNotificationEmail,
    phone: s.phone,
    websiteUrl: s.websiteUrl,
    address: s.address,
    postalCode: s.postalCode,
    city: s.city,
    sate: s.sate,
    country: s.country,
    bankgiro: s.bankgiro,
    plusgiro: s.plusgiro,
    bankAccount: s.bankAccount,
    iban: s.iban,
    bic: s.bic,
    logoInitials: s.logoInitials,
    logoDataUrl: s.logoDataUrl,
    paymentTermsDays: s.paymentTermsDays,
    lateInterestRate: s.lateInterestRate,
    quoteValidityDays: s.quoteValidityDays ?? 30,
    defaultVatRate: s.defaultVatRate ?? 25,
  };
  for (const key of PATCHABLE) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (key === "paymentTermsDays" || key === "lateInterestRate" || key === "quoteValidityDays" || key === "defaultVatRate") {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) throw new Error(`Ogiltigt värde för ${SETTINGS_FIELD_LABELS[key] ?? key}.`);
      if (key === "defaultVatRate") next.defaultVatRate = n as VatRate;
      else if (key === "paymentTermsDays") next.paymentTermsDays = n;
      else if (key === "lateInterestRate") next.lateInterestRate = n;
      else next.quoteValidityDays = n;
    } else if (key === "name") next.name = String(value ?? "");
    else if (key === "orgNumber") next.orgNumber = String(value ?? "");
    else if (key === "vatNumber") next.vatNumber = String(value ?? "");
    else if (key === "email") next.email = String(value ?? "");
    else if (key === "phone") next.phone = String(value ?? "");
    else if (key === "websiteUrl") next.websiteUrl = String(value ?? "");
    else if (key === "address") next.address = String(value ?? "");
    else if (key === "postalCode") next.postalCode = String(value ?? "");
    else if (key === "city") next.city = String(value ?? "");
    else if (key === "sate") next.sate = String(value ?? "");
    else if (key === "country") next.country = String(value ?? "");
    else if (key === "bankgiro") next.bankgiro = String(value ?? "");
    else if (key === "plusgiro") next.plusgiro = String(value ?? "");
    else if (key === "bankAccount") next.bankAccount = String(value ?? "");
    else if (key === "iban") next.iban = String(value ?? "");
    else if (key === "bic") next.bic = String(value ?? "");
  }
  return updateCompanySettings(next);
}
