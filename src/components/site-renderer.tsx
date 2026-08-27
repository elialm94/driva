import type { CompanySettings, Website, WebsiteSection, WebsiteSectionItem, WebsiteTheme } from "@/lib/types";
import { SiteContactForm } from "./site-widgets";
import { SmoothSectionLink } from "./smooth-section-link";
import { CompanyLogo } from "./company-logo";

/**
 * Ren renderare för den publika hemsidan. Används både i det publika läget (/sajt)
 * och i förhandsvisningen inne i hemsidesbyggaren.
 */

const THEMES: Record<
  WebsiteTheme,
  { bg: string; ink: string; soft: string; accent: string; accentInk: string; card: string; line: string }
> = {
  tra: { bg: "#faf7f2", ink: "#2b2118", soft: "#6f6152", accent: "#8a5a2b", accentInk: "#ffffff", card: "#ffffff", line: "#eae3d7" },
  studio: { bg: "#101012", ink: "#f4f2ee", soft: "#a7a29a", accent: "#e8b64c", accentInk: "#191919", card: "#1a1a1d", line: "#2a2a2e" },
  ren: { bg: "#f4f9fb", ink: "#12303a", soft: "#537680", accent: "#0e7490", accentInk: "#ffffff", card: "#ffffff", line: "#dcebf0" },
  el: { bg: "#fffdf5", ink: "#1f1d15", soft: "#6b675a", accent: "#b7791f", accentInk: "#ffffff", card: "#ffffff", line: "#efe9d8" },
  konsult: { bg: "#f7f8fa", ink: "#171c26", soft: "#5a6272", accent: "#1e3a5f", accentInk: "#ffffff", card: "#ffffff", line: "#e5e8ee" },
};

const GALLERY_TONES = ["0.16", "0.28", "0.22", "0.34", "0.12", "0.26"];
const SECTION_SCROLL = "scroll-mt-[4.5rem]";

function isVisible(section: WebsiteSection): boolean {
  return section.visible !== false;
}

export function SiteRenderer({
  website,
  company,
  interactive = true,
}: {
  website: Website;
  company: CompanySettings;
  interactive?: boolean;
}) {
  const t = THEMES[website.theme] ?? THEMES.tra;
  const sections = website.sections.filter(isVisible);
  const contactOn = sections.some((s) => s.type === "kontakt");
  const servicesOn = sections.some((s) => s.type === "tjanster");

  return (
    <div style={{ background: t.bg, color: t.ink }} className="min-h-full font-sans">
      {/* Sitehuvud */}
      <header className="sticky top-0 z-10 backdrop-blur" style={{ background: `${t.bg}e6`, borderBottom: `1px solid ${t.line}` }}>
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <span className="flex items-center gap-2.5 text-[15px] font-bold tracking-tight">
            {company.logoDataUrl ? <CompanyLogo company={company} size="sm" /> : null}
            {website.businessName}
          </span>
          {contactOn ? (
            <SmoothSectionLink
              href="#kontakt"
              className="rounded-full px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
              style={{ background: t.accent, color: t.accentInk }}
            >
              Begär offert
            </SmoothSectionLink>
          ) : null}
        </div>
      </header>

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
                theme={t}
                lined={lined}
                contactOn={contactOn}
                servicesOn={servicesOn}
              />
            );
          case "tjanster":
            return <ServicesSection key={section.id} section={section} theme={t} lined={lined} />;
          case "om":
            return <AboutSection key={section.id} section={section} theme={t} lined={lined} />;
          case "galleri":
            return <GallerySection key={section.id} section={section} theme={t} lined={lined} />;
          case "kontakt":
            return (
              <ContactSection
                key={section.id}
                website={website}
                company={company}
                section={section}
                theme={t}
                lined={lined}
                interactive={interactive}
              />
            );
          default:
            return null;
        }
      })}

      <footer className="px-6 py-8 text-center text-[12px]" style={{ color: t.soft, borderTop: `1px solid ${t.line}` }}>
        © {new Date().getFullYear()} {website.businessName} · Org.nr {company.orgNumber} · Hemsida byggd med Driva
      </footer>
    </div>
  );
}

type Theme = (typeof THEMES)[WebsiteTheme];

