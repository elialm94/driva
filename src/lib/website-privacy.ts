/**
 * Integritetspolicy för Driva-genererade sajter.
 *
 * STANDARD (default): Driva genererar och underhåller policyn. Företagsnamn,
 * org.nr, adress och kontakt hämtas alltid live från företagsuppgifterna –
 * de kopieras inte in i policyn. Valfritt "Eget tillägg" renderas som Övrigt.
 *
 * CUSTOM: hela policyn är redigerbar rich text. Företagsfält lagras som
 * tokens ({{company.email}} m.fl.) och byts ut vid visning, så att
 * företagsuppgifter fortsätter uppdateras utan att skriva över userns text.
 *
 * Utkast (draftPrivacyPolicy) syns i förhandsvisning; publicerat innehåll
 * först vid "Publicera ändringar".
 *
 * Valfria tredjepartsintegrationer läggs bara in i STANDARD när de faktiskt
 * är på. CUSTOM skrivs aldrig över av malluppdateringar.
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

import type {
  CompanySettings,
  PrivacyPolicyMode,
  PrivacyPolicyState,
  Website,
  WebsiteSection,
} from "./types";
import {
  sanitizeRichText,
  type RichTextBlock,
  type RichTextDoc,
  type RichTextInline,
  type RichTextListItem,
  type RichTextListItemBlock,
} from "./richtext";

export type { PrivacyPolicyMode, PrivacyPolicyState };

export const PRIVACY_POLICY_PATH = "/integritetspolicy";
export const PRIVACY_POLICY_SUPPLEMENT_MAX = 8000;

export const PRIVACY_COMPANY_TOKENS = {
  name: "{{company.name}}",
  orgNumber: "{{company.orgNumber}}",
  email: "{{company.email}}",
  phone: "{{company.phone}}",
  address: "{{company.address}}",
} as const;

export type PrivacyCompanyToken = (typeof PRIVACY_COMPANY_TOKENS)[keyof typeof PRIVACY_COMPANY_TOKENS];

/** Framtida tillägg – bara stycken som faktiskt är på. */
export interface WebsitePrivacyIntegrations {}

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
 * En valfri tredjepartsräknas bara om sektionen finns och är synlig.
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
  _website: Pick<Website, "sections">,
  explicit?: WebsitePrivacyIntegrations
): WebsitePrivacyIntegrations {
  return { ...explicit };
}

export function normalizePrivacyPolicySupplement(raw: string | undefined | null): string | undefined {
  const text = (raw ?? "").trim();
  if (!text) return undefined;
  if (text.length > PRIVACY_POLICY_SUPPLEMENT_MAX) {
    throw new Error("Tillägget är för långt.");
  }
  return text;
}

export function isPrivacyPolicyMode(value: unknown): value is PrivacyPolicyMode {
  return value === "standard" || value === "custom";
}

function optionalSupplement(raw: string | undefined | null): string | undefined {
  const text = (raw ?? "").trim();
  if (!text) return undefined;
  return text.length > PRIVACY_POLICY_SUPPLEMENT_MAX ? text.slice(0, PRIVACY_POLICY_SUPPLEMENT_MAX) : text;
}

export function publishedPrivacyPolicyState(
  site: Pick<Website, "privacyPolicyMode" | "privacyPolicySupplement" | "privacyPolicyCustomBody">
): PrivacyPolicyState {
  const mode: PrivacyPolicyMode = site.privacyPolicyMode === "custom" ? "custom" : "standard";
  const supplement = optionalSupplement(site.privacyPolicySupplement);
  const customBody = mode === "custom" ? sanitizeRichText(site.privacyPolicyCustomBody) : undefined;
  return {
    mode,
    ...(supplement ? { supplement } : {}),
    ...(customBody ? { customBody } : {}),
  };
}

export function draftPrivacyPolicyState(
  site: Pick<
    Website,
    "privacyPolicyMode" | "privacyPolicySupplement" | "privacyPolicyCustomBody" | "draftPrivacyPolicy"
  >
): PrivacyPolicyState {
  if (site.draftPrivacyPolicy && isPrivacyPolicyMode(site.draftPrivacyPolicy.mode)) {
    const mode = site.draftPrivacyPolicy.mode;
    const supplement = optionalSupplement(site.draftPrivacyPolicy.supplement);
    const customBody = mode === "custom" ? sanitizeRichText(site.draftPrivacyPolicy.customBody) : undefined;
    return {
      mode,
      ...(supplement ? { supplement } : {}),
      ...(customBody ? { customBody } : {}),
    };
  }
  return publishedPrivacyPolicyState(site);
}

