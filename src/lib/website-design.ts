import type { Website, WebsiteAccentId, WebsiteDesign, WebsiteTheme, WebsiteThemeId } from "./types";

/**
 * Centralt utseendesystem för kundens hemsida (Hemsida → Utseende).
 *
 * Driva frågar inte "Hur vill du designa din hemsida?" utan "Vilken känsla
 * passar ditt företag?". Därför finns exakt FYRA teman och en kuraterad lista
 * accentfärger – ingen fri färgväljare, inga typsnittsval, ingen CSS.
 *
 * Arkitektur:
 *   * Ett tema är en samling DESIGNTOKENS (färger, typografi, form, skala)
 *     plus STRUKTURVARIANTER (hur hero, kort, sidhuvud m.m. är byggda).
 *   * Renderaren (`site-renderer.tsx`) läser tokens som CSS-variabler och
 *     växlar på variantnamn – aldrig `if (themeId === "robust")` i komponenter.
 *   * Accentens användning ägs av temat. Alla accenter är valda så att vit
 *     text på accentytan alltid klarar WCAG AA (≥ 4.5:1) och accentfärgad
 *     text klarar AA mot varje temas ljusa ytor. `tintText` är accentens
 *     ljusa variant för text på mörka band. Garantierna låses av
 *     `website-design.test.ts` – ändra aldrig en färg utan att testet är grönt.
 *
 * Innehåll och utseende är strikt separerade: att byta tema/accent rör ALDRIG
 * texter, tjänster, bilder, sektionsordning eller formulärbeteende.
 */

/* --------------------------------- Varianter -------------------------------- */

/** Sidhuvudets karaktär. */
export type SiteHeaderVariant = "soft" | "clean" | "band" | "quiet";
/** Startsektionens komposition. */
export type SiteHeroVariant = "balanced" | "spacious" | "band" | "editorial";
/** Tjänstekortens byggnadssätt. */
export type SiteCardVariant = "bordered" | "tinted" | "outlined" | "plain";
/** Galleriets rytm. */
export type SiteGalleryVariant = "soft" | "grid" | "mosaic" | "editorial";
/** Hur sektioner avgränsas från varandra. */
export type SiteSectionVariant = "lined" | "airy" | "banded" | "open";
/** Kontaktsektionens komposition. */
export type SiteContactVariant = "card" | "split" | "band" | "open";
/** Knapparnas form/karaktär. */
export type SiteButtonVariant = "pill" | "rounded" | "block" | "quiet";
/** Bildbehandling (hero/om oss/kort). */
export type SiteImageVariant = "soft" | "clean" | "block" | "editorial";
/** Formulärfältens karaktär. */
export type SiteFieldVariant = "boxed" | "underline";

/* ---------------------------------- Tokens ---------------------------------- */

export interface SiteThemeTokens {
  id: WebsiteThemeId;
  /** Namn i temaväljaren. */
  namn: string;
  /** Känslan – en kort rad i temaväljaren. */
  beskrivning: string;
  /** Exempel på branscher temat passar. */
  passar: string;

  /* Neutrala färger – temat äger allt utom accenten. */
  bg: string;
  ink: string;
  soft: string;
  /** Kort-/panelyta. */
  card: string;
  line: string;
  /** Tydligare linje (fältramar, kraftiga kortramar). */
  lineStrong: string;
  /** Kontrasterande band (mörk yta i Robust; ljus panel i övriga teman). */
  band: string;
  bandInk: string;
  bandSoft: string;
  bandLine: string;
  /** true = bandet är mörkt → accenttext på bandet använder accentens tintText. */
  darkBand: boolean;

  /* Typografi. Endast systemsäkra stackar + Geist (laddas redan globalt) –
     inga extra webbfonter laddas för något tema (prestanda + enkelhet). */
  headingFont: string;
  headingWeight: number;
  headingTracking: string;
  h1Class: string;
  h2Class: string;
  eyebrowClass: string;
  bodyClass: string;

  /* Skala & rytm. */
  contentWidth: string;
  /** Bredare mått för bild-/galleriytor (editoriala teman låter bilder ta plats). */
  wideWidth: string;
  sectionYClass: string;

  /* Form. */
  radiusCard: string;
  radiusButton: string;
  radiusImage: string;
  radiusField: string;

  /* Strukturvarianter – komponenterna växlar på dessa, aldrig på tema-id. */
  header: SiteHeaderVariant;
  hero: SiteHeroVariant;
  cards: SiteCardVariant;
  gallery: SiteGalleryVariant;
  sections: SiteSectionVariant;
  contact: SiteContactVariant;
  buttons: SiteButtonVariant;
  images: SiteImageVariant;
  fields: SiteFieldVariant;
}

