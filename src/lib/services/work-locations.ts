import { save } from "../store";
import { uid } from "../ids";
import type { Customer, DwellingType, HousingDetails, Job, WorkLocation } from "../types";
import {
  CustomerValidationError,
  personnummerFieldError,
  sanitizePropertyDesignations,
  workLocationFieldErrors,
} from "../customer-validation";
import { normalizePersonnummer } from "../personnummer";
import { requireCustomer } from "./data";

export function formatLocationAddress(input?: { address?: string; postalCode?: string; city?: string } | null): string {
  if (!input) return "";
  return [input.address, [input.postalCode, input.city].filter(Boolean).join(" ")].filter(Boolean).join(", ").trim();
}

export function workLocationsOf(customer: Customer): WorkLocation[] {
  return customer.workLocations ?? [];
}

export function getWorkLocation(customer: Customer, id?: string): WorkLocation | undefined {
  if (!id) return undefined;
  return workLocationsOf(customer).find((l) => l.id === id);
}

export function defaultWorkLocation(customer: Customer): WorkLocation | undefined {
  const locs = workLocationsOf(customer);
  if (locs.length === 0) return undefined;
  if (customer.defaultWorkLocationId) {
    const chosen = locs.find((l) => l.id === customer.defaultWorkLocationId);
    if (chosen) return chosen;
  }
  return locs[0];
}

/** Matcha "fritidshus" mot etikett/adress. En träff = den, annars oklart. */
export function findWorkLocationByHint(customer: Customer, hint?: string): WorkLocation | undefined {
  const locs = workLocationsOf(customer);
  if (locs.length === 0) return undefined;
  const q = hint?.trim().toLowerCase();
  if (!q) return defaultWorkLocation(customer);
  const matched = locs.filter((l) => {
    const hay = [l.label, l.address, l.city, l.propertyDesignation].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q) || q.includes(l.label.toLowerCase());
  });
  if (matched.length === 1) return matched[0];
  if (matched.length === 0 && locs.length === 1) return locs[0];
  return undefined;
}

export function resolveJobWorkLocation(customer: Customer, job?: Pick<Job, "workLocationId"> | null): WorkLocation | undefined {
  if (job?.workLocationId) {
    const linked = getWorkLocation(customer, job.workLocationId);
    if (linked) return linked;
  }
  return undefined;
}

export function workLocationToHousing(location?: WorkLocation | null): HousingDetails {
  if (!location?.propertyType) return {};
  if (location.propertyType === "smahus") {
    return {
      dwellingType: "smahus",
      propertyDesignation: location.propertyDesignation?.trim() || undefined,
    };
  }
  return {
    dwellingType: "bostadsratt",
    brfOrgNumber: location.brfOrgNumber?.trim() || undefined,
    apartmentNumber: location.apartmentNumber?.trim() || undefined,
  };
}

export function applyWorkLocationToJob(job: Job, location: WorkLocation): void {
  job.workLocationId = location.id;
  job.address = formatLocationAddress(location) || job.address;
  job.housing = workLocationToHousing(location);
}

export function workLocationPublic(location: WorkLocation) {
  return {
    id: location.id,
    label: location.label,
    address: location.address,
    postalCode: location.postalCode,
    city: location.city,
    propertyType: location.propertyType,
    hasPropertyDesignation: Boolean(location.propertyDesignation),
    hasBrfOrgNumber: Boolean(location.brfOrgNumber),
    hasApartmentNumber: Boolean(location.apartmentNumber),
  };
}

export type WorkLocationInput = {
  label: string;
  address: string;
  postalCode?: string;
  city?: string;
  placeId?: string;
  propertyType?: DwellingType;
  propertyDesignation?: string;
  brfOrgNumber?: string;
  apartmentNumber?: string;
  asDefault?: boolean;
};

function sanitizeLocationInput(input: WorkLocationInput): WorkLocationInput {
  const propertyDesignation = input.propertyDesignation?.trim() || undefined;
  return {
    label: input.label.trim() || propertyDesignation || "",
    address: input.address.trim(),
    postalCode: input.postalCode?.trim() || undefined,
    city: input.city?.trim() || undefined,
    placeId: input.placeId?.trim() || undefined,
    propertyType: input.propertyType,
    propertyDesignation,
    brfOrgNumber: input.brfOrgNumber?.trim() || undefined,
    apartmentNumber: input.apartmentNumber?.trim() || undefined,
    asDefault: input.asDefault,
  };
}

