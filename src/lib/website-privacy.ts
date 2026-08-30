/**
 * Integritetspolicy för Driva-genererade sajter.
 *
 * Företagsnamn, org.nr, adress och kontakt hämtas alltid live från
 * företagsuppgifterna – de kopieras inte in i policyn. Tilläggstext som
 * företagaren skriver sparas på hemsidan. Valfria integrationer (t.ex.
 * Instagram) läggs bara in när de faktiskt är på.
 *
 * Formuläraudit (submitContactForm):
 *   Sparas: namn, e-post, telefon om angiven, meddelandet, tidpunkt,
 *   idempotensnyckel, källa web_form, ev. e-postavisering till företaget.
 *   Sparas inte: IP, user-agent, cookies, analys-id, geodata.
 *
 * Rättslig grund: art. 6.1 b (åtgärder före avtal) och 6.1 f (berättigat
 * intresse) – inte samtycke. Att skicka en offertförfrågan är inte ett
 * samtycke i GDPR-mening.
 */

import type { CompanySettings, Website, WebsiteSection } from "./types";

export const PRIVACY_POLICY_PATH = "/integritetspolicy";
export const PRIVACY_POLICY_SUPPLEMENT_MAX = 8000;

/** Framtida tillägg – bara stycken som faktiskt är på. */
export interface WebsitePrivacyIntegrations {
  /** Tredjepartsvisning av Instagram. Av tills sektionen finns och är synlig. */
  instagram?: boolean;
}

export interface PrivacyPolicySection {
  id: string;
  heading: string;
  paragraphs: string[];
}

export interface PrivacyPolicyDocument {
  title: string;
  intro: string;
  controllerName: string;
  sections: PrivacyPolicySection[];
}

export function privacyPolicyHref(preview = false): string {
  return preview ? `${PRIVACY_POLICY_PATH}?preview=1` : PRIVACY_POLICY_PATH;
}

export function controllerName(company: Pick<CompanySettings, "name">, website?: Pick<Website, "businessName"> | null): string {
  return company.name.trim() || website?.businessName.trim() || "Företaget";
}

export function formatCompanyAddress(
  company: Pick<CompanySettings, "address" | "postalCode" | "city" | "country">
): string {
  const street = company.address.trim();
  const place = [company.postalCode, company.city].map((p) => p.trim()).filter(Boolean).join(" ");
  const country = (company.country ?? "").trim();
  return [street, place, country && country.toLowerCase() !== "sverige" ? country : ""]
    .filter(Boolean)
    .join(", ");
}

export function contactFormPrivacyLead(companyName: string): string {
  return `Genom att skicka formuläret behandlar ${companyName} dina uppgifter för att hantera din förfrågan.`;
}

/** Klickbar del av notisen under formuläret. */
export const CONTACT_FORM_PRIVACY_LINK_LABEL = "integritetspolicyn";

/**
 * Instagram (eller liknande) räknas bara om sektionen finns och är synlig.
 * På sajter utan den sektionstypen är resultatet alltid false.
 */
export function websiteHasEnabledIntegration(
  website: Pick<Website, "sections">,
  type: string
): boolean {
  return website.sections.some((section) => sectionType(section) === type && section.visible !== false);
}

function sectionType(section: WebsiteSection): string {
  return section.type;
}

export function resolvePrivacyIntegrations(
  website: Pick<Website, "sections">,
  explicit?: WebsitePrivacyIntegrations
): WebsitePrivacyIntegrations {
  return {
    instagram: explicit?.instagram ?? websiteHasEnabledIntegration(website, "instagram"),
  };
}

export function normalizePrivacyPolicySupplement(raw: string | undefined | null): string | undefined {
  const text = (raw ?? "").trim();
  if (!text) return undefined;
  if (text.length > PRIVACY_POLICY_SUPPLEMENT_MAX) {
    throw new Error("Tillägget är för långt.");
  }
  return text;
}

function controllerLines(company: CompanySettings, name: string): string[] {
  const lines = [name];
  if (company.orgNumber.trim()) lines.push(`Org.nr ${company.orgNumber.trim()}`);
  const address = formatCompanyAddress(company);
  if (address) lines.push(address);
  if (company.email.trim()) lines.push(company.email.trim());
  if (company.phone.trim()) lines.push(company.phone.trim());
  return lines;
}

