import type { CSSProperties, ReactNode } from "react";
import {
  DEFAULT_PRIMARY_CTA_LABEL,
  type CompanySettings,
  type Website,
  type WebsiteDesign,
  type WebsiteSection,
  type WebsiteSectionItem,
} from "@/lib/types";
import {
  publishedWebsiteDesign,
  resolveSiteDesign,
  type SiteButtonVariant,
  type SiteThemeTokens,
} from "@/lib/website-design";
import { SiteContactForm, type SiteFormTokens } from "./site-widgets";
import { SmoothSectionLink } from "./smooth-section-link";

/**
 * Ren renderare för den publika hemsidan. Används i tre lägen: publika sajten
 * (/sajt), förhandsvisning i ny flik (/sajt?preview=1) och live-förhands-
 * visningen i hemsidesbyggaren (där den renderas på klienten så att temabyten
 * syns direkt).
 *
 * UTSEENDESYSTEMET: alla färger/typsnitt/radier kommer som CSS-variabler från
 * `siteCssVars()` och all struktur väljs via temats VARIANTER (hero, kort,
 * sidhuvud …) – aldrig via tema-id i komponenterna. Se `src/lib/website-design.ts`.
 *
 * RESPONSIVITET: byggd med container queries (@container) i stället för
 * viewport-brytpunkter, så att byggarens förhandsvisning visar exakt samma
 * mobil-/surfplattelayout som en riktig enhet med samma bredd.
 */

const GALLERY_TONES = [0.16, 0.26, 0.2, 0.3, 0.12, 0.24];
const SECTION_SCROLL = "scroll-mt-[4.5rem]";

function isVisible(section: WebsiteSection): boolean {
  return section.visible !== false;
}

function primaryCtaLabel(website: Website): string {
  const label = website.primaryCta?.label?.trim();
  return label || DEFAULT_PRIMARY_CTA_LABEL;
}

/* ------------------------------ Byggstenar ---------------------------------- */

/** Rubrik som ärver temats typsnitt/vikt/spärrning via CSS-variabler. */
function SiteHeading({
  as: Tag = "h2",
  className,
  children,
}: {
  as?: "h1" | "h2" | "h3";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      className={className}
      style={{
        fontFamily: "var(--site-heading-font)",
        fontWeight: "var(--site-heading-weight)" as CSSProperties["fontWeight"],
        letterSpacing: "var(--site-heading-tracking)",
      }}
    >
      {children}
    </Tag>
  );
}

/** Primärknappen ("Begär offert") – ska vara självklar i ALLA teman. */
function primaryButtonClass(variant: SiteButtonVariant, size: "md" | "lg" = "lg"): string {
  const base =
    "inline-flex items-center justify-center rounded-(--site-radius-button) bg-(--site-accent) text-(--site-accent-ink) transition-opacity hover:opacity-90";
  switch (variant) {
    case "pill":
      return `${base} font-semibold shadow-sm ${size === "lg" ? "px-6 py-3 text-[14px]" : "px-4 py-2 text-[13px]"}`;
    case "rounded":
      return `${base} font-semibold ${size === "lg" ? "px-6 py-3.5 text-[15px]" : "px-4 py-2 text-[13.5px]"}`;
    case "block":
      return `${base} font-bold uppercase tracking-[0.07em] ${size === "lg" ? "px-7 py-3.5 text-[13.5px]" : "px-4 py-2 text-[12px]"}`;
    case "quiet":
      return `${base} font-medium tracking-[0.01em] ${size === "lg" ? "px-6 py-3 text-[14px]" : "px-4 py-2 text-[13px]"}`;
  }
}