export interface SiteAccentTokens {
  id: WebsiteAccentId;
  namn: string;
  /** Accentytan (knappar, markörer). Garanterat ≥ 4.5:1 mot `ink`-texten nedan. */
  color: string;
  /** Text PÅ accentytan (alltid ljus – accenterna är valda för det). */
  ink: string;
  /** Accentfärgad TEXT på mörka band – ljusare variant, ≥ 4.5:1 mot bandet. */
  tintText: string;
}

/* ---------------------------------- Teman ----------------------------------- */

const SERIF_STACK =
  '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif';
const SANS_STACK =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

/**
 * Exakt fyra teman. Håll dem TYDLIGT olika: komposition, typografi, rytm och
 * ytbehandling – inte bara radie och färg.
 */
export const WEBSITE_THEMES: Record<WebsiteThemeId, SiteThemeTokens> = {
  /** Varm, pålitlig, hantverk – ≈ Drivas ursprungliga sajtutseende. */
  klassisk: {
    id: "klassisk",
    namn: "Klassisk",
    beskrivning: "Varm och personlig",
    passar: "Snickeri, måleri, lokala tjänster",
    bg: "#faf7f2",
    ink: "#2b2118",
    soft: "#6f6152",
    card: "#ffffff",
    line: "#eae3d7",
    lineStrong: "#dbd2c1",
    band: "#ffffff",
    bandInk: "#2b2118",
    bandSoft: "#6f6152",
    bandLine: "#eae3d7",
    darkBand: false,
    headingFont: SERIF_STACK,
    headingWeight: 700,
    headingTracking: "-0.01em",
    h1Class: "text-[32px] leading-[1.14] @2xl:text-[42px]",
    h2Class: "text-[24px] leading-[1.25] @2xl:text-[27px]",
    eyebrowClass: "text-[12px] font-semibold uppercase tracking-[0.18em]",
    bodyClass: "text-[16px] leading-relaxed",
    contentWidth: "56rem",
    wideWidth: "56rem",
    sectionYClass: "py-14 @2xl:py-16",
    radiusCard: "1rem",
    radiusButton: "999px",
    radiusImage: "1.5rem",
    radiusField: "0.75rem",
    header: "soft",
    hero: "balanced",
    cards: "bordered",
    gallery: "soft",
    sections: "lined",
    contact: "card",
    buttons: "pill",
    images: "soft",
    fields: "boxed",
  },

  /** Ren, professionell, digital – stora rubriker och mycket luft. */
  modern: {
    id: "modern",
    namn: "Modern",
    beskrivning: "Ren och professionell",
    passar: "Installation, teknik, konsult",
    bg: "#ffffff",
    ink: "#101418",
    soft: "#4d5661",
    card: "#f4f6f8",
    line: "#e6eaee",
    lineStrong: "#d3dae1",
    band: "#f4f6f8",
    bandInk: "#101418",
    bandSoft: "#4d5661",
    bandLine: "#e6eaee",
    darkBand: false,
    headingFont: SANS_STACK,
    headingWeight: 660,
    headingTracking: "-0.035em",
    h1Class: "text-[36px] leading-[1.05] @2xl:text-[52px] @5xl:text-[58px]",
    h2Class: "text-[26px] leading-[1.15] @2xl:text-[32px]",
    eyebrowClass: "text-[12.5px] font-semibold uppercase tracking-[0.14em]",
    bodyClass: "text-[16px] leading-relaxed @2xl:text-[17px]",
    contentWidth: "66rem",
    wideWidth: "66rem",
    sectionYClass: "py-16 @2xl:py-24",
    radiusCard: "1rem",
    radiusButton: "0.625rem",
    radiusImage: "1rem",
    radiusField: "0.625rem",
    header: "clean",
    hero: "spacious",
    cards: "tinted",
    gallery: "grid",
    sections: "airy",
    contact: "split",
    buttons: "rounded",
    images: "clean",
    fields: "boxed",
  },

  /** Stark, praktisk, industriell – blockig, hög kontrast, tydlig CTA. */
  robust: {
    id: "robust",
    namn: "Robust",
    beskrivning: "Stabil och kraftfull",
    passar: "Bygg, markarbete, VVS, el",
    bg: "#f4f4f1",
    ink: "#191a1c",
    soft: "#4c4e51",
    card: "#ffffff",
    line: "#d9d9d3",
    lineStrong: "#b9b9b1",
    band: "#191a1c",
    bandInk: "#f7f7f4",
    bandSoft: "#c4c5bf",
    bandLine: "#33342f",
    darkBand: true,
    headingFont: SANS_STACK,
    headingWeight: 800,
    headingTracking: "-0.015em",
    h1Class: "text-[33px] leading-[1.07] @2xl:text-[46px]",
    h2Class: "text-[20px] leading-[1.2] uppercase tracking-[0.05em] @2xl:text-[23px]",
    eyebrowClass: "text-[12px] font-bold uppercase tracking-[0.2em]",
    bodyClass: "text-[15.5px] leading-relaxed",
    contentWidth: "58rem",
    wideWidth: "58rem",
    sectionYClass: "py-12 @2xl:py-16",
    radiusCard: "0px",
    radiusButton: "2px",
    radiusImage: "0px",
    radiusField: "2px",
    header: "band",
    hero: "band",
    cards: "outlined",
    gallery: "mosaic",
    sections: "banded",
    contact: "band",
    buttons: "block",
    images: "block",
    fields: "boxed",
  },

  /** Premium, lugn, arkitektonisk – luft, bilder och återhållna detaljer. */
  minimal: {
    id: "minimal",
    namn: "Minimal",
    beskrivning: "Elegant och avskalad",
    passar: "Finsnickeri, inredning, design",
    bg: "#fcfcfa",
    ink: "#1b1b18",
    soft: "#67675f",
    card: "#ffffff",
    line: "#e9e9e2",
    lineStrong: "#d2d2c9",
    band: "#f4f4ef",
    bandInk: "#1b1b18",
    bandSoft: "#67675f",
    bandLine: "#e9e9e2",
    darkBand: false,
    headingFont: SANS_STACK,
    headingWeight: 380,
    headingTracking: "-0.02em",
    h1Class: "text-[32px] leading-[1.14] @2xl:text-[46px] @5xl:text-[52px]",
    h2Class: "text-[24px] leading-[1.25] @2xl:text-[30px]",
    eyebrowClass: "text-[11.5px] font-medium uppercase tracking-[0.24em]",
    bodyClass: "text-[16px] leading-[1.75]",
    contentWidth: "44rem",
    wideWidth: "62rem",
    sectionYClass: "py-20 @2xl:py-28",
    radiusCard: "0px",
    radiusButton: "0.375rem",
    radiusImage: "0px",
    radiusField: "0px",
    header: "quiet",
    hero: "editorial",
    cards: "plain",
    gallery: "editorial",
    sections: "open",
    contact: "open",
    buttons: "quiet",
    images: "editorial",
    fields: "underline",
  },
};

