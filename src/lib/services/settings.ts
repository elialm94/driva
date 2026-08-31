import { db, save } from "../store";
import type { CompanySettings, VatRate } from "../types";
import { logActivity } from "./activity";
import { collectSellerBlockers, type IssueBlocker } from "../invoices/validate";
import {
  formatVatNumber,
  normalizeBankgiro,
  normalizeBic,
  normalizeIban,
  normalizeOrgnr,
  normalizePlusgiro,
} from "../invoices/formats";
import { normalizeSwedishPhone, normalizeSwedishPostalCode } from "../validation";
import {
  isEmailFormat,
  parseOptionalHourlyRate,
  settingsDefaultsFieldErrors,
  settingsProfileFieldErrors,
} from "../settings-validation";
import {
  resolveWebsiteFormRecipient,
  websiteFormRecipientOverride,
} from "../website-form-recipient";

export function getBusinessProfile(): CompanySettings {
  return db().settings;
}

export { isEmailFormat } from "../settings-validation";
export { resolveWebsiteFormRecipient, websiteFormRecipientOverride } from "../website-form-recipient";

/** Vart nya uppdrag från hemsidans formulär mejlas. Följer företagets e-post tills en annan adress sparas. */
export function getWebsiteNotificationEmail(profile: CompanySettings = db().settings): string {
  return resolveWebsiteFormRecipient(profile, profile);
}

/** Sparar egen mottagare, eller rensar override (tom/samma som företagets e-post). */
export function updateWebsiteFormRecipient(email: string | null | undefined): string {
  const trimmed = email?.trim() ?? "";
  if (trimmed && !isEmailFormat(trimmed)) {
    throw new Error("Ange en giltig e-postadress.");
  }
  const s = db().settings;
  s.websiteNotificationEmail = websiteFormRecipientOverride(
    { websiteNotificationEmail: trimmed },
    s,
  );
  logActivity("Mottagare för webbformuläret uppdaterades.");
  save();
  return resolveWebsiteFormRecipient(s, s);
}

export type BusinessProfileInput = Pick<
  CompanySettings,
  | "name"
  | "orgNumber"
  | "vatNumber"
  | "email"
  | "websiteNotificationEmail"
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
  | "payerBankName"
  | "payerIban"
  | "payerBic"
  | "logoInitials"
  | "logoDataUrl"
>;

export interface InvoiceDefaults {
  paymentTermsDays: number;
  lateInterestRate: number;
  quoteValidityDays: number;
  defaultVatRate: VatRate;
  defaultHourlyRate?: number;
}