/** Sekundär länk/knapp (t.ex. "Våra tjänster"). */
function secondaryButtonClass(variant: SiteButtonVariant, onBand = false): string {
  const surface = onBand
    ? "border-(--site-band-line) text-(--site-band-ink) hover:bg-white/5"
    : "border-(--site-line) bg-(--site-card) text-(--site-ink) hover:border-(--site-soft)";
  const base = `inline-flex items-center justify-center rounded-(--site-radius-button) border transition-colors ${surface}`;
  switch (variant) {
    case "pill":
      return `${base} px-6 py-3 text-[14px] font-semibold`;
    case "rounded":
      return `${base} px-6 py-3.5 text-[15px] font-semibold`;
    case "block":
      return `${base} border-2 px-7 py-3.5 text-[13.5px] font-bold uppercase tracking-[0.07em]`;
    case "quiet":
      return `${base} px-6 py-3 text-[14px] font-medium`;
  }
}

/**
 * Logotyp i sidhuvudet: bred logga skalas på höjd, kvadratisk får fast ruta,
 * ingen logga → företagsnamnet räcker. På mörka band får loggan en ljus
 * platta så att mörka logotyper aldrig försvinner.
 */
function SiteLogo({
  company,
  name,
  onBand,
}: {
  company: CompanySettings;
  name: string;
  onBand: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {company.logoDataUrl ? (
        // Data-URL:er (inga filer i en mediabank) – next/image passar inte här.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={company.logoDataUrl}
          alt=""
          className={`h-8 w-auto max-w-[120px] shrink-0 rounded-md object-contain ${onBand ? "bg-white/95 p-0.5" : ""}`}
        />
      ) : null}
      <span className="truncate">{name}</span>
    </span>
  );
}

/* --------------------------------- Rot -------------------------------------- */

export function SiteRenderer({
  website,
  company,
  interactive = true,
  design,
}: {
  website: Website;
  company: CompanySettings;
  interactive?: boolean;
  /** Utseendet som ska renderas. Saknas → sajtens publicerade utseende. */
  design?: WebsiteDesign;
}) {
  const { theme, vars } = resolveSiteDesign(design ?? publishedWebsiteDesign(website));
  const sections = website.sections.filter(isVisible);
  const contactOn = sections.some((s) => s.type === "kontakt");
  const servicesOn = sections.some((s) => s.type === "tjanster");

  return (
    <div
      data-site-theme={theme.id}
      style={vars as CSSProperties}
      className="@container min-h-full bg-(--site-bg) font-sans text-(--site-ink)"
    >
      <SiteHeader website={website} company={company} theme={theme} contactOn={contactOn} />

      {sections.map((section, index) => {
        const lined = index > 0;
        switch (section.type) {
          case "hero":
            return (
              <HeroSection
                key={section.id}
                website={website}
                company={company}
                section={section}
                theme={theme}
                lined={lined}
                contactOn={contactOn}
                servicesOn={servicesOn}
              />
            );
          case "tjanster":
            return <ServicesSection key={section.id} section={section} theme={theme} lined={lined} />;
          case "om":
            return <AboutSection key={section.id} section={section} theme={theme} lined={lined} />;
          case "galleri":
            return <GallerySection key={section.id} section={section} theme={theme} lined={lined} />;
          case "kontakt":
            return (
              <ContactSection
                key={section.id}
                website={website}
                company={company}
                section={section}
                theme={theme}
                lined={lined}
                interactive={interactive}
              />
            );
          default:
            return null;
        }
      })}

      <SiteFooter website={website} company={company} theme={theme} />
    </div>
  );
}

/* -------------------------------- Sidhuvud ---------------------------------- */

