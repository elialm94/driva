import { isEmailFormat } from "./settings-validation";
import { isOrgnrFormat } from "./invoices/formats";
import { isPersonnummerFormat } from "./personnummer";
import type { DwellingType } from "./types";

export interface CustomerFieldError {
  field: string;
  message: string;
}

export class CustomerValidationError extends Error {
  constructor(public errors: CustomerFieldError[]) {
    super(errors[0]?.message ?? "Ogiltiga uppgifter");
    this.name = "CustomerValidationError";
  }
}

export function customerContactFieldErrors(input: {
  name?: string;
  email?: string;
  phone?: string;
  orgNumber?: string;
  contactPerson?: string;
}): CustomerFieldError[] {
  const errors: CustomerFieldError[] = [];
  if (input.name !== undefined && !input.name.trim()) {
    errors.push({ field: "name", message: "Namn saknas." });
  }
  if (input.email !== undefined) {
    const email = input.email.trim();
    if (!email) errors.push({ field: "email", message: "E-postadress saknas." });
    else if (!isEmailFormat(email)) {
      errors.push({ field: "email", message: "Ange e-postadressen som namn@exempel.se." });
    }
  }
  if (input.orgNumber !== undefined && input.orgNumber.trim() && !isOrgnrFormat(input.orgNumber)) {
    errors.push({
      field: "orgNumber",
      message: "Organisationsnumret ska anges som NNNNNN-NNNN (10 siffror).",
    });
  }
  return errors;
}

/** Feltext utan att upprepa värdet – personnummer ska inte hamna i loggar eller felpayload. */
export function personnummerFieldError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!isPersonnummerFormat(trimmed)) {
    return "Ange personnummer med 10 eller 12 siffror.";
  }
  return null;
}

export function workLocationFieldErrors(input: {
  label?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  propertyType?: DwellingType | "";
}): CustomerFieldError[] {
  const errors: CustomerFieldError[] = [];
  if (input.label !== undefined && !input.label.trim()) {
    errors.push({ field: "label", message: "Ange vad bostaden heter, t.ex. Hem eller Fritidshus." });
  }
  if (input.address !== undefined && !input.address.trim()) {
    errors.push({ field: "address", message: "Adress saknas." });
  }
  if (input.propertyType !== undefined && input.propertyType && input.propertyType !== "smahus" && input.propertyType !== "bostadsratt") {
    errors.push({ field: "propertyType", message: "Välj bostadstyp." });
  }
  return errors;
}