/** Enkel fastighet från Ny kund / redigera – beteckning utan adress eller BRF. */
export function isDesignationOnlyLocation(location: WorkLocation): boolean {
  const hasAddress = Boolean(location.address?.trim() || location.postalCode?.trim() || location.city?.trim());
  const hasBrf = Boolean(location.brfOrgNumber?.trim() || location.apartmentNumber?.trim());
  return !hasAddress && !hasBrf;
}

function assertUniqueDesignation(customer: Customer, designation: string | undefined, exceptId?: string) {
  if (!designation) return;
  const key = designation.trim().toLowerCase();
  if (!key) return;
  const clash = workLocationsOf(customer).some(
    (location) => location.id !== exceptId && location.propertyDesignation?.trim().toLowerCase() === key
  );
  if (clash) {
    throw new CustomerValidationError([
      { field: "propertyDesignation", message: "Fastighetsbeteckningen används redan för den här kunden." },
    ]);
  }
}

function toLocation(id: string, input: WorkLocationInput): WorkLocation {
  const clean = sanitizeLocationInput(input);
  return {
    id,
    label: clean.label || "Bostad",
    address: clean.address,
    postalCode: clean.postalCode ?? "",
    city: clean.city ?? "",
    placeId: clean.placeId,
    propertyType: clean.propertyType ?? "smahus",
    propertyDesignation: clean.propertyDesignation,
    brfOrgNumber: clean.brfOrgNumber,
    apartmentNumber: clean.apartmentNumber,
  };
}

export function addWorkLocation(customerId: string, input: WorkLocationInput): WorkLocation {
  const errors = workLocationFieldErrors(input);
  if (errors.length) throw new CustomerValidationError(errors);
  const customer = requireCustomer(customerId);
  const location = toLocation(uid(), input);
  assertUniqueDesignation(customer, location.propertyDesignation);
  customer.workLocations = [...workLocationsOf(customer), location];
  if (input.asDefault || customer.workLocations.length === 1) {
    customer.defaultWorkLocationId = location.id;
  }
  save();
  return location;
}

export function updateWorkLocation(customerId: string, locationId: string, input: Partial<WorkLocationInput>): WorkLocation {
  const errors = workLocationFieldErrors({
    label: input.label,
    address: input.address,
    postalCode: input.postalCode,
    city: input.city,
    propertyType: input.propertyType,
    propertyDesignation: input.propertyDesignation,
  });
  if (errors.length) throw new CustomerValidationError(errors);
  const customer = requireCustomer(customerId);
  const existing = getWorkLocation(customer, locationId);
  if (!existing) throw new Error("Bostaden finns inte");
  const next = toLocation(existing.id, {
    label: input.label ?? existing.label,
    address: input.address ?? existing.address,
    postalCode: input.postalCode ?? existing.postalCode,
    city: input.city ?? existing.city,
    placeId: input.placeId ?? existing.placeId,
    propertyType: input.propertyType ?? existing.propertyType,
    propertyDesignation: input.propertyDesignation ?? existing.propertyDesignation,
    brfOrgNumber: input.brfOrgNumber ?? existing.brfOrgNumber,
    apartmentNumber: input.apartmentNumber ?? existing.apartmentNumber,
  });
  assertUniqueDesignation(customer, next.propertyDesignation, existing.id);
  customer.workLocations = workLocationsOf(customer).map((l) => (l.id === locationId ? next : l));
  if (input.asDefault) customer.defaultWorkLocationId = next.id;
  save();
  return next;
}

export function setDefaultWorkLocation(customerId: string, locationId: string): void {
  const customer = requireCustomer(customerId);
  if (!getWorkLocation(customer, locationId)) throw new Error("Bostaden finns inte");
  customer.defaultWorkLocationId = locationId;
  save();
}

export function removeWorkLocation(customerId: string, locationId: string): void {
  const customer = requireCustomer(customerId);
  customer.workLocations = workLocationsOf(customer).filter((l) => l.id !== locationId);
  if (customer.defaultWorkLocationId === locationId) {
    customer.defaultWorkLocationId = customer.workLocations[0]?.id;
  }
  save();
}

