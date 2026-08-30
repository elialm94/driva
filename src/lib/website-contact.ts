/**
 * Kanoniska kontaktuppgifter för den publika sajten.
 *
 * Telefon, e-post, adress och org.nr kommer från Inställningar → Kontakt.
 * Hemsidan skriver inte om dem. Öppettider kan ligga på kontaktuppgiftssektionen.
 */

import type { CompanySettings, Website, WebsiteSection } from "./types";

export interface SiteContact {
  phone: string;
  email: string;
  address: string;
  postalCode: string;
  city: string;
  orgNumber: string;
  hours: string;
}

export function resolveSiteContact(
  company: Pick<CompanySettings, "phone" | "email" | "address" | "postalCode" | "city" | "orgNumber">,
  website?: Pick<Website, "city"> | null,
  section?: Pick<WebsiteSection, "hours"> | null,
): SiteContact {
  return {
    phone: company.phone.trim(),
    email: company.email.trim(),
    address: company.address.trim(),
    postalCode: company.postalCode.trim(),
    city: (website?.city ?? company.city).trim(),
    orgNumber: company.orgNumber.trim(),
    hours: (section?.hours ?? "").trim(),
  };
}

export function telHref(phone: string): string {
  const cleaned = phone.trim().replace(/[^\d+]/g, "");
  return cleaned ? `tel:${cleaned}` : "";
}

export function mailHref(email: string): string {
  const trimmed = email.trim();
  return trimmed ? `mailto:${trimmed}` : "";
}

export function formatAddressLine(contact: Pick<SiteContact, "address" | "postalCode" | "city">): string {
  const street = contact.address.trim();
  const place = [contact.postalCode, contact.city].filter(Boolean).join(" ").trim();
  return [street, place].filter(Boolean).join(", ");
}

export function compactFooterParts(contact: SiteContact): string[] {
  const parts: string[] = [];
  if (contact.phone) parts.push(contact.phone);
  if (contact.email) parts.push(contact.email);
  if (contact.orgNumber) parts.push(`Org.nr ${contact.orgNumber}`);
  const address = formatAddressLine(contact);
  if (address) parts.push(address);
  return parts;
}