function HeroSection({
  website,
  company,
  section,
  theme: t,
  lined,
  contactOn,
  servicesOn,
}: {
  website: Website;
  company: CompanySettings;
  section: WebsiteSection;
  theme: Theme;
  lined: boolean;
  contactOn: boolean;
  servicesOn: boolean;
}) {
  const city = website.city ?? company.city;
  const ctas =
    contactOn || servicesOn ? (
      <>
        {contactOn ? (
          <SmoothSectionLink
            href="#kontakt"
            className="rounded-full px-6 py-3 text-[14px] font-semibold shadow-sm transition-opacity hover:opacity-90"
            style={{ background: t.accent, color: t.accentInk }}
          >
            Begär offert
          </SmoothSectionLink>
        ) : null}
        {servicesOn ? (
          <SmoothSectionLink
            href="#tjanster"
            className="rounded-full px-6 py-3 text-[14px] font-semibold"
            style={{ border: `1px solid ${t.line}`, background: t.card, color: t.ink }}
          >
            Våra tjänster
          </SmoothSectionLink>
        ) : null}
      </>
    ) : null;

  if (!section.image) {
    return (
      <section
        id="start"
        className={`mx-auto max-w-4xl px-6 pb-16 pt-16 text-center sm:pt-24 ${SECTION_SCROLL}`}
        style={lined ? { borderTop: `1px solid ${t.line}` } : undefined}
      >
        <p className="text-[12px] font-semibold uppercase tracking-[0.18em]" style={{ color: t.accent }}>
          {city}
        </p>
        <h1 className="mx-auto mt-3 max-w-2xl text-[34px] font-bold leading-[1.12] tracking-tight sm:text-[44px]">
          {section.heading}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed" style={{ color: t.soft }}>
          {section.body}
        </p>
        {ctas ? <div className="mt-7 flex items-center justify-center gap-3">{ctas}</div> : null}
      </section>
    );
  }

  return (
    <section
      id="start"
      className={`mx-auto max-w-4xl px-6 pb-16 pt-12 sm:pt-16 ${SECTION_SCROLL}`}
      style={lined ? { borderTop: `1px solid ${t.line}` } : undefined}
    >
      <div className="grid items-center gap-8 md:grid-cols-2 md:gap-10">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em]" style={{ color: t.accent }}>
            {city}
          </p>
          <h1 className="mt-3 text-[34px] font-bold leading-[1.12] tracking-tight sm:text-[40px]">
            {section.heading}
          </h1>
          <p className="mt-4 max-w-xl text-[16px] leading-relaxed" style={{ color: t.soft }}>
            {section.body}
          </p>
          {ctas ? <div className="mt-7 flex flex-wrap items-center gap-3">{ctas}</div> : null}
        </div>
        <div
          className="aspect-[4/3] max-h-[26rem] overflow-hidden rounded-3xl"
          style={{ border: `1px solid ${t.line}` }}
        >
          {/* Data-URL:er (inga filer i en mediabank) – next/image passar inte här. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={section.image} alt="" className="size-full object-cover" />
        </div>
      </div>
    </section>
  );
}

function ServicesSection({
  section,
  theme: t,
  lined,
}: {
  section: WebsiteSection;
  theme: Theme;
  lined: boolean;
}) {
  return (
    <section id="tjanster" className={`mx-auto max-w-4xl px-6 py-14 ${SECTION_SCROLL}`} style={lined ? { borderTop: `1px solid ${t.line}` } : undefined}>
      <h2 className="text-[24px] font-bold tracking-tight">{section.heading}</h2>
      {section.body ? (
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed" style={{ color: t.soft }}>
          {section.body}
        </p>
      ) : null}
      <ServicesGrid items={section.items ?? []} card={t.card} line={t.line} soft={t.soft} accent={t.accent} />
    </section>
  );
}

function AboutSection({
  section,
  theme: t,
  lined,
}: {
  section: WebsiteSection;
  theme: Theme;
  lined: boolean;
}) {
  const copy = (
    <>
      <h2 className="text-[24px] font-bold tracking-tight">{section.heading}</h2>
      <p className="mt-3 text-[15px] leading-relaxed" style={{ color: t.soft }}>
        {section.body}
      </p>
    </>
  );

  return (
    <section id="om" className={`mx-auto max-w-4xl px-6 py-14 ${SECTION_SCROLL}`} style={lined ? { borderTop: `1px solid ${t.line}` } : undefined}>
      {section.image ? (
        <div className="grid items-center gap-8 sm:grid-cols-2">
          <div>{copy}</div>
          {/* Data-URL:er (inga filer i en mediabank) – next/image passar inte här. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={section.image} alt="" loading="lazy" decoding="async" className="aspect-[4/3] w-full rounded-3xl object-cover" />
        </div>
      ) : (
        <div className="mx-auto max-w-2xl text-center">{copy}</div>
      )}
    </section>
  );
}

function GallerySection({
  section,
  theme: t,
  lined,
}: {
  section: WebsiteSection;
  theme: Theme;
  lined: boolean;
}) {
  return (
    <section id="galleri" className={`mx-auto max-w-4xl px-6 py-14 ${SECTION_SCROLL}`} style={lined ? { borderTop: `1px solid ${t.line}` } : undefined}>
      <h2 className="text-[24px] font-bold tracking-tight">{section.heading}</h2>
      <p className="mt-2 text-[15px]" style={{ color: t.soft }}>
        {section.body}
      </p>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {GALLERY_TONES.map((opacity, i) => (
          <div
            key={i}
            className="flex aspect-square items-end rounded-2xl p-3"
            style={{ background: `color-mix(in srgb, ${t.accent} ${Number(opacity) * 100}%, ${t.card})`, border: `1px solid ${t.line}` }}
          >
            <span className="text-[11px] font-medium" style={{ color: t.soft }}>
              Projekt {i + 1}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ContactSection({
  website,
  company,
  section,
  theme: t,
  lined,
  interactive,
}: {
  website: Website;
  company: CompanySettings;
  section: WebsiteSection;
  theme: Theme;
  lined: boolean;
  interactive: boolean;
}) {
  return (
    <section
      id="kontakt"
      className={`px-6 py-16 ${SECTION_SCROLL}`}
      style={{
        borderTop: lined ? `1px solid ${t.line}` : undefined,
        background: t.card,
      }}
    >
      <div className="mx-auto max-w-xl text-center">
        <h2 className="text-[24px] font-bold tracking-tight">{section.heading}</h2>
        <p className="mt-2 text-[15px] leading-relaxed" style={{ color: t.soft }}>
          {section.body}
        </p>
        <div className="mt-7 text-left">
          <SiteContactForm
            interactive={interactive}
            accent={t.accent}
            accentInk={t.accentInk}
            line={t.line}
            bg={t.bg}
            ink={t.ink}
          />
        </div>
        <p className="mt-6 text-[13px]" style={{ color: t.soft }}>
          {company.phone} · {company.email} · {website.city ?? company.city}
        </p>
      </div>
    </section>
  );
}

function ServicesGrid({
  items,
  card,
  line,
  soft,
  accent,
}: {
  items: WebsiteSectionItem[];
  card: string;
  line: string;
  soft: string;
  accent: string;
}) {
  if (items.length === 0) {
    return (
      <p
        className="mt-8 rounded-2xl px-5 py-8 text-center text-[14px]"
        style={{ color: soft, background: card, border: `1px solid ${line}` }}
      >
        Inga tjänster att visa ännu.
      </p>
    );
  }

  const cols =
    items.length === 1
      ? "grid-cols-1 sm:max-w-xl"
      : items.length === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";

  return (
    <div className={`mt-8 grid gap-4 ${cols}`}>
      {items.map((item, i) => (
        <div
          key={`${item.title}-${i}`}
          className="overflow-hidden rounded-2xl"
          style={{ background: card, border: `1px solid ${line}` }}
        >
          {item.image ? (
            // Data-URL:er (inga filer i en mediabank) – next/image passar inte här.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.image} alt="" loading="lazy" decoding="async" className="aspect-[16/10] w-full object-cover" />
          ) : null}
          <div className="p-5">
            {item.image ? null : <div className="size-2.5 rounded-full" style={{ background: accent }} />}
            <h3 className={item.image ? "text-[16px] font-semibold" : "mt-3 text-[16px] font-semibold"}>{item.title}</h3>
            <p className="mt-1.5 text-[13.5px] leading-relaxed" style={{ color: soft }}>
              {item.text}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