export function samePrivacyPolicyState(a: PrivacyPolicyState, b: PrivacyPolicyState): boolean {
  if (a.mode !== b.mode) return false;
  if ((a.supplement ?? "") !== (b.supplement ?? "")) return false;
  return JSON.stringify(a.customBody ?? null) === JSON.stringify(b.customBody ?? null);
}

/** Skriver publicerade fält från ett tillstånd. Rör inte draft-fältet. */
export function applyPublishedPrivacyPolicy(site: Website, state: PrivacyPolicyState): void {
  if (state.mode === "custom") {
    site.privacyPolicyMode = "custom";
    if (state.customBody) site.privacyPolicyCustomBody = state.customBody;
    else delete site.privacyPolicyCustomBody;
    return;
  }
  delete site.privacyPolicyMode;
  delete site.privacyPolicyCustomBody;
  if (state.supplement) site.privacyPolicySupplement = state.supplement;
  else delete site.privacyPolicySupplement;
}

/**
 * Overlay så att renderer/editor ser ett enda läge. Preview använder utkast,
 * publika sajten det publicerade. Draft-fältet tas bort från kopian.
 */
export function websiteWithResolvedPrivacy(website: Website, preview: boolean): Website {
  const state = preview ? draftPrivacyPolicyState(website) : publishedPrivacyPolicyState(website);
  const next: Website = { ...website };
  delete next.draftPrivacyPolicy;
  applyPublishedPrivacyPolicy(next, state);
  return next;
}

export function privacyCompanyValues(
  company: CompanySettings,
  website?: Pick<Website, "businessName"> | null
): Record<PrivacyCompanyToken, string> {
  return {
    [PRIVACY_COMPANY_TOKENS.name]: controllerName(company, website),
    [PRIVACY_COMPANY_TOKENS.orgNumber]: company.orgNumber.trim(),
    [PRIVACY_COMPANY_TOKENS.email]: company.email.trim(),
    [PRIVACY_COMPANY_TOKENS.phone]: company.phone.trim(),
    [PRIVACY_COMPANY_TOKENS.address]: formatCompanyAddress(company),
  };
}

function companyWithPrivacyTokens(company: CompanySettings): CompanySettings {
  const address = formatCompanyAddress(company);
  return {
    ...company,
    name: company.name.trim() ? PRIVACY_COMPANY_TOKENS.name : company.name,
    orgNumber: company.orgNumber.trim() ? PRIVACY_COMPANY_TOKENS.orgNumber : company.orgNumber,
    email: company.email.trim() ? PRIVACY_COMPANY_TOKENS.email : company.email,
    phone: company.phone.trim() ? PRIVACY_COMPANY_TOKENS.phone : company.phone,
    address: address ? PRIVACY_COMPANY_TOKENS.address : company.address,
    postalCode: address ? "" : company.postalCode,
    city: address ? "" : company.city,
    country: address ? "" : company.country,
  };
}

function mapInline(content: RichTextInline[] | undefined, map: (s: string) => string): RichTextInline[] | undefined {
  if (!content) return undefined;
  return content.map((node) => {
    if (node.type === "hardBreak") return node;
    const text = map(node.text);
    return text === node.text ? node : { ...node, text };
  });
}

function mapListItems(items: RichTextListItem[], map: (s: string) => string): RichTextListItem[] {
  return items.map((item) => ({
    type: "listItem",
    content: item.content.map((block) => mapListItemBlock(block, map)),
  }));
}

function mapListItemBlock(block: RichTextListItemBlock, map: (s: string) => string): RichTextListItemBlock {
  if (block.type === "paragraph") return { type: "paragraph", content: mapInline(block.content, map) };
  return { type: block.type, content: mapListItems(block.content, map) };
}

function mapBlocks(blocks: RichTextBlock[], map: (s: string) => string): RichTextBlock[] {
  return blocks.map((block) => {
    if (block.type === "horizontalRule") return block;
    if (block.type === "paragraph") return { type: "paragraph", content: mapInline(block.content, map) };
    if (block.type === "heading") {
      return { type: "heading", attrs: block.attrs, content: mapInline(block.content, map) };
    }
    return { type: block.type, content: mapListItems(block.content, map) };
  });
}

function mapRichTextStrings(doc: RichTextDoc, map: (s: string) => string): RichTextDoc {
  return { type: "doc", content: mapBlocks(doc.content, map) };
}