export function buildPrivacyPolicy(input: {
  company: CompanySettings;
  website?: Pick<Website, "businessName" | "privacyPolicySupplement" | "sections"> | null;
  integrations?: WebsitePrivacyIntegrations;
}): PrivacyPolicyDocument {
  const name = controllerName(input.company, input.website);
  const integrations = input.website
    ? resolvePrivacyIntegrations(input.website, input.integrations)
    : { instagram: Boolean(input.integrations?.instagram) };
  const supplement = input.website?.privacyPolicySupplement?.trim();

  const sections: PrivacyPolicySection[] = [
    {
      id: "ansvarig",
      heading: "Personuppgiftsansvarig",
      paragraphs: [
        `${name} är personuppgiftsansvarig för de uppgifter du lämnar via den här hemsidans kontaktformulär.`,
        controllerLines(input.company, name).join("\n"),
      ],
    },
    {
      id: "uppgifter",
      heading: "Vilka uppgifter som behandlas",
      paragraphs: [
        "När du skickar formuläret sparas de uppgifter du själv fyller i: namn, e-postadress, telefonnummer om du anger det, och det du skriver i meddelandet. Vi sparar också tidpunkten då meddelandet skickades och en teknisk nyckel så att samma meddelande inte skapas två gånger om sidan laddas om.",
        "Vi samlar inte in IP-adress, webbläsaridentitet, analys-id eller liknande tekniska spår från formuläret.",
      ],
    },
    {
      id: "varfor",
      heading: "Varför uppgifterna behandlas",
      paragraphs: [
        `${name} behandlar uppgifterna för att ta emot och hantera din förfrågan, kontakta dig om projektet, lämna offert och administrera en ev. kundrelation.`,
      ],
    },
    {
      id: "grund",
      heading: "Rättslig grund",
      paragraphs: [
        "Rättslig grund är artikel 6.1 b i GDPR (åtgärder innan ett avtal ingås) när du ber om kontakt eller offert om ett uppdrag, och artikel 6.1 f (berättigat intresse) när företaget behöver kunna ta emot, besvara och administrera inkommande förfrågningar.",
        "Vi använder inte samtycke som grund bara för att du skickar formuläret. Att skicka en förfrågan är inte detsamma som att kryssa i ett samtycke.",
      ],
    },
    {
      id: "lagring",
      heading: "Hur länge uppgifterna sparas",
      paragraphs: [
        "Uppgifterna sparas som kund och uppdrag i Driva så länge de behövs för att hantera förfrågan och en ev. kundrelation. Det finns ingen automatisk radering efter ett fast antal dagar.",
        "Företaget kan ta bort ett uppdrag som inte lett till avtal, faktura eller bokföring. Om förfrågan leder till offert, faktura eller bokföring kan uppgifter behöva sparas längre, bland annat enligt bokföringslagen.",
      ],
    },
    {
      id: "mottagare",
      heading: "Mottagare och personuppgiftsbiträden",
      paragraphs: [
        `Du skickar uppgifterna till ${name}, inte till Driva som om Driva vore företaget du kontaktar. Driva är plattformen som behandlar uppgifterna på uppdrag av ${name} (personuppgiftsbiträde).`,
        "Driva anlitar tekniska underleverantörer för drift (Vercel), databas (Supabase) och – när e-postavisering är påslagen – utskick om nya förfrågningar (Resend). Uppgifterna lämnas inte ut för reklam, analys eller annan marknadsföring hos tredje part.",
      ],
    },
    {
      id: "rattigheter",
      heading: "Dina rättigheter",
      paragraphs: [
        "Du har rätt att begära tillgång till de uppgifter som rör dig, rättelse, radering när det är tillämpligt, begränsning av behandlingen och invändning mot behandling som stödjer sig på berättigat intresse.",
        "Du har också rätt att lämna klagomål till Integritetsskyddsmyndigheten (IMY).",
      ],
    },
    {
      id: "kontakt",
      heading: "Kontakt om personuppgifter",
      paragraphs: [
        contactAboutPersonalData(input.company, name),
      ],
    },
  ];

  if (integrations.instagram) {
    sections.splice(5, 0, {
      id: "instagram",
      heading: "Instagram",
      paragraphs: [
        "Om företaget visar inlägg från Instagram på den här sajten hämtas innehållet från Meta. Då kan Meta behandla tekniska uppgifter enligt Metas egna villkor. Det är skilt från kontaktformuläret och styrs inte av den här sidans formulär.",
      ],
    });
  }

  if (supplement) {
    sections.push({
      id: "tillägg",
      heading: "Övrigt",
      paragraphs: [supplement],
    });
  }

  return {
    title: "Integritetspolicy",
    intro: `Så här behandlar ${name} personuppgifter som du lämnar via den här hemsidan.`,
    controllerName: name,
    sections,
  };
}

function contactAboutPersonalData(company: CompanySettings, name: string): string {
  const parts = [`Kontakta ${name} om du har frågor om hur dina personuppgifter behandlas.`];
  if (company.email.trim()) parts.push(`E-post: ${company.email.trim()}.`);
  if (company.phone.trim()) parts.push(`Telefon: ${company.phone.trim()}.`);
  return parts.join(" ");
}

/** Fält som policyn faktiskt beskriver – speglar formulärauditen. */
export const CONTACT_FORM_STORED_FIELDS = [
  "name",
  "email",
  "phone",
  "message",
  "createdAt",
  "idempotencyKey",
] as const;

export const CONTACT_FORM_NOT_COLLECTED = [
  "ip",
  "userAgent",
  "analytics",
  "cookies",
] as const;
