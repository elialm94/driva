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
  // E-post är frivillig vid skapande – flöden som faktiskt skickar e-post
  // (offert/faktura) ber om adressen när den behövs. Bara formatet valideras.
  if (input.email !== undefined && input.email.trim() && !isEmailFormat(input.email.trim())) {
    errors.push({ field: "email", message: "Ange e-postadressen som namn@exempel.se." });
  }
  if (input.orgNumber !== undefined && input.orgNumber.trim() && !isOrgnrFormat(input.orgNumber)) {
    errors.push({
      field: "orgNumber",
      message: "Organisationsnumret ska anges som NNNNNN-NNNN (10 siffror).",
    });
  }
  return errors;
}

/* ------------------- Saknade kunduppgifter för en åtgärd -------------------- */

/**
 * Centralt svar på "vad saknas på kunden för att skicka via e-post?".
 * Samma post driver skicka-checklistorna (offert/faktura), inline-
 * kompletteringen i skickaflödena och tester. Fältet namnges explicit –
 * användaren ska aldrig gissa varför en åtgärd stoppas.
 *
 * Systrarna för andra åtgärder bor där datat bor: fakturering kräver
 * kundadress via collectBuyerBlockers (invoices/validate.ts) och ROT/RUT
 * kräver personnummer + bostadsuppgifter via taxReductionMissingFields
 * (tax-reduction-gaps.ts) – alla med samma mönster: exakta fält, mänsklig
 * etikett och en väg att komplettera och fortsätta.
 */
export interface CustomerEmailBlocker {
  code: "buyer_email";
  message: string;
  actionLabel: string;
}

export function missingEmailForSend(customer: { email?: string | null }): CustomerEmailBlocker | null {
  if (customer.email?.trim()) return null;
  return { code: "buyer_email", message: "Kunden saknar e-postadress.", actionLabel: "Lägg till e-post" };
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
  propertyDesignation?: string;
}): CustomerFieldError[] {
  const errors: CustomerFieldError[] = [];
  const designationOnly = Boolean(input.propertyDesignation?.trim());
  if (!designationOnly && input.label !== undefined && !input.label.trim()) {
    errors.push({ field: "label", message: "Ange vad bostaden heter, t.ex. Hem eller Fritidshus." });
  }
  if (!designationOnly && input.address !== undefined && !input.address.trim()) {
    errors.push({ field: "address", message: "Adress saknas." });
  }
  if (input.propertyType !== undefined && input.propertyType && input.propertyType !== "smahus" && input.propertyType !== "bostadsratt") {
    errors.push({ field: "propertyType", message: "Välj bostadstyp." });
  }
  return errors;
}

/** Trimma, hoppa över tomma, avvisa dubbletter utan att upprepa värdet. */
export function sanitizePropertyDesignations(raw: string[]): string[] {
  const trimmed = raw.map((value) => value.trim()).filter(Boolean);
  const seen = new Set<string>();
  for (const designation of trimmed) {
    const key = designation.toLowerCase();
    if (seen.has(key)) {
      throw new CustomerValidationError([
        {
          field: "propertyDesignation",
          message: "Samma fastighetsbeteckning kan inte användas två gånger.",
        },
      ]);
    }
    seen.add(key);
  }
  return trimmed;
}
