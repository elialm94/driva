/**
 * Kundens hemsida: tema, sektioner, sidfot och integritetspolicy.
 *
 * Del av domänmodellen. Importera via barrelen `@/lib/types`.
 */

import type { ID } from "./common";
import type { RichTextDoc } from "../richtext";

/* ---------------------------------- Hemsida ---------------------------------- */

/**
 * Äldre palettfält från AI-generatorn (branschpaletter). Ersatt av
 * `WebsiteDesign` (tema + accentfärg) men behålls i lagringen så att äldre
 * sajter kan härledas till rätt utseende utan datamigrering.
 */
export type WebsiteTheme = "tra" | "studio" | "ren" | "el" | "konsult";

/**
 * Utseende = tema + accentfärg. Temat äger typografi, layout, ytor och hur
 * accenten används; accenten är den ENDA fria färgvariabeln (kuraterad lista,
 * aldrig fri färgväljare). Definitionerna bor i `src/lib/website-design.ts`.
 */
export type WebsiteThemeId = "klassisk" | "modern" | "robust" | "minimal";

export type WebsiteAccentId = "gron" | "bla" | "tegel" | "sand" | "svart";

export interface WebsiteDesign {
  themeId: WebsiteThemeId;
  accent: WebsiteAccentId;
}

/** Vanliga externa länkar i sidfoten – ingen feed, ingen OAuth. */
export interface WebsiteFooterSocial {
  instagram?: string;
  facebook?: string;
  tiktok?: string;
}

/**
 * Inställningar för hemsidans sidfot. Tomma fält = smart default
 * (visa det som finns i företagsuppgifter och Tjänster-sektionen).
 */
export interface WebsiteFooter {
  showPhone?: boolean;
  showEmail?: boolean;
  showAddress?: boolean;
  showServices?: boolean;
  showLogo?: boolean;
  /** Kort text. Tomt = föreslagen från befintligt innehåll. */
  aboutText?: string;
  social?: WebsiteFooterSocial;
}

/**
 * Sektionstyper i hemsidesbyggaren. `om` är äldre namn för en textsektion
 * (Om oss) och behandlas som `text` – nya sajter skapas med `text`.
 */
export type WebsiteSectionType =
  | "hero"
  | "text"
  | "om"
  | "tjanster"
  | "galleri"
  | "omdomen"
  | "kontaktuppgifter"
  | "cta"
  | "kontakt";

/** Vart en CTA-sektion ska leda. Inga fria URL:er – bara kontaktvägar. */
export type WebsiteCtaDestination = "kontakt" | "phone" | "email";

export type WebsiteImagePosition = "left" | "right";

export interface WebsiteSectionItem {
  title: string;
  text: string;
  /** Data-URL eller relativ sökväg. Valfri – kortet fungerar utan bild. */
  image?: string;
  /**
   * Betyg 1–5. Används av omdömen. Redo för Google Reviews senare
   * (`source` skiljer manuella från importerade).
   */
  rating?: number;
  /** Omdömen: t.ex. stad. */
  location?: string;
  /** Ursprung. Saknas eller "manual" = inskrivet i Ferva. */
  source?: "manual" | "google";
}

export interface WebsiteCta {
  destination: WebsiteCtaDestination;
  /** Knapptext. Saknas = standard per destination. */
  label?: string;
}

export interface WebsiteSection {
  id: ID;
  type: WebsiteSectionType;
  heading: string;
  body: string;
  /** Valfri bild (data-URL). Hero och text: saknas = endast text, ingen platshållare. */
  image?: string;
  /** Bildens sida i textsektioner. Saknas = höger. */
  imagePosition?: WebsiteImagePosition;
  /** Tjänster, omdömen. Arrayordning = visningsordning. */
  items?: WebsiteSectionItem[];
  cta?: WebsiteCta;
  /** Öppettider – bara kontaktuppgifter. */
  hours?: string;
  /** false = dold på sajten. Saknas eller true = synlig. Innehållet sparas. */
  visible?: boolean;
}

