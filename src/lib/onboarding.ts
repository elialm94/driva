/**
 * "Kom igång" – samma företagsuppgifter som Inställningar, tillräckligt
 * för att fakturera. Validering är svensk och delar format-hjälpare med
 * invoices/formats + settings-validation. Ingen separat onboarding-profil.
 */
import type { CompanySettings } from "./types";
import { STANDARD_TERMS } from "./standard-quote-terms";
import {
  formatVatNumber,
  isBankgiroFormat,
  isOrgnrFormat,
  isPlusgiroFormat,
  isPostalCodeFormat,
  isVatNumberFormat,
  normalizeBankgiro,
  normalizeOrgnr,
  normalizePlusgiro,
  normalizePostalCode,
  vatMatchesOrgnr,
} from "./invoices/formats";
import { isEmailFormat } from "./settings-validation";
import { allocateInboundMailSlug } from "./inbox/inbound-slug";

export const ONBOARDING_FIELD_IDS = {
  name: "ob-name",
  companyForm: "ob-company-form",
  orgNumber: "ob-orgnr",
  vatNumber: "ob-vat",
  paymentTiming: "ob-payment-timing",
  address: "ob-address",
  postalCode: "ob-postal",
  city: "ob-city",
  paymentMethod: "ob-payment-method",
  bankgiro: "ob-bankgiro",
  plusgiro: "ob-plusgiro",
  bankAccount: "ob-bankkonto",
  email: "ob-email",
  phone: "ob-phone",
} as const;

export type OnboardingField = keyof typeof ONBOARDING_FIELD_IDS;

export type OnboardingPaymentMethod = "bankgiro" | "plusgiro" | "bankkonto";
/** Bolagsformer i nuvarande scope. "annan" ger ett ärligt "stöds inte ännu". */
export type OnboardingCompanyForm = "ab" | "enskild" | "annan";
/** Betalningsuppgifter kan läggas till nu eller senare – företaget skapas ändå. */
export type OnboardingPaymentTiming = "now" | "later";

export type OnboardingValues = {
  name: string;
  /** "ab" | "enskild" | "annan". Tomt = inte valt. */
  companyForm: string;
  orgNumber: string;
  vatNumber: string;
  /** "now" | "later". Tomt behandlas som "now" (äldre formulär). */
  paymentTiming: string;
  address: string;
  postalCode: string;
  city: string;
  paymentMethod: string;
  bankgiro: string;
  plusgiro: string;
  bankAccount: string;
  email: string;
  phone: string;
};

export type OnboardingValidation = {
  fieldErrors: Partial<Record<OnboardingField, string>>;
  firstField?: string;
  values: OnboardingPersistInput;
};

/** Det som sparas i CompanySettings – samma källa som Inställningar. */
export type OnboardingPersistInput = {
  name: string;
  companyForm: "ab" | "enskild";
  orgNumber: string;
  vatNumber: string;
  address: string;
  postalCode: string;
  city: string;
  email: string;
  phone: string;
  bankgiro: string;
  plusgiro?: string;
  bankAccount?: string;
};

const FIELD_ORDER: OnboardingField[] = [
  "name",
  "companyForm",
  "orgNumber",
  "vatNumber",
  "address",
  "postalCode",
  "city",
  "paymentTiming",
  "paymentMethod",
  "bankgiro",
  "plusgiro",
  "bankAccount",
  "email",
  "phone",
];

function isPaymentMethod(value: string): value is OnboardingPaymentMethod {
  return value === "bankgiro" || value === "plusgiro" || value === "bankkonto";
}

export function isSupportedCompanyForm(value: string): value is "ab" | "enskild" {
  return value === "ab" || value === "enskild";
}

/** Ärligt besked när företagsformen inte stöds – vi gissar inte redovisningsregler. */
export const UNSUPPORTED_COMPANY_FORM_ERROR =
  "Ferva stödjer just nu aktiebolag och enskild firma. Andra företagsformer kan inte skapas ännu.";