function SiteHeader({
  website,
  company,
  theme,
  contactOn,
}: {
  website: Website;
  company: CompanySettings;
  theme: SiteThemeTokens;
  contactOn: boolean;
}) {
  const onBand = theme.header === "band";
  const cta = contactOn ? (
    <SmoothSectionLink href="#kontakt" className={`shrink-0 ${primaryButtonClass(theme.buttons, "md")}`}>
      {primaryCtaLabel(website)}
    </SmoothSectionLink>
  ) : null;

  const inner = (
    <div
      className={`mx-auto flex max-w-(--site-content-w) items-center justify-between gap-3 px-6 ${
        theme.header === "clean" ? "py-4.5" : theme.header === "quiet" ? "py-5" : "py-4"
      }`}
    >
      <span
        className={`min-w-0 text-[15px] tracking-tight ${
          theme.header === "band"
            ? "font-extrabold uppercase tracking-[0.05em] text-(--site-band-ink)"
            : theme.header === "quiet"
              ? "text-[14px] font-medium tracking-[0.12em] uppercase"
              : "font-bold"
        }`}
      >
        <SiteLogo company={company} name={website.businessName} onBand={onBand} />
      </span>
      {cta}
    </div>
  );

  switch (theme.header) {
    case "soft":
      return (
        <header
          className="sticky top-0 z-10 border-b border-(--site-line) backdrop-blur"
          style={{ background: "color-mix(in srgb, var(--site-bg) 88%, transparent)" }}
        >
          {inner}
        </header>
      );
    case "clean":
      return <header className="sticky top-0 z-10 border-b border-(--site-line) bg-(--site-bg)">{inner}</header>;
    case "band":
      return (
        <header
          className="sticky top-0 z-10 border-b-2 border-(--site-accent) bg-(--site-band) text-(--site-band-ink)"
          style={{ "--color-accent": "var(--site-accent-band-text)" } as CSSProperties}
        >
          {inner}
        </header>
      );
    case "quiet":
      return (
        <header
          className="sticky top-0 z-10 backdrop-blur"
          style={{ background: "color-mix(in srgb, var(--site-bg) 92%, transparent)" }}
        >
          {inner}
        </header>
      );
  }
}

/* ------------------------------ Sektionsram --------------------------------- */

/**
 * Gemensam ram: sektionsavgränsning enligt temats `sections`-variant och
 * innehållsbredd/rytm via tokens. Bandsektioner (mörk yta) hanterar sin
 * bakgrund själva och hoppar över linjen.
 */
function SectionShell({
  id,
  lined,
  theme,
  wide,
  children,
  padded = true,
}: {
  id: string;
  lined: boolean;
  theme: SiteThemeTokens;
  wide?: boolean;
  children: ReactNode;
  padded?: boolean;
}) {
  const divider =
    lined && theme.sections === "lined"
      ? "border-t border-(--site-line)"
      : lined && theme.sections === "banded"
        ? "border-t-2 border-(--site-line)"
        : "";
  return (
    <section id={id} className={`${SECTION_SCROLL} ${divider}`}>
      <div
        className={`mx-auto px-6 ${wide ? "max-w-(--site-wide-w)" : "max-w-(--site-content-w)"} ${
          padded ? theme.sectionYClass : ""
        }`}
      >
        {children}
      </div>
    </section>
  );
}

/** Bild med temats bildbehandling (mjuk/ren/blockig/editorial). */
function SiteImage({ src, className }: { src: string; className?: string }) {
  return (
    // Data-URL:er (inga filer i en mediabank) – next/image passar inte här.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      className={`w-full rounded-(--site-radius-image) object-cover ${className ?? ""}`}
    />
  );
}

/* ------------------------------ Startsektion -------------------------------- */