export const WEBSITE_THEME_IDS = Object.keys(WEBSITE_THEMES) as WebsiteThemeId[];

/* ------------------------------- Accentfärger ------------------------------- */

/**
 * Kuraterade accenter som fungerar i ALLA fyra teman. Varje `color` klarar
 * WCAG AA (≥ 4.5:1) med vit text och som text mot varje temas ljusa ytor;
 * `tintText` klarar AA mot det mörka bandet. Ingen fri färgväljare.
 */
export const WEBSITE_ACCENTS: Record<WebsiteAccentId, SiteAccentTokens> = {
  gron: { id: "gron", namn: "Grön", color: "#2f6a4e", ink: "#ffffff", tintText: "#8ecaa8" },
  bla: { id: "bla", namn: "Blå", color: "#1e3a5f", ink: "#ffffff", tintText: "#a3c4ea" },
  tegel: { id: "tegel", namn: "Tegel", color: "#8f5230", ink: "#ffffff", tintText: "#e0a685" },
  sand: { id: "sand", namn: "Sand", color: "#8a6117", ink: "#ffffff", tintText: "#ddb35f" },
  svart: { id: "svart", namn: "Svart", color: "#23211d", ink: "#ffffff", tintText: "#d9d6cf" },
};

export const WEBSITE_ACCENT_IDS = Object.keys(WEBSITE_ACCENTS) as WebsiteAccentId[];

/* ------------------------------ Standard & arv ------------------------------ */

/** Klassisk + tegel ≈ det ursprungliga Driva-utseendet (varmt hantverk). */
export const DEFAULT_WEBSITE_DESIGN: WebsiteDesign = { themeId: "klassisk", accent: "tegel" };

