import type { CompanySettings } from "../types";
import { getBusinessProfile } from "../services/settings";
import { SETTINGS_HREF } from "../settings-routes";
import { withReturnTo } from "../nav";

export interface RegistrantProfile {
  companyName: string;
  orgNumber: string;
  email: string;
  phone: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
}

export interface MissingRegistrantField {
  key: string;
  label: string;
}

const REQUIRED: { key: keyof CompanySettings; label: string }[] = [
  { key: "name", label: "Företagsnamn" },
  { key: "orgNumber", label: "Organisationsnummer" },
  { key: "email", label: "E-post" },
  { key: "phone", label: "Telefon" },
  { key: "address", label: "Adress" },
  { key: "postalCode", label: "Postnummer" },
  { key: "city", label: "Ort" },
];

export function registrantFromProfile(profile: CompanySettings = getBusinessProfile()): RegistrantProfile {
  return {
    companyName: profile.name.trim(),
    orgNumber: profile.orgNumber.trim(),
    email: profile.email.trim(),
    phone: profile.phone.trim(),
    address: profile.address.trim(),
    postalCode: profile.postalCode.trim(),
    city: profile.city.trim(),
    country: (profile.country ?? "Sverige").trim() || "Sverige",
  };
}

export function missingRegistrantFields(profile: CompanySettings = getBusinessProfile()): MissingRegistrantField[] {
  const missing: MissingRegistrantField[] = [];
  for (const field of REQUIRED) {
    const value = String(profile[field.key] ?? "").trim();
    if (!value) missing.push({ key: field.key, label: field.label });
  }
  return missing;
}

export function completeCompanyHref(returnTo = "/hemsida/doman"): string {
  return withReturnTo(SETTINGS_HREF.foretag, returnTo, "Domän");
}