export function looksLikePhone(value: string): boolean {
  if (/[a-zA-ZåäöÅÄÖ]/.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

export function readOnboardingFormData(formData: FormData): OnboardingValues {
  return {
    name: String(formData.get("name") ?? ""),
    companyForm: String(formData.get("companyForm") ?? ""),
    orgNumber: String(formData.get("orgNumber") ?? ""),
    vatNumber: String(formData.get("vatNumber") ?? ""),
    paymentTiming: String(formData.get("paymentTiming") ?? ""),
    address: String(formData.get("address") ?? ""),
    postalCode: String(formData.get("postalCode") ?? ""),
    city: String(formData.get("city") ?? ""),
    paymentMethod: String(formData.get("paymentMethod") ?? ""),
    bankgiro: String(formData.get("bankgiro") ?? ""),
    plusgiro: String(formData.get("plusgiro") ?? ""),
    bankAccount: String(formData.get("bankAccount") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
  };
}

export function suggestedOnboardingVatNumber(orgNumber: string): string {
  return formatVatNumber(orgNumber);
}

export function validateOnboardingFields(input: OnboardingValues): OnboardingValidation {
  const fieldErrors: Partial<Record<OnboardingField, string>> = {};
  const name = input.name.trim();
  if (name.length < 2) fieldErrors.name = "Ange företagets namn.";

  const companyFormRaw = input.companyForm.trim();
  if (!companyFormRaw) {
    fieldErrors.companyForm = "Välj företagsform.";
  } else if (!isSupportedCompanyForm(companyFormRaw)) {
    fieldErrors.companyForm = UNSUPPORTED_COMPANY_FORM_ERROR;
  }
  const companyForm: "ab" | "enskild" = isSupportedCompanyForm(companyFormRaw) ? companyFormRaw : "ab";

  const orgTrimmed = input.orgNumber.trim();
  if (!orgTrimmed) {
    fieldErrors.orgNumber = "Ange företagets organisationsnummer.";
  } else if (!isOrgnrFormat(orgTrimmed)) {
    fieldErrors.orgNumber =
      "Organisationsnumret ska anges som NNNNNN-NNNN (10 siffror). Vi kontrollerar inte mot Skatteverket.";
  }

  const orgNumber = isOrgnrFormat(orgTrimmed) ? normalizeOrgnr(orgTrimmed) : orgTrimmed;
  // Momsregistreringsnumret härleds deterministiskt ur organisationsnumret
  // (SE + 10 siffror + 01). Ett ifyllt värde accepteras bara om det stämmer.
  const vatRaw = input.vatNumber.trim().toUpperCase().replace(/\s/g, "");
  const vatNumber = vatRaw || (isOrgnrFormat(orgNumber) ? formatVatNumber(orgNumber) : "");
  if (!vatNumber) {
    if (!fieldErrors.orgNumber) fieldErrors.vatNumber = "Ange företagets momsregistreringsnummer.";
  } else if (!isVatNumberFormat(vatNumber)) {
    fieldErrors.vatNumber = "Momsregistreringsnumret ska anges som SE följt av 12 siffror.";
  } else if (isOrgnrFormat(orgNumber) && !vatMatchesOrgnr(vatNumber, orgNumber)) {
    fieldErrors.vatNumber = "Momsregistreringsnumret stämmer inte med organisationsnumret (förväntat SE + org.nr + 01).";
  }

  const address = input.address.trim();
  if (!address) fieldErrors.address = "Ange gatuadress.";

  const postalTrimmed = input.postalCode.trim();
  if (!postalTrimmed) {
    fieldErrors.postalCode = "Ange ett giltigt postnummer.";
  } else if (!isPostalCodeFormat(postalTrimmed)) {
    fieldErrors.postalCode = "Ange ett giltigt postnummer.";
  }
  const postalCode = isPostalCodeFormat(postalTrimmed) ? normalizePostalCode(postalTrimmed) : postalTrimmed;

  const city = input.city.trim();
  if (!city) fieldErrors.city = "Ange ort.";

  const paymentMethod = input.paymentMethod.trim();
  const paymentTiming: OnboardingPaymentTiming = input.paymentTiming.trim() === "later" ? "later" : "now";
  let bankgiro = "";
  let plusgiro: string | undefined;
  let bankAccount: string | undefined;

  if (paymentTiming === "later") {
    // Företaget skapas utan betalningsuppgifter. Fakturachecklistan (samma
    // readiness-logik som Inställningar) stoppar utskick tills de finns.
  } else if (!isPaymentMethod(paymentMethod)) {
    fieldErrors.paymentMethod = "Välj ett betalningssätt.";
  } else if (paymentMethod === "bankgiro") {
    const raw = input.bankgiro.trim();
    if (!raw) {
      fieldErrors.bankgiro = "Ange bankgiro.";
    } else if (!isBankgiroFormat(raw)) {
      fieldErrors.bankgiro = "Bankgiro ska anges som NNN-NNNN eller NNNN-NNNN.";
    } else {
      bankgiro = normalizeBankgiro(raw);
    }
  } else if (paymentMethod === "plusgiro") {
    const raw = input.plusgiro.trim();
    if (!raw) {
      fieldErrors.plusgiro = "Ange plusgiro.";
    } else if (!isPlusgiroFormat(raw)) {
      fieldErrors.plusgiro = "PlusGiro ska anges med 2–8 siffror, t.ex. 123456-1.";
    } else {
      plusgiro = normalizePlusgiro(raw);
    }
  } else {
    const raw = input.bankAccount.trim();
    if (!raw) {
      fieldErrors.bankAccount = "Ange bankkonto.";
    } else {
      bankAccount = raw;
    }
  }

  const email = input.email.trim();
  if (!email) {
    fieldErrors.email = "Ange en giltig e-postadress.";
  } else if (!isEmailFormat(email)) {
    fieldErrors.email = "Ange e-postadressen som namn@företag.se.";
  }

  const phone = input.phone.trim();
  if (phone && !looksLikePhone(phone)) {
    fieldErrors.phone = "Ange ett giltigt telefonnummer.";
  }

  const first = FIELD_ORDER.find((key) => fieldErrors[key]);
  return {
    fieldErrors,
    firstField: first ? ONBOARDING_FIELD_IDS[first] : undefined,
    values: {
      name,
      companyForm,
      orgNumber,
      vatNumber,
      address,
      postalCode,
      city,
      email,
      phone,
      bankgiro,
      plusgiro,
      bankAccount,
    },
  };
}

export function firstOnboardingFieldId(errors: Partial<Record<OnboardingField, string>>): string | undefined {
  const first = FIELD_ORDER.find((key) => errors[key]);
  return first ? ONBOARDING_FIELD_IDS[first] : undefined;
}

/** Befintliga företag (har medlemskap) ska aldrig tvingas tillbaka till Kom igång. */
export function needsCompanyOnboarding(membershipCount: number): boolean {
  return membershipCount === 0;
}

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

export function onboardingToBusinessProfile(input: OnboardingPersistInput) {
  return {
    name: input.name,
    companyForm: input.companyForm,
    orgNumber: input.orgNumber,
    vatNumber: input.vatNumber,
    email: input.email,
    phone: input.phone,
    address: input.address,
    postalCode: input.postalCode,
    city: input.city,
    country: "Sverige",
    bankgiro: input.bankgiro,
    plusgiro: input.plusgiro,
    bankAccount: input.bankAccount,
    logoInitials: initialsFromName(input.name),
  };
}

/** Bygger samma CompanySettings som Inställningar / createBusinessWithOwner skriver. */
export function companySettingsFromOnboarding(input: OnboardingPersistInput): CompanySettings {
  const profile = onboardingToBusinessProfile(input);
  return {
    name: profile.name,
    companyForm: profile.companyForm,
    orgNumber: normalizeOrgnr(profile.orgNumber),
    vatNumber: profile.vatNumber.trim().toUpperCase().replace(/\s/g, ""),
    email: profile.email.trim(),
    phone: profile.phone.trim(),
    address: profile.address.trim(),
    postalCode: normalizePostalCode(profile.postalCode),
    city: profile.city.trim(),
    country: "Sverige",
    bankgiro: profile.bankgiro.trim() ? normalizeBankgiro(profile.bankgiro) : "",
    plusgiro: profile.plusgiro?.trim() ? normalizePlusgiro(profile.plusgiro) : undefined,
    bankAccount: profile.bankAccount?.trim() || undefined,
    logoInitials: profile.logoInitials,
    fSkattPerMonth: 0,
    payrollReservePerMonth: 0,
    paymentTermsDays: 30,
    lateInterestRate: 10,
    quoteValidityDays: 30,
    defaultVatRate: 25,
    defaultQuoteTerms: STANDARD_TERMS,
    inboundMailSlug: allocateInboundMailSlug(profile.name, () => false),
  };
}