function HeroSection({
  website,
  company,
  section,
  theme,
  lined,
  contactOn,
  servicesOn,
}: {
  website: Website;
  company: CompanySettings;
  section: WebsiteSection;
  theme: SiteThemeTokens;
  lined: boolean;
  contactOn: boolean;
  servicesOn: boolean;
}) {
  const city = website.city ?? company.city;
  const onBand = theme.hero === "band";
  const ctas =
    contactOn || servicesOn ? (
      <>
        {contactOn ? (
          <SmoothSectionLink href="#kontakt" className={primaryButtonClass(theme.buttons)}>
            {primaryCtaLabel(website)}
          </SmoothSectionLink>
        ) : null}
        {servicesOn ? (
          <SmoothSectionLink href="#tjanster" className={secondaryButtonClass(theme.buttons, onBand)}>
            Våra tjänster
          </SmoothSectionLink>
        ) : null}
      </>
    ) : null;

  const eyebrow = (
    <p className={`${theme.eyebrowClass} text-(--site-accent-band-text)`}>{city}</p>
  );

  switch (theme.hero) {
    /* Klassisk: balanserad – centrerad utan bild, tvåspalt med bild. */
    case "balanced": {
      if (!section.image) {
        return (
          <SectionShell id="start" lined={lined} theme={theme} padded={false}>
            <div data-hero-layout="text" className="pb-16 pt-16 text-center @2xl:pt-24">
              {eyebrow}
              <SiteHeading as="h1" className={`mx-auto mt-3 max-w-2xl ${theme.h1Class}`}>
                {section.heading}
              </SiteHeading>
              <p className={`mx-auto mt-4 max-w-xl ${theme.bodyClass} text-(--site-soft)`}>{section.body}</p>
              {ctas ? <div className="mt-7 flex flex-wrap items-center justify-center gap-3">{ctas}</div> : null}
            </div>
          </SectionShell>
        );
      }
      return (
        <SectionShell id="start" lined={lined} theme={theme} padded={false}>
          <div data-hero-layout="split" className="pb-16 pt-12 @2xl:pt-16">
            <div className="flex flex-col gap-8 @3xl:grid @3xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] @3xl:items-stretch @3xl:gap-10">
              <div className="flex min-w-0 flex-col justify-center">
                {eyebrow}
                <SiteHeading as="h1" className={`mt-3 ${theme.h1Class}`}>
                  {section.heading}
                </SiteHeading>
                <p className={`mt-4 max-w-xl ${theme.bodyClass} text-(--site-soft)`}>{section.body}</p>
                {ctas ? <div className="mt-7 flex flex-wrap items-center gap-3">{ctas}</div> : null}
              </div>
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-(--site-radius-image) border border-(--site-line) @3xl:aspect-auto @3xl:min-h-[20rem]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={section.image} alt="" className="absolute inset-0 size-full object-cover object-center" />
              </div>
            </div>
          </div>
        </SectionShell>
      );
    }

    /* Modern: luftig – vänsterställd stor rubrik, bilden brett under. */
    case "spacious":
      return (
        <SectionShell id="start" lined={lined} theme={theme} padded={false}>
          <div data-hero-layout={section.image ? "split" : "text"} className="pb-16 pt-16 @2xl:pb-24 @2xl:pt-28">
            <div className="max-w-3xl">
              {eyebrow}
              <SiteHeading as="h1" className={`mt-4 ${theme.h1Class}`}>
                {section.heading}
              </SiteHeading>
              <p className={`mt-5 max-w-xl ${theme.bodyClass} text-(--site-soft)`}>{section.body}</p>
              {ctas ? <div className="mt-8 flex flex-wrap items-center gap-3">{ctas}</div> : null}
            </div>
            {section.image ? (
              <div className="mt-10 @2xl:mt-14">
                <SiteImage src={section.image} className="aspect-[16/10] @3xl:aspect-[21/9]" />
              </div>
            ) : null}
          </div>
        </SectionShell>
      );

    /* Robust: mörkt band i full bredd, tung rubrik, kraftfull CTA. */
    case "band":
      return (
        <section
          id="start"
          data-hero-layout={section.image ? "split" : "text"}
          className={`${SECTION_SCROLL} border-b-4 border-(--site-accent) bg-(--site-band) text-(--site-band-ink)`}
          style={{ "--color-accent": "var(--site-accent-band-text)" } as CSSProperties}
        >
          <div className="mx-auto max-w-(--site-content-w) px-6 pb-14 pt-14 @2xl:pb-20 @2xl:pt-20">
            <div
              className={
                section.image
                  ? "flex flex-col gap-8 @3xl:grid @3xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] @3xl:items-stretch @3xl:gap-10"
                  : ""
              }
            >
              <div className="flex min-w-0 flex-col justify-center">
                {eyebrow}
                <SiteHeading as="h1" className={`mt-3 max-w-2xl ${theme.h1Class}`}>
                  {section.heading}
                </SiteHeading>
                <p className={`mt-4 max-w-xl ${theme.bodyClass} text-(--site-band-soft)`}>{section.body}</p>
                {ctas ? <div className="mt-8 flex flex-wrap items-center gap-3">{ctas}</div> : null}
              </div>
              {section.image ? (
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-(--site-radius-image) @3xl:aspect-auto @3xl:min-h-[20rem]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={section.image} alt="" className="absolute inset-0 size-full object-cover object-center" />
                </div>
              ) : null}
            </div>
          </div>
        </section>
      );

    /* Minimal: editorial – bilden först och störst, texten smal och centrerad. */
    case "editorial":
      return (
        <SectionShell id="start" lined={lined} theme={theme} wide padded={false}>
          <div data-hero-layout={section.image ? "split" : "text"} className={section.image ? "pt-8 @2xl:pt-12" : "pt-20 @2xl:pt-32"}>
            {section.image ? <SiteImage src={section.image} className="aspect-[3/2] @3xl:aspect-[2/1]" /> : null}
            <div className={`mx-auto max-w-2xl pb-20 text-center ${section.image ? "pt-12 @2xl:pt-16" : ""} @2xl:pb-28`}>
              {eyebrow}
              <SiteHeading as="h1" className={`mx-auto mt-4 ${theme.h1Class}`}>
                {section.heading}
              </SiteHeading>
              <p className={`mx-auto mt-5 max-w-xl ${theme.bodyClass} text-(--site-soft)`}>{section.body}</p>
              {ctas ? <div className="mt-8 flex flex-wrap items-center justify-center gap-3">{ctas}</div> : null}
            </div>
          </div>
        </SectionShell>
      );
  }
}