export function getInvoiceDefaults(): InvoiceDefaults {
  const s = db().settings;
  const hourly = parseOptionalHourlyRate(s.defaultHourlyRate);
  return {
    paymentTermsDays: s.paymentTermsDays,
    lateInterestRate: s.lateInterestRate,
    quoteValidityDays: s.quoteValidityDays ?? 30,
    defaultVatRate: s.defaultVatRate ?? 25,
    ...(hourly.ok && hourly.value != null ? { defaultHourlyRate: hourly.value } : {}),
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

/** Samma regler som klienten visar i realtid — se settings-validation.ts. */
function validateProfile(input: BusinessProfileInput): string[] {
  return settingsProfileFieldErrors(input).map((e) => e.message);
}

function applyProfile(s: CompanySettings, input: BusinessProfileInput): void {
  s.name = input.name.trim();
  s.orgNumber = input.orgNumber.trim() ? normalizeOrgnr(input.orgNumber) : "";
  s.vatNumber = input.vatNumber.trim().toUpperCase().replace(/\s/g, "");
  s.email = input.email.trim();
  s.websiteNotificationEmail = websiteFormRecipientOverride(
    { websiteNotificationEmail: input.websiteNotificationEmail },
    s,
  );
  s.phone = input.phone.trim() ? normalizeSwedishPhone(input.phone) : "";
  s.websiteUrl = optional(input.websiteUrl);
  s.address = input.address.trim();
  s.postalCode = input.postalCode.trim() ? normalizeSwedishPostalCode(input.postalCode) : "";
  s.city = input.city.trim();
  s.sate = optional(input.sate);
  s.country = optional(input.country) || "Sverige";
  s.bankgiro = input.bankgiro.trim() ? normalizeBankgiro(input.bankgiro) : "";
  s.plusgiro = input.plusgiro?.trim() ? normalizePlusgiro(input.plusgiro) : undefined;
  s.bankAccount = optional(input.bankAccount);
  s.iban = input.iban?.trim() ? normalizeIban(input.iban) : undefined;
  s.bic = input.bic?.trim() ? normalizeBic(input.bic) : undefined;
  // Betalkontot (utbetalningar/bankfiler) – skilt från mottagaruppgifterna ovan.
  s.payerBankName = optional(input.payerBankName);
  s.payerIban = input.payerIban?.trim() ? normalizeIban(input.payerIban) : undefined;
  s.payerBic = input.payerBic?.trim() ? normalizeBic(input.payerBic) : undefined;
  s.logoDataUrl = optional(input.logoDataUrl);
  s.logoInitials = input.logoInitials.trim() || initialsFromName(s.name);
}

function validateDefaults(input: InvoiceDefaults): string[] {
  return settingsDefaultsFieldErrors(input).map((e) => e.message);
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
  applyHourlyRate(s, input.defaultHourlyRate);
  logActivity("Standardvärden för offerter och fakturor uppdaterades.");
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
  applyHourlyRate(s, input.defaultHourlyRate);
  logActivity("Inställningarna uppdaterades.");
  save();
  return s;
}

function applyHourlyRate(s: CompanySettings, raw: unknown): void {
  const parsed = parseOptionalHourlyRate(raw);
  if (!parsed.ok) throw new Error(parsed.message);
  if (parsed.value == null) delete s.defaultHourlyRate;
  else s.defaultHourlyRate = parsed.value;
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
  "payerBankName",
  "payerIban",
  "payerBic",
  "logoDataUrl",
  "paymentTermsDays",
  "lateInterestRate",
  "quoteValidityDays",
  "defaultVatRate",
  "defaultHourlyRate",
];

export const SETTINGS_FIELD_LABELS: Record<string, string> = {
  name: "Företagsnamn",
  orgNumber: "Organisationsnummer",
  vatNumber: "Momsregistreringsnummer",
  email: "E-post",
  websiteNotificationEmail: "Skicka nya uppdrag från hemsidan till",
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
  payerBankName: "Betalkonto – bank",
  payerIban: "Betalkonto – IBAN",
  payerBic: "Betalkonto – BIC",
  paymentTermsDays: "Betalningsvillkor (dagar)",
  lateInterestRate: "Dröjsmålsränta (%)",
  quoteValidityDays: "Offertens giltighetstid (dagar)",
  defaultVatRate: "Vanlig momssats",
  defaultHourlyRate: "Standard timpris (kr)",
};

export function applyBusinessProfilePatch(patch: Record<string, string | number | null>): CompanySettings {
  const s = db().settings;
  const next: CompanySettingsInput = {
    name: s.name,
    orgNumber: s.orgNumber,
    vatNumber: s.vatNumber,
    email: s.email,
    websiteNotificationEmail: s.websiteNotificationEmail,
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
    payerBankName: s.payerBankName,
    payerIban: s.payerIban,
    payerBic: s.payerBic,
    logoInitials: s.logoInitials,
    logoDataUrl: s.logoDataUrl,
    paymentTermsDays: s.paymentTermsDays,
    lateInterestRate: s.lateInterestRate,
    quoteValidityDays: s.quoteValidityDays ?? 30,
    defaultVatRate: s.defaultVatRate ?? 25,
    defaultHourlyRate: s.defaultHourlyRate,
  };
  for (const key of PATCHABLE) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (key === "defaultHourlyRate") {
      if (value == null || value === "") next.defaultHourlyRate = undefined;
      else {
        const n = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(n)) throw new Error(`Ogiltigt värde för ${SETTINGS_FIELD_LABELS[key] ?? key}.`);
        next.defaultHourlyRate = n;
      }
    } else if (key === "paymentTermsDays" || key === "lateInterestRate" || key === "quoteValidityDays" || key === "defaultVatRate") {
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
    else if (key === "payerBankName") next.payerBankName = String(value ?? "");
    else if (key === "payerIban") next.payerIban = String(value ?? "");
    else if (key === "payerBic") next.payerBic = String(value ?? "");
    // Logotypens autospar går den här vägen: null/tom sträng tar bort logotypen.
    else if (key === "logoDataUrl") next.logoDataUrl = value === null ? undefined : String(value);
  }
  return updateCompanySettings(next);
}