/** Byter ut tokens mot live företagsuppgifter – för editor och publik sida. */
export function applyPrivacyTokens(
  doc: RichTextDoc,
  company: CompanySettings,
  website?: Pick<Website, "businessName"> | null
): RichTextDoc {
  const values = privacyCompanyValues(company, website);
  return mapRichTextStrings(doc, (text) => {
    let out = text;
    for (const [token, value] of Object.entries(values)) {
      if (out.includes(token)) out = out.split(token).join(value);
    }
    return out;
  });
}

/**
 * Byter tillbaka live värden till tokens vid sparande, så att en ändrad
 * e-post under Företagsuppgifter syns även i en anpassad policy.
 */
export function capturePrivacyTokens(
  doc: RichTextDoc,
  company: CompanySettings,
  website?: Pick<Website, "businessName"> | null
): RichTextDoc {
  const values = privacyCompanyValues(company, website);
  const pairs = (Object.entries(values) as [PrivacyCompanyToken, string][])
    .filter(([, value]) => value.length > 0)
    .sort((a, b) => b[1].length - a[1].length);
  return mapRichTextStrings(doc, (text) => {
    let out = text;
    for (const [token, value] of pairs) {
      if (out.includes(value)) out = out.split(value).join(token);
    }
    return out;
  });
}

function textToInline(text: string): RichTextInline[] | undefined {
  if (!text) return undefined;
  const lines = text.split("\n");
  const out: RichTextInline[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) out.push({ type: "hardBreak" });
    if (lines[i]) out.push({ type: "text", text: lines[i] });
  }
  return out.length > 0 ? out : undefined;
}

export function privacyDocumentToRichText(doc: PrivacyPolicyDocument): RichTextDoc {
  const content: RichTextBlock[] = [
    { type: "heading", attrs: { level: 1 }, content: textToInline(doc.title) },
    { type: "paragraph", content: textToInline(doc.intro) },
  ];
  for (const section of doc.sections) {
    content.push({ type: "heading", attrs: { level: 2 }, content: textToInline(section.heading) });
    for (const paragraph of section.paragraphs) {
      content.push({ type: "paragraph", content: textToInline(paragraph) });
    }
  }
  return { type: "doc", content };
}

/**
 * Nuvarande STANDARD-policy som rich text med företagsfält som tokens.
 * Utgångspunkt när user väljer att anpassa hela policyn – aldrig tomt.
 */
export function seedCustomPrivacyPolicy(input: {
  company: CompanySettings;
  website?: Pick<Website, "businessName" | "privacyPolicySupplement" | "sections" | "draftPrivacyPolicy" | "privacyPolicyMode"> | null;
}): RichTextDoc {
  const tokenCompany = companyWithPrivacyTokens(input.company);
  const supplement =
    input.website && draftPrivacyPolicyState(input.website).mode === "standard"
      ? draftPrivacyPolicyState(input.website).supplement
      : input.website?.privacyPolicySupplement;
  const generated = buildPrivacyPolicy({
    company: tokenCompany,
    website: input.website
      ? { businessName: input.website.businessName, privacyPolicySupplement: supplement, sections: input.website.sections }
      : null,
  });
  const doc = sanitizeRichText(privacyDocumentToRichText(generated));
  if (!doc) throw new Error("Kunde inte skapa policyn.");
  return doc;
}

export type PrivacyPolicyView =
  | { kind: "standard"; document: PrivacyPolicyDocument }
  | { kind: "custom"; controllerName: string; doc: RichTextDoc };

/** Väljer STANDARD-dokument eller interpolerad custom-text. Website ska redan vara resolved. */
export function resolvePrivacyPolicyView(input: {
  company: CompanySettings;
  website: Pick<
    Website,
    | "businessName"
    | "privacyPolicySupplement"
    | "privacyPolicyMode"
    | "privacyPolicyCustomBody"
    | "sections"
  >;
}): PrivacyPolicyView {
  const state = publishedPrivacyPolicyState(input.website);
  if (state.mode === "custom" && state.customBody) {
    return {
      kind: "custom",
      controllerName: controllerName(input.company, input.website),
      doc: applyPrivacyTokens(state.customBody, input.company, input.website),
    };
  }
  return { kind: "standard", document: buildPrivacyPolicy(input) };
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
}): PrivacyPolicyDocument {
  const name = controllerName(input.company, input.website);
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
