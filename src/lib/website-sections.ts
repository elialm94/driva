/**
 * Katalog och regler för hemsidans sektioner.
 *
 * Byggaren är INTE Wix: en liten, genomtänkt uppsättning typer. Användaren
 * väljer innehåll; Driva sköter form. Unika typer (Start, Tjänster, …) kan
 * bara finnas en gång. Text och CTA kan läggas till flera gånger.
 */

import type {
  Website,
  WebsiteCtaDestination,
  WebsiteSection,
  WebsiteSectionType,
} from "./types";

export const DEFAULT_INSTAGRAM_HEADING = "Följ våra projekt";
export const DEFAULT_INSTAGRAM_LIMIT = 6;
export const DEFAULT_TESTIMONIAL_HEADING = "Vad kunderna säger";
export const DEFAULT_CONTACT_DETAILS_HEADING = "Kontaktuppgifter";
export const DEFAULT_CTA_HEADING = "Redo att sätta igång?";
export const DEFAULT_CTA_BODY = "Berätta vad du behöver hjälp med så återkommer vi inom en arbetsdag.";

/** Typer som användaren kan lägga till via ”+ Lägg till sektion”. */
export type AddableSectionType =
  | "text"
  | "tjanster"
  | "galleri"
  | "instagram"
  | "omdomen"
  | "kontaktuppgifter"
  | "cta"
  | "kontakt";

export interface SectionTypeOption {
  type: AddableSectionType;
  label: string;
  description: string;
  /** true = högst en på sajten. Döljs i väljaren när den redan finns. */
  unique: boolean;
}

export const ADDABLE_SECTION_TYPES: SectionTypeOption[] = [
  { type: "text", label: "Text", description: "Rubrik, brödtext och valfri bild.", unique: false },
  { type: "tjanster", label: "Tjänster", description: "Lista med tjänster och valfria bilder.", unique: true },
  { type: "galleri", label: "Galleri", description: "Bilder från era projekt.", unique: true },
  { type: "instagram", label: "Instagram", description: "Senaste inläggen från ert konto.", unique: true },
  { type: "omdomen", label: "Omdömen", description: "Kundcitat med valfritt betyg.", unique: true },
  {
    type: "kontaktuppgifter",
    label: "Kontaktuppgifter",
    description: "Telefon, e-post och adress från Inställningar.",
    unique: true,
  },
  { type: "cta", label: "Call to action", description: "Kort uppmaning med en knapp.", unique: false },
  { type: "kontakt", label: "Kontaktformulär", description: "Formuläret ”Berätta om ditt projekt”.", unique: true },
];

export const SECTION_LABELS: Record<WebsiteSectionType, string> = {
  hero: "Startsektion",
  text: "Text",
  om: "Text",
  tjanster: "Tjänster",
  galleri: "Galleri",
  instagram: "Instagram",
  omdomen: "Omdömen",
  kontaktuppgifter: "Kontaktuppgifter",
  cta: "Call to action",
  kontakt: "Kontakt",
};

const UNIQUE_TYPES = new Set<WebsiteSectionType>(
  ADDABLE_SECTION_TYPES.filter((o) => o.unique).map((o) => o.type),
);

export function isTextSectionType(type: WebsiteSectionType): boolean {
  return type === "text" || type === "om";
}

export function isHeroSection(section: Pick<WebsiteSection, "type">): boolean {
  return section.type === "hero";
}

export function canDeleteSection(section: Pick<WebsiteSection, "type">): boolean {
  return section.type !== "hero";
}

export function canHideSection(section: Pick<WebsiteSection, "type">): boolean {
  return section.type !== "hero";
}

export function addableTypesFor(sections: Pick<WebsiteSection, "type">[]): SectionTypeOption[] {
  return ADDABLE_SECTION_TYPES.filter((option) => {
    if (!option.unique) return true;
    return !sections.some((s) => s.type === option.type);
  });
}

export function defaultCtaLabel(destination: WebsiteCtaDestination): string {
  switch (destination) {
    case "kontakt":
      return "Kontakta oss";
    case "phone":
      return "Ring oss";
    case "email":
      return "Mejla oss";
  }
}

export function createSectionDraft(type: AddableSectionType, id: string): WebsiteSection {
  switch (type) {
    case "text":
      return { id, type: "text", heading: "Om oss", body: "", visible: true, imagePosition: "right" };
    case "tjanster":
      return {
        id,
        type: "tjanster",
        heading: "Det här hjälper vi dig med",
        body: "",
        visible: true,
        items: [{ title: "Ny tjänst", text: "Beskriv vad ni hjälper till med." }],
      };
    case "galleri":
      return {
        id,
        type: "galleri",
        heading: "Utvalda projekt",
        body: "Ett urval av uppdrag vi genomfört.",
        visible: true,
      };
    case "instagram":
      return {
        id,
        type: "instagram",
        heading: DEFAULT_INSTAGRAM_HEADING,
        body: "",
        visible: true,
        instagram: { handle: "", limit: DEFAULT_INSTAGRAM_LIMIT, connected: false },
      };
    case "omdomen":
      return { id, type: "omdomen", heading: DEFAULT_TESTIMONIAL_HEADING, body: "", visible: true, items: [] };
    case "kontaktuppgifter":
      return { id, type: "kontaktuppgifter", heading: DEFAULT_CONTACT_DETAILS_HEADING, body: "", visible: true };
    case "cta":
      return {
        id,
        type: "cta",
        heading: DEFAULT_CTA_HEADING,
        body: DEFAULT_CTA_BODY,
        visible: true,
        cta: { destination: "kontakt", label: defaultCtaLabel("kontakt") },
      };
    case "kontakt":
      return {
        id,
        type: "kontakt",
        heading: "Berätta om ditt projekt",
        body: "Beskriv vad du behöver hjälp med så återkommer vi inom en arbetsdag med nästa steg.",
        visible: true,
      };
  }
}

export function sectionAnchorId(section: Pick<WebsiteSection, "id" | "type">): string {
  switch (section.type) {
    case "hero":
      return "start";
    case "tjanster":
      return "tjanster";
    case "om":
      return "om";
    case "galleri":
      return "galleri";
    case "instagram":
      return "instagram";
    case "omdomen":
      return "omdomen";
    case "kontaktuppgifter":
      return "kontaktuppgifter";
    case "kontakt":
      return "kontakt";
    case "text":
    case "cta":
      return `${section.type}-${section.id}`;
  }
}

export function publicInstagram(
  instagram: Website["sections"][number]["instagram"],
): Website["sections"][number]["instagram"] {
  if (!instagram) return instagram;
  return {
    handle: instagram.handle,
    limit: instagram.limit,
    connected: Boolean(instagram.connected && instagram.accessToken),
    posts: instagram.posts,
    postsFetchedAt: instagram.postsFetchedAt,
  };
}

export function stripWebsiteSecrets(site: Website): Website {
  return {
    ...site,
    sections: site.sections.map((section) =>
      section.instagram ? { ...section, instagram: publicInstagram(section.instagram) } : section,
    ),
  };
}

export function assertCtaDestination(value: unknown): WebsiteCtaDestination {
  if (value === "kontakt" || value === "phone" || value === "email") return value;
  throw new Error("Knappen kan bara leda till formuläret, telefon eller e-post.");
}

export function clampRating(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error("Betyget måste vara 1–5.");
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 5) throw new Error("Betyget måste vara 1–5.");
  return rounded;
}

export function normalizeInstagramHandle(raw: string): string {
  return raw.trim().replace(/^@+/, "").replace(/\s+/g, "").toLowerCase();
}
