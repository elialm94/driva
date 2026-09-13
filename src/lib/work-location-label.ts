import type { DwellingType, HousingDetails, WorkLocation } from "./types";

/** Utfärdad faktura fryser ROT i snapshot, men workLocationId är fortfarande relationen. */
export const WORK_LOCATION_IN_USE_MESSAGE =
  "Fastigheten är vald på en offert eller faktura och kan inte tas bort.";

export type PropertyOption = {
  id: string;
  designation: string;
  label: string;
  address?: string;
  postalCode?: string;
  city?: string;
  propertyType?: DwellingType;
  brfOrgNumber?: string;
  apartmentNumber?: string;
};

export function propertyTypeLabel(type?: DwellingType): string {
  return type === "bostadsratt" ? "Bostadsrätt" : "Fastighet/småhus";
}

/** Lista och lagrad etikett: adress eller beteckning - inget eget namn. */
export function derivedPropertyLabel(input: {
  address?: string;
  propertyDesignation?: string;
  propertyType?: DwellingType;
}): string {
  return input.address?.trim() || input.propertyDesignation?.trim() || propertyTypeLabel(input.propertyType);
}

export function propertyRowParts(input: {
  address?: string;
  propertyDesignation?: string;
  propertyType?: DwellingType;
}): string[] {
  const address = input.address?.trim() ?? "";
  const designation = input.propertyDesignation?.trim() ?? "";
  const type = propertyTypeLabel(input.propertyType);
  const parts: string[] = [];
  if (address) parts.push(address);
  if (designation && designation !== address) parts.push(designation);
  parts.push(type);
  return parts;
}

/** Rad i väljaren: adress · beteckning · bostadstyp. Inte ett gammalt namn. */
export function propertyRowLabel(input: {
  address?: string;
  propertyDesignation?: string;
  propertyType?: DwellingType;
}): string {
  return propertyRowParts(input).join(" · ");
}

export function toPropertyOption(
  location: Pick<
    WorkLocation,
    "id" | "address" | "postalCode" | "city" | "propertyType" | "propertyDesignation" | "brfOrgNumber" | "apartmentNumber"
  >
): PropertyOption {
  return {
    id: location.id,
    designation: location.propertyDesignation ?? "",
    label: derivedPropertyLabel(location),
    address: location.address,
    postalCode: location.postalCode,
    city: location.city,
    propertyType: location.propertyType,
    brfOrgNumber: location.brfOrgNumber,
    apartmentNumber: location.apartmentNumber,
  };
}

export function housingFromPropertyOption(option: PropertyOption): HousingDetails {
  if (option.propertyType === "bostadsratt") {
    return {
      dwellingType: "bostadsratt",
      brfOrgNumber: option.brfOrgNumber?.trim() || undefined,
      apartmentNumber: option.apartmentNumber?.trim() || undefined,
    };
  }
  return {
    dwellingType: "smahus",
    propertyDesignation: option.designation.trim() || undefined,
  };
}

export function formatPostalAddress(input: { address?: string; postalCode?: string; city?: string }): string {
  return [input.address, [input.postalCode, input.city].filter(Boolean).join(" ")].filter(Boolean).join(", ").trim();
}