/** Standardtext för primärknappen i sidhuvud och startsektion. */
export const DEFAULT_PRIMARY_CTA_LABEL = "Begär offert";
export const PRIMARY_CTA_LABEL_MAX = 40;

/** STANDARD = Ferva underhåller texten. CUSTOM = företaget redigerar hela policyn. */
export type PrivacyPolicyMode = "standard" | "custom";

/** Publicerat eller utkastat policyläge. Default för alla företag är STANDARD. */
export interface PrivacyPolicyState {
  mode: PrivacyPolicyMode;
  /** Eget tillägg i STANDARD-läge. Behålls vid byte till CUSTOM så det inte försvinner. */
  supplement?: string;
  /** Anpassad rich text. Tokens {{company.*}} interpoleras vid visning. */
  customBody?: RichTextDoc;
}

export interface Website {
  id: ID;
  slug: string;
  businessName: string;
  tagline: string;
  city?: string;
  status: "utkast" | "publicerad";
  theme: WebsiteTheme;
  /**
   * Publicerat utseende (tema + accent). Saknas på äldre sajter – då härleds
   * det från det äldre `theme`-fältet (alla äldre sajter blir Klassisk, med
   * en accent som ligger nära den gamla palettens färg).
   */
  design?: WebsiteDesign;
  /**
   * Utkast till utseende: uppdaterar förhandsvisningen direkt men den
   * publicerade sajten först vid "Publicera ändringar" (samma utkast →
   * publicera-modell som sajten i övrigt). Tas bort vid publicering.
   */
  draftDesign?: WebsiteDesign;
  /**
   * Publicerad sidfot (visa/dölj, sociala länkar, kort text).
   * Kontakt, tjänster och logotyp hämtas live – de kopieras inte in här.
   */
  footer?: WebsiteFooter;
  /**
   * Utkast till sidfot. Förhandsvisningen använder det direkt; den publika
   * sajten först vid "Publicera ändringar". Tas bort vid publicering.
   */
  draftFooter?: WebsiteFooter;
  /** Publicerade sektioner (det besökare ser). */
  sections: WebsiteSection[];
  /**
   * Utkast till sektioner: byggaren och förhandsvisningen använder det,
   * den publika sajten först vid "Publicera ändringar". Tas bort vid
   * publicering eller Återställ.
   */
  draftSections?: WebsiteSection[];
  /** Gemensam primärknapp i sidhuvud och startsektion. Saknas = DEFAULT_PRIMARY_CTA_LABEL. */
  primaryCta?: { label: string };
  /** Utkast till primärknapp. Samma modell som draftSections. */
  draftPrimaryCta?: { label: string };
  /**
   * Valfritt tillägg till den automatiska integritetspolicyn i STANDARD-läge.
   * Företagsnamn, org.nr, adress och kontakt hämtas alltid live från
   * företagsuppgifterna.
   */
  privacyPolicySupplement?: string;
  /**
   * Publicerat läge. Saknas = standard (Ferva underhåller policyn).
   * Befintliga sajter utan fältet är STANDARD – inget databortfall.
   */
  privacyPolicyMode?: PrivacyPolicyMode;
  /**
   * Publicerad anpassad policy (rich text). Tokens för företagsfält
   * interpoleras vid visning. Används bara när mode är custom.
   */
  privacyPolicyCustomBody?: RichTextDoc;
  /**
   * Utkast till integritetspolicy: förhandsvisningen uppdateras direkt,
   * den publika sajten först vid "Publicera ändringar". Tas bort vid
   * publicering när det skiljer sig från det publicerade.
   */
  draftPrivacyPolicy?: PrivacyPolicyState;
  /**
   * Senaste accepterade klientrevisionen för utkastskrivningar.
   * En sen save med lägre eller samma tal som `publishedRevision`
   * ignoreras så att publicering inte kan bli smutsig igen.
   */
  draftRevision?: number;
  /** Revisionen som senast publicerades. */
  publishedRevision?: number;
  publishedAt?: string;
  createdAt: string;
  submissions: number;
}