export type PropertyDesignationRow = { id?: string; designation: string };

function editorOwnsLocation(location: WorkLocation): boolean {
  return Boolean(location.propertyDesignation?.trim()) || isDesignationOnlyLocation(location);
}

/** Synka den enkla fastighetslistan. Rika bostäder behåller adress/BRF. */
export function syncCustomerProperties(customerId: string, rows: PropertyDesignationRow[]): WorkLocation[] {
  const customer = requireCustomer(customerId);
  const existing = workLocationsOf(customer);
  const normalized = rows.map((row) => ({
    id: row.id,
    designation: row.designation.trim(),
  }));
  sanitizePropertyDesignations(normalized.map((row) => row.designation));

  const incomingIds = new Set(normalized.map((row) => row.id).filter((id): id is string => Boolean(id)));
  const toRemove: string[] = [];
  const toClear: string[] = [];
  const toUpdate: { id: string; designation: string; updateLabel: boolean }[] = [];
  const toCreate: string[] = [];

  for (const location of existing) {
    if (editorOwnsLocation(location) && !incomingIds.has(location.id)) {
      if (isDesignationOnlyLocation(location)) toRemove.push(location.id);
      else toClear.push(location.id);
    }
  }

  for (const row of normalized) {
    if (!row.id) {
      if (row.designation) toCreate.push(row.designation);
      continue;
    }
    const location = getWorkLocation(customer, row.id);
    if (!location) continue;
    if (!row.designation) {
      if (isDesignationOnlyLocation(location)) toRemove.push(row.id);
      else toClear.push(row.id);
      continue;
    }
    toUpdate.push({
      id: row.id,
      designation: row.designation,
      updateLabel: isDesignationOnlyLocation(location),
    });
  }

  for (const id of new Set(toRemove)) removeWorkLocation(customerId, id);
  for (const id of new Set(toClear)) {
    updateWorkLocation(customerId, id, { propertyDesignation: "" });
  }
  for (const row of toUpdate) {
    updateWorkLocation(customerId, row.id, {
      propertyDesignation: row.designation,
      ...(row.updateLabel ? { label: row.designation } : {}),
    });
  }
  for (const designation of toCreate) {
    addWorkLocation(customerId, {
      label: designation,
      address: "",
      propertyType: "smahus",
      propertyDesignation: designation,
      asDefault: workLocationsOf(requireCustomer(customerId)).length === 0,
    });
  }

  return workLocationsOf(requireCustomer(customerId));
}

export function setCustomerPersonnummer(customerId: string, value: string): string | undefined {
  const error = personnummerFieldError(value);
  if (error) throw new CustomerValidationError([{ field: "personalIdentityNumber", message: error }]);
  const customer = requireCustomer(customerId);
  const trimmed = value.trim();
  customer.personalIdentityNumber = trimmed ? normalizePersonnummer(trimmed) : undefined;
  save();
  return customer.personalIdentityNumber;
}

/** Fullt personnummer – bara för dedikerad Visa-åtgärd. Logga inte returen. */
export function revealCustomerPersonnummer(customerId: string): string | undefined {
  return requireCustomer(customerId).personalIdentityNumber;
}

export function syncWorkLocationHousing(customer: Customer, locationId: string | undefined, housing?: HousingDetails | null): void {
  if (!locationId || !housing) return;
  const location = getWorkLocation(customer, locationId);
  if (!location) return;
  if (housing.dwellingType) location.propertyType = housing.dwellingType;
  if (housing.dwellingType === "smahus") {
    location.propertyDesignation = housing.propertyDesignation?.trim() || undefined;
    location.brfOrgNumber = undefined;
    location.apartmentNumber = undefined;
  } else if (housing.dwellingType === "bostadsratt") {
    location.brfOrgNumber = housing.brfOrgNumber?.trim() || undefined;
    location.apartmentNumber = housing.apartmentNumber?.trim() || undefined;
    location.propertyDesignation = undefined;
  }
}

export function workLocationsForModel(customer: Customer) {
  return workLocationsOf(customer).map((l) => ({
    id: l.id,
    label: l.label,
    city: l.city || null,
    propertyType: l.propertyType,
    isDefault: l.id === (customer.defaultWorkLocationId ?? defaultWorkLocation(customer)?.id),
  }));
}