/* -------------------------------- Tjänster ---------------------------------- */

function ServicesSection({
  section,
  theme,
  lined,
}: {
  section: WebsiteSection;
  theme: SiteThemeTokens;
  lined: boolean;
}) {
  const centered = theme.cards === "plain";
  return (
    <SectionShell id="tjanster" lined={lined} theme={theme}>
      <div className={centered ? "mx-auto max-w-2xl text-center" : undefined}>
        <SiteHeading as="h2" className={theme.h2Class}>
          {section.heading}
        </SiteHeading>
        {section.body ? (
          <p className={`mt-2 ${centered ? "mx-auto" : ""} max-w-xl text-[15px] leading-relaxed text-(--site-soft)`}>
            {section.body}
          </p>
        ) : null}
      </div>
      <ServicesGrid items={section.items ?? []} theme={theme} />
    </SectionShell>
  );
}

function ServicesGrid({ items, theme }: { items: WebsiteSectionItem[]; theme: SiteThemeTokens }) {
  if (items.length === 0) {
    return (
      <p className="mt-8 rounded-(--site-radius-card) border border-(--site-line) bg-(--site-card) px-5 py-8 text-center text-[14px] text-(--site-soft)">
        Inga tjänster att visa ännu.
      </p>
    );
  }

  const cols =
    items.length === 1
      ? "grid-cols-1 @2xl:max-w-xl"
      : items.length === 2
        ? "grid-cols-1 @2xl:grid-cols-2"
        : "grid-cols-1 @2xl:grid-cols-2 @5xl:grid-cols-3";

  switch (theme.cards) {
    /* Klassisk: traditionella vita kort med hårfin ram. */
    case "bordered":
      return (
        <div className={`mt-8 grid gap-4 ${cols}`}>
          {items.map((item, i) => (
            <div
              key={`${item.title}-${i}`}
              className="overflow-hidden rounded-(--site-radius-card) border border-(--site-line) bg-(--site-card)"
            >
              {item.image ? <SiteImage src={item.image} className="aspect-[16/10] rounded-none" /> : null}
              <div className="p-5">
                {item.image ? null : <div className="size-2.5 rounded-full bg-(--site-accent)" />}
                <h3 className={`text-[16px] font-semibold ${item.image ? "" : "mt-3"}`}>{item.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-(--site-soft)">{item.text}</p>
              </div>
            </div>
          ))}
        </div>
      );

    /* Modern: tonade ytor utan ramar – luft och tydligt grid. */
    case "tinted":
      return (
        <div className={`mt-10 grid gap-5 ${cols}`}>
          {items.map((item, i) => (
            <div key={`${item.title}-${i}`} className="rounded-(--site-radius-card) bg-(--site-card) p-6">
              {item.image ? (
                <SiteImage src={item.image} className="mb-5 aspect-[16/10] rounded-[calc(var(--site-radius-card)-0.375rem)]" />
              ) : (
                <div className="mb-4 h-1 w-8 rounded-full bg-(--site-accent)" />
              )}
              <h3 className="text-[17px] font-semibold tracking-[-0.01em]">{item.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-(--site-soft)">{item.text}</p>
            </div>
          ))}
        </div>
      );

    /* Robust: blockiga kort med kraftig ram och accentlist. */
    case "outlined":
      return (
        <div className={`mt-8 grid gap-4 ${cols}`}>
          {items.map((item, i) => (
            <div
              key={`${item.title}-${i}`}
              className="overflow-hidden rounded-(--site-radius-card) border-2 border-(--site-line-strong) bg-(--site-card)"
            >
              <div className="h-1 bg-(--site-accent)" aria-hidden />
              {item.image ? <SiteImage src={item.image} className="aspect-[16/10] rounded-none" /> : null}
              <div className="p-5">
                <h3 className="text-[14px] font-bold uppercase tracking-[0.06em]">{item.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-(--site-soft)">{item.text}</p>
              </div>
            </div>
          ))}
        </div>
      );

    /* Minimal: inga kort alls – hårfina linjer och mycket luft. */
    case "plain":
      return (
        <div className="mx-auto mt-12 grid max-w-3xl gap-x-14 gap-y-10 text-left @3xl:grid-cols-2">
          {items.map((item, i) => (
            <div key={`${item.title}-${i}`} className="border-t border-(--site-line) pt-6">
              {item.image ? <SiteImage src={item.image} className="mb-5 aspect-[16/10]" /> : null}
              <h3 className="text-[17px] font-medium">{item.title}</h3>
              <p className="mt-2 text-[14.5px] leading-[1.7] text-(--site-soft)">{item.text}</p>
            </div>
          ))}
        </div>
      );
  }
}

/* --------------------------------- Om oss ----------------------------------- */

function AboutSection({
  section,
  theme,
  lined,
}: {
  section: WebsiteSection;
  theme: SiteThemeTokens;
  lined: boolean;
}) {
  const copy = (
    <>
      <SiteHeading as="h2" className={theme.h2Class}>
        {section.heading}
      </SiteHeading>
      <p className={`mt-3 ${theme.bodyClass} text-[15px] text-(--site-soft)`}>{section.body}</p>
    </>
  );

  if (theme.images === "editorial") {
    return (
      <SectionShell id="om" lined={lined} theme={theme}>
        <div className="mx-auto max-w-2xl text-center">{copy}</div>
        {section.image ? (
          <div className="mx-auto mt-12 max-w-(--site-wide-w)">
            <SiteImage src={section.image} className="aspect-[2/1]" />
          </div>
        ) : null}
      </SectionShell>
    );
  }

  return (
    <SectionShell id="om" lined={lined} theme={theme}>
      {section.image ? (
        <div className="grid items-center gap-8 @2xl:grid-cols-2 @2xl:gap-10">
          <div>{copy}</div>
          <SiteImage
            src={section.image}
            className={`aspect-[4/3] ${theme.images === "soft" ? "" : theme.images === "clean" ? "" : "border-2 border-(--site-line-strong)"}`}
          />
        </div>
      ) : (
        <div className="mx-auto max-w-2xl text-center">{copy}</div>
      )}
    </SectionShell>
  );
}

/* --------------------------------- Galleri ---------------------------------- */

function GallerySection({
  section,
  theme,
  lined,
}: {
  section: WebsiteSection;
  theme: SiteThemeTokens;
  lined: boolean;
}) {
  const centered = theme.gallery === "editorial";
  const grid =
    theme.gallery === "soft"
      ? "mt-6 grid grid-cols-2 gap-3 @2xl:grid-cols-3"
      : theme.gallery === "grid"
        ? "mt-10 grid grid-cols-2 gap-4 @3xl:grid-cols-3"
        : theme.gallery === "mosaic"
          ? "mt-8 grid grid-cols-2 gap-1.5 @2xl:grid-cols-3"
          : "mt-12 grid grid-cols-1 gap-8 @2xl:grid-cols-2";
  const tile =
    theme.gallery === "editorial"
      ? "aspect-[4/5]"
      : theme.gallery === "grid"
        ? "aspect-[4/3]"
        : "aspect-square";

  return (
    <SectionShell id="galleri" lined={lined} theme={theme} wide={theme.gallery === "editorial"}>
      <div className={centered ? "mx-auto max-w-2xl text-center" : undefined}>
        <SiteHeading as="h2" className={theme.h2Class}>
          {section.heading}
        </SiteHeading>
        <p className="mt-2 text-[15px] text-(--site-soft)">{section.body}</p>
      </div>
      <div className={grid}>
        {GALLERY_TONES.map((tone, i) => (
          <figure key={i} className="m-0">
            <div
              className={`flex ${tile} items-end rounded-(--site-radius-image) p-3 ${
                theme.gallery === "mosaic" ? "" : "border border-(--site-line)"
              }`}
              style={{ background: `color-mix(in srgb, var(--site-accent) ${Math.round(tone * 100)}%, var(--site-card))` }}
            >
              {theme.gallery === "editorial" ? null : (
                <span className="text-[11px] font-medium text-(--site-ink)">Projekt {i + 1}</span>
              )}
            </div>
            {theme.gallery === "editorial" ? (
              <figcaption className="mt-2 text-center text-[12px] tracking-[0.06em] text-(--site-soft)">
                Projekt {i + 1}
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>
    </SectionShell>
  );
}

/* --------------------------------- Kontakt ---------------------------------- */

function contactFormTokens(theme: SiteThemeTokens, onBand: boolean): SiteFormTokens {
  const fieldBase =
    theme.fields === "underline"
      ? "w-full rounded-none border-0 border-b border-(--site-line-strong) bg-transparent px-0.5 py-2.5 text-[14px] text-(--site-ink) placeholder:text-(--site-soft) focus:border-(--site-accent)"
      : onBand
        ? "w-full rounded-(--site-radius-field) border border-transparent bg-white px-3.5 py-2.5 text-[14px] text-(--site-ink) placeholder:text-(--site-soft)"
        : "w-full rounded-(--site-radius-field) border border-(--site-line-strong) bg-(--site-field-bg) px-3.5 py-2.5 text-[14px] text-(--site-ink) placeholder:text-(--site-soft) focus:border-(--site-accent)";
  return {
    field: fieldBase,
    button: `${primaryButtonClass(theme.buttons)} w-full disabled:opacity-60`,
    confirm:
      "rounded-(--site-radius-card) border border-(--site-line) bg-(--site-card) p-6 text-center text-(--site-ink)",
    error: onBand ? "text-[13px] font-medium text-[#ffb3a8]" : "text-[13px] font-medium text-[#b42318]",
  };
}

function ContactSection({
  website,
  company,
  section,
  theme,
  lined,
  interactive,
}: {
  website: Website;
  company: CompanySettings;
  section: WebsiteSection;
  theme: SiteThemeTokens;
  lined: boolean;
  interactive: boolean;
}) {
  const info = (
    <>
      {company.phone} · {company.email} · {website.city ?? company.city}
    </>
  );

  switch (theme.contact) {
    /* Klassisk: ljus panelyta över hela bredden, centrerat formulär. */
    case "card":
      return (
        <section
          id="kontakt"
          className={`${SECTION_SCROLL} bg-(--site-band) ${lined && theme.sections === "lined" ? "border-t border-(--site-line)" : ""}`}
          style={{ "--site-field-bg": "var(--site-bg)" } as CSSProperties}
        >
          <div className="mx-auto max-w-xl px-6 py-16 text-center">
            <SiteHeading as="h2" className={theme.h2Class}>
              {section.heading}
            </SiteHeading>
            <p className="mt-2 text-[15px] leading-relaxed text-(--site-soft)">{section.body}</p>
            <div className="mt-7 text-left">
              <SiteContactForm interactive={interactive} tokens={contactFormTokens(theme, false)} />
            </div>
            <p className="mt-6 text-[13px] text-(--site-soft)">{info}</p>
          </div>
        </section>
      );

    /* Modern: tvåspalt – budskap till vänster, formulär på kort till höger. */
    case "split":
      return (
        <SectionShell id="kontakt" lined={lined} theme={theme}>
          <div
            className="grid gap-10 rounded-(--site-radius-card) bg-(--site-band) p-6 @2xl:p-10 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] @3xl:gap-14"
            style={{ "--site-field-bg": "#ffffff" } as CSSProperties}
          >
            <div>
              <SiteHeading as="h2" className={theme.h2Class}>
                {section.heading}
              </SiteHeading>
              <p className="mt-3 text-[15px] leading-relaxed text-(--site-soft)">{section.body}</p>
              <p className="mt-6 text-[14px] font-medium text-(--site-ink)">{info}</p>
            </div>
            <div>
              <SiteContactForm interactive={interactive} tokens={contactFormTokens(theme, false)} />
            </div>
          </div>
        </SectionShell>
      );

    /* Robust: mörkt band – formuläret står ut maximalt. */
    case "band":
      return (
        <section
          id="kontakt"
          className={`${SECTION_SCROLL} bg-(--site-band) text-(--site-band-ink)`}
          style={{ "--color-accent": "var(--site-accent-band-text)" } as CSSProperties}
        >
          <div className="mx-auto max-w-xl px-6 py-14 @2xl:py-16">
            <div className="text-center">
              <SiteHeading as="h2" className={theme.h2Class}>
                {section.heading}
              </SiteHeading>
              <p className="mt-2 text-[15px] leading-relaxed text-(--site-band-soft)">{section.body}</p>
            </div>
            <div className="mt-7">
              <SiteContactForm interactive={interactive} tokens={contactFormTokens(theme, true)} />
            </div>
            <p className="mt-6 text-center text-[13px] text-(--site-band-soft)">{info}</p>
          </div>
        </section>
      );

    /* Minimal: öppet och smalt – understrukna fält, ingen panel. */
    case "open":
      return (
        <SectionShell id="kontakt" lined={lined} theme={theme}>
          <div className="mx-auto max-w-lg text-center">
            <SiteHeading as="h2" className={theme.h2Class}>
              {section.heading}
            </SiteHeading>
            <p className={`mt-3 text-[15px] ${theme.bodyClass} text-(--site-soft)`}>{section.body}</p>
            <div className="mt-9 text-left">
              <SiteContactForm interactive={interactive} tokens={contactFormTokens(theme, false)} />
            </div>
            <p className="mt-8 text-[13px] tracking-[0.02em] text-(--site-soft)">{info}</p>
          </div>
        </SectionShell>
      );
  }
}

/* --------------------------------- Sidfot ----------------------------------- */

function SiteFooter({
  website,
  company,
  theme,
}: {
  website: Website;
  company: CompanySettings;
  theme: SiteThemeTokens;
}) {
  const line = (
    <>
      © {new Date().getFullYear()} {website.businessName} · Org.nr {company.orgNumber} · Hemsida byggd med Driva
    </>
  );
  if (theme.header === "band") {
    return (
      <footer className="bg-(--site-band) px-6 py-8 text-center text-[12px] text-(--site-band-soft)">{line}</footer>
    );
  }
  return (
    <footer
      className={`px-6 text-center text-[12px] text-(--site-soft) ${
        theme.sections === "open" ? "py-12" : "border-t border-(--site-line) py-8"
      }`}
    >
      {line}
    </footer>
  );
}
