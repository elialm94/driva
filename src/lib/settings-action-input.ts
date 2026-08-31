import type { VatRate } from "./types";
import type { CompanySettingsInput } from "./services/settings";

/**
 * React Flight-token för `undefined` i server-action-argument.
 * Får aldrig skickas som sträng – då tror valideringen att logotypen är en URL.
 */
export const FLIGHT_UNDEFINED = "$undefined";

export function isFlightUndefined(value: unknown): boolean {
  return value === undefined || value === FLIGHT_UNDEFINED;
}

/** Tomt / Flight-undefined → null (aldrig `undefined` över action-gränsen). */
export function optionalActionText(value: unknown): string | null {
  if (isFlightUndefined(value) || value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

export interface SettingsFormPayload {
  name: string;
  orgNumber: string;
  vatNumber: string;
  email: string;
  websiteNotificationEmail: string;
  phone: string;
  websiteUrl: string;
  address: string;
  postalCode: string;
  city: string;
  sate: string;
  country: string;
  bankgiro: string;
  plusgiro: string;
  bankAccount: string;
  iban: string;
  bic: string;
  payerBankName: string;
  payerIban: string;
  payerBic: string;
  logoInitials: string;
  logoDataUrl: string;
  paymentTermsDays: number;
  lateInterestRate: number;
  quoteValidityDays: number;
  defaultVatRate: VatRate;
  defaultHourlyRate: string;
}

/**
 * Klientpayload till `updateCompanySettingsAction`.
 * Inga `undefined`-fält – Flight serialiserar dem som "$undefined".
 */
export function buildCompanySettingsActionInput(form: SettingsFormPayload): CompanySettingsInput {
  const hourlyRaw = form.defaultHourlyRate.trim();
  return {
    name: form.name,
    orgNumber: form.orgNumber,
    vatNumber: form.vatNumber,
    email: form.email,
    websiteNotificationEmail: form.websiteNotificationEmail,
    phone: form.phone,
    websiteUrl: form.websiteUrl,
    address: form.address,
    postalCode: form.postalCode,
    city: form.city,
    sate: form.sate,
    country: form.country,
    bankgiro: form.bankgiro,
    plusgiro: form.plusgiro,
    bankAccount: form.bankAccount,
    iban: form.iban,
    bic: form.bic,
    payerBankName: form.payerBankName,
    payerIban: form.payerIban,
    payerBic: form.payerBic,
    logoInitials: form.logoInitials,
    logoDataUrl: optionalActionText(form.logoDataUrl),
    paymentTermsDays: Number(form.paymentTermsDays),
    lateInterestRate: Number(form.lateInterestRate),
    quoteValidityDays: Number(form.quoteValidityDays),
    defaultVatRate: form.defaultVatRate,
    defaultHourlyRate: hourlyRaw === "" ? null : Number(hourlyRaw.replace(",", ".")),
  };
}

function cleanTextField<K extends keyof CompanySettingsInput>(
  input: CompanySettingsInput,
  key: K
): void {
  const value = input[key];
  if (typeof value === "string" && value === FLIGHT_UNDEFINED) {
    (input as unknown as Record<string, unknown>)[key as string] = null;
  }
}

/** Server: Flight-läckor och tomma valfria fält blir null, inte "$undefined". */
export function normalizeCompanySettingsInput(input: CompanySettingsInput): CompanySettingsInput {
  const next: CompanySettingsInput = { ...input };
  const textKeys: (keyof CompanySettingsInput)[] = [
    "name",
    "orgNumber",
    "vatNumber",
    "email",
    "websiteNotificationEmail",
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
    "logoInitials",
    "logoDataUrl",
  ];
  for (const key of textKeys) cleanTextField(next, key);
  if (isFlightUndefined(next.defaultHourlyRate) || next.defaultHourlyRate === (FLIGHT_UNDEFINED as unknown)) {
    next.defaultHourlyRate = null;
  }
  if (isFlightUndefined(next.logoDataUrl)) next.logoDataUrl = null;
  return next;
}