/**
 * Äldre sajter (skapade före utseendeväljaren) har bara det gamla
 * `theme`-palettfältet. Alla blir KLASSISK – layouten de redan har – med en
 * accent som ligger närmast den gamla palettens färg, så att ingen publicerad
 * sajt byter karaktär av migreringen.
 */
const LEGACY_THEME_DESIGN: Record<WebsiteTheme, WebsiteDesign> = {
  tra: { themeId: "klassisk", accent: "tegel" },
  studio: { themeId: "klassisk", accent: "svart" },
  ren: { themeId: "klassisk", accent: "gron" },
  el: { themeId: "klassisk", accent: "sand" },
  konsult: { themeId: "klassisk", accent: "bla" },
};

export function isWebsiteThemeId(value: unknown): value is WebsiteThemeId {
  return typeof value === "string" && value in WEBSITE_THEMES;
}

export function isWebsiteAccentId(value: unknown): value is WebsiteAccentId {
  return typeof value === "string" && value in WEBSITE_ACCENTS;
}

/** Validerar ett utseende från klienten. Kastar på okända värden. */
export function assertWebsiteDesign(input: { themeId: unknown; accent: unknown }): WebsiteDesign {
  if (!isWebsiteThemeId(input.themeId)) throw new Error("Okänt tema.");
  if (!isWebsiteAccentId(input.accent)) throw new Error("Okänd accentfärg.");
  return { themeId: input.themeId, accent: input.accent };
}

type DesignSource = Pick<Website, "theme"> & Partial<Pick<Website, "design" | "draftDesign">>;

/** Publicerat utseende – det besökare ser på den publika sajten. */
export function publishedWebsiteDesign(site: DesignSource): WebsiteDesign {
  return site.design ?? LEGACY_THEME_DESIGN[site.theme] ?? DEFAULT_WEBSITE_DESIGN;
}

/** Utkastets utseende – det byggaren förhandsvisar (utkast → publicerat → arv). */
export function draftWebsiteDesign(site: DesignSource): WebsiteDesign {
  return site.draftDesign ?? publishedWebsiteDesign(site);
}

export function sameDesign(a: WebsiteDesign, b: WebsiteDesign): boolean {
  return a.themeId === b.themeId && a.accent === b.accent;
}

/* ------------------------------- CSS-variabler ------------------------------ */

/**
 * Tokens → CSS-variabler på sajtens rotelement. Komponenterna konsumerar
 * variablerna (via Tailwinds var()-genvägar eller inline style) i stället för
 * tema-villkor. `--color-accent` sätts också om, så att appens globala
 * fokusmarkering följer sajtens accent inne på sajten.
 */
export function siteCssVars(design: WebsiteDesign): Record<string, string> {
  const t = WEBSITE_THEMES[design.themeId];
  const a = WEBSITE_ACCENTS[design.accent];
  return {
    "--site-bg": t.bg,
    "--site-ink": t.ink,
    "--site-soft": t.soft,
    "--site-card": t.card,
    "--site-line": t.line,
    "--site-line-strong": t.lineStrong,
    "--site-field-bg": t.card,
    "--site-band": t.band,
    "--site-band-ink": t.bandInk,
    "--site-band-soft": t.bandSoft,
    "--site-band-line": t.bandLine,
    "--site-accent": a.color,
    "--site-accent-ink": a.ink,
    "--site-accent-band-text": t.darkBand ? a.tintText : a.color,
    "--site-heading-font": t.headingFont,
    "--site-heading-weight": String(t.headingWeight),
    "--site-heading-tracking": t.headingTracking,
    "--site-radius-card": t.radiusCard,
    "--site-radius-button": t.radiusButton,
    "--site-radius-image": t.radiusImage,
    "--site-radius-field": t.radiusField,
    "--site-content-w": t.contentWidth,
    "--site-wide-w": t.wideWidth,
    "--color-accent": a.color,
  };
}

/** Upplösta tokens för renderaren: tema + accent i ett grepp. */
export function resolveSiteDesign(design: WebsiteDesign): {
  theme: SiteThemeTokens;
  accent: SiteAccentTokens;
  vars: Record<string, string>;
} {
  return {
    theme: WEBSITE_THEMES[design.themeId],
    accent: WEBSITE_ACCENTS[design.accent],
    vars: siteCssVars(design),
  };
}

/* ------------------------------ Kontrastmatematik --------------------------- */

/**
 * WCAG-kontrast (används av testerna som låser läsbarhetsgarantierna, och
 * finns här så att definition och kontroll aldrig glider isär).
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = Number.parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
