/**
 * Juridisk avtalspart (spec §7). Bolagsnamn, organisationsnummer, adress och
 * kontakt kommer ENBART från servermiljön – ingenting hittas på i koden.
 * Saknas en uppgift visar sidorna det öppet ("uppgift saknas"), health/admin
 * blir röda i produktion och Stripe Checkout blockeras.
 *
 *   LEGAL_ENTITY_NAME         Bolagets registrerade namn ("… AB")
 *   LEGAL_ENTITY_ORG_NUMBER   Organisationsnummer (NNNNNN-NNNN)
 *   LEGAL_ENTITY_ADDRESS      Postadress, en rad ("Gatan 1, 123 45 Ort")
 *   LEGAL_CONTACT_EMAIL       Kontakt för avtals-/villkorsfrågor
 *   LEGAL_PRIVACY_EMAIL       Valfri: dataskyddskontakt (annars LEGAL_CONTACT_EMAIL)
 */

export type EnvSource = Record<string, string | undefined>;

export const LEGAL_REQUIRED_ENV = [
  "LEGAL_ENTITY_NAME",
  "LEGAL_ENTITY_ORG_NUMBER",
  "LEGAL_ENTITY_ADDRESS",
  "LEGAL_CONTACT_EMAIL",
] as const;

export type LegalEnvKey = (typeof LEGAL_REQUIRED_ENV)[number];

export interface LegalEntity {
  name: string;
  orgNumber: string;
  address: string;
  contactEmail: string;
  privacyEmail: string;
}

export interface LegalEntityStatus {
  complete: boolean;
  /** Variabler som saknas eller är ogiltiga, i den ordning de ska sättas. */
  missing: LegalEnvKey[];
  /** Läsbar förklaring per problem (aldrig värden som kan vara hemliga). */
  problems: string[];
  entity: LegalEntity | null;
}

function trimmed(env: EnvSource, key: string): string {
  return env[key]?.trim() ?? "";
}

/** Svenskt organisationsnummer: 10 siffror (valfritt bindestreck) med Luhn-kontroll. */
export function isValidOrgNumber(raw: string): boolean {
  const digits = raw.replace(/[\s-]/g, "");
  if (!/^\d{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let n = Number(digits[i]);
    if (i % 2 === 0) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

export function formatOrgNumber(raw: string): string {
  const digits = raw.replace(/[\s-]/g, "");
  return digits.length === 10 ? `${digits.slice(0, 6)}-${digits.slice(6)}` : raw.trim();
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;
}

export function legalEntityStatus(env: EnvSource = process.env): LegalEntityStatus {
  const missing: LegalEnvKey[] = [];
  const problems: string[] = [];

  const name = trimmed(env, "LEGAL_ENTITY_NAME");
  if (name.length < 2) {
    missing.push("LEGAL_ENTITY_NAME");
    problems.push("LEGAL_ENTITY_NAME saknas (bolagets registrerade namn).");
  }

  const orgNumber = trimmed(env, "LEGAL_ENTITY_ORG_NUMBER");
  if (!orgNumber) {
    missing.push("LEGAL_ENTITY_ORG_NUMBER");
    problems.push("LEGAL_ENTITY_ORG_NUMBER saknas.");
  } else if (!isValidOrgNumber(orgNumber)) {
    missing.push("LEGAL_ENTITY_ORG_NUMBER");
    problems.push("LEGAL_ENTITY_ORG_NUMBER är inte ett giltigt organisationsnummer (10 siffror, kontrollsiffra).");
  }

  const address = trimmed(env, "LEGAL_ENTITY_ADDRESS");
  if (address.length < 8) {
    missing.push("LEGAL_ENTITY_ADDRESS");
    problems.push("LEGAL_ENTITY_ADDRESS saknas eller är för kort (gata, postnummer, ort).");
  }

  const contactEmail = trimmed(env, "LEGAL_CONTACT_EMAIL");
  if (!isEmail(contactEmail)) {
    missing.push("LEGAL_CONTACT_EMAIL");
    problems.push("LEGAL_CONTACT_EMAIL saknas eller är ogiltig.");
  }

  const privacyRaw = trimmed(env, "LEGAL_PRIVACY_EMAIL");
  if (privacyRaw && !isEmail(privacyRaw)) {
    problems.push("LEGAL_PRIVACY_EMAIL är ogiltig (valfri – utelämna eller ange en giltig adress).");
  }

  const complete = missing.length === 0 && problems.length === 0;
  return {
    complete,
    missing,
    problems,
    entity: complete
      ? {
          name,
          orgNumber: formatOrgNumber(orgNumber),
          address,
          contactEmail,
          privacyEmail: privacyRaw || contactEmail,
        }
      : null,
  };
}

/** Text som sidorna visar där avtalsparten skulle stått när uppgiften saknas. */
export const LEGAL_ENTITY_PLACEHOLDER = "[avtalspart ej konfigurerad – uppgift saknas]";

export function legalEntityLabel(status: LegalEntityStatus): string {
  return status.entity
    ? `${status.entity.name} (org.nr ${status.entity.orgNumber})`
    : LEGAL_ENTITY_PLACEHOLDER;
}
