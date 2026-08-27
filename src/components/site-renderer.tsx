import type { CompanySettings, Website, WebsiteTheme } from "@/lib/types";
import { SiteContactForm } from "./site-widgets";

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
  const hero = website.sections.find((s) => s.type === "hero");
  const services = website.sections.find((s) => s.type === "tjanster");
  const about = website.sections.find((s) => s.type === "om");
  const gallery = website.sections.find((s) => s.type === "galleri");
  const contact = website.sections.find((s) => s.type === "kontakt");

  return (
    <div style={{ background: t.bg, color: t.ink }} className="min-h-full font-sans">
      {/* Sitehuvud */}
      <header className="sticky top-0 z-10 backdrop-blur" style={{ background: `${t.bg}e6`, borderBottom: `1px solid ${t.line}` }}>
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <span className="text-[15px] font-bold tracking-tight">{website.businessName}</span>
          <a
            href="#kontakt"
            className="rounded-full px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
            style={{ background: t.accent, color: t.accentInk }}
          >
            Begär offert
          </a>
        </div>
      </header>

      {/* Hero */}
      {hero ? (
        <section className="mx-auto max-w-4xl px-6 pb-16 pt-16 text-center sm:pt-24">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em]" style={{ color: t.accent }}>
            {website.city ?? company.city}
          </p>
          <h1 className="mx-auto mt-3 max-w-2xl text-[34px] font-bold leading-[1.12] tracking-tight sm:text-[44px]">
            {hero.heading}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed" style={{ color: t.soft }}>
            {hero.body}
          </p>
          <div className="mt-7 flex items-center justify-center gap-3">
            <a
              href="#kontakt"
              className="rounded-full px-6 py-3 text-[14px] font-semibold shadow-sm transition-opacity hover:opacity-90"
              style={{ background: t.accent, color: t.accentInk }}
            >
              Begär offert
            </a>
            <a
              href="#tjanster"
              className="rounded-full px-6 py-3 text-[14px] font-semibold"
              style={{ border: `1px solid ${t.line}`, background: t.card, color: t.ink }}
            >
              Våra tjänster
            </a>
          </div>
        </section>
      ) : null}

      {/* Tjänster */}
      {services ? (
        <section id="tjanster" className="mx-auto max-w-4xl px-6 py-14" style={{ borderTop: `1px solid ${t.line}` }}>
          <h2 className="text-[24px] font-bold tracking-tight">{services.heading}</h2>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed" style={{ color: t.soft }}>
            {services.body}
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {(services.items ?? []).map((item) => (
              <div key={item.title} className="rounded-2xl p-5" style={{ background: t.card, border: `1px solid ${t.line}` }}>
                <div className="size-2.5 rounded-full" style={{ background: t.accent }} />
                <h3 className="mt-3 text-[16px] font-semibold">{item.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed" style={{ color: t.soft }}>
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Om oss */}
      {about ? (
        <section className="mx-auto max-w-4xl px-6 py-14" style={{ borderTop: `1px solid ${t.line}` }}>
          <div className="grid items-center gap-8 sm:grid-cols-[1.2fr_1fr]">
            <div>
              <h2 className="text-[24px] font-bold tracking-tight">{about.heading}</h2>
              <p className="mt-3 text-[15px] leading-relaxed" style={{ color: t.soft }}>
                {about.body}
              </p>
            </div>
            <div
              className="flex aspect-[4/3] items-center justify-center rounded-3xl text-[13px] font-medium"
              style={{ background: `color-mix(in srgb, ${t.accent} 14%, ${t.card})`, color: t.soft, border: `1px solid ${t.line}` }}
            >
              Bild: {website.businessName}
            </div>
          </div>
        </section>
      ) : null}

      {/* Galleri */}
      {gallery ? (
        <section className="mx-auto max-w-4xl px-6 py-14" style={{ borderTop: `1px solid ${t.line}` }}>
          <h2 className="text-[24px] font-bold tracking-tight">{gallery.heading}</h2>
          <p className="mt-2 text-[15px]" style={{ color: t.soft }}>
            {gallery.body}
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
      ) : null}

      {/* Kontakt */}
      {contact ? (
        <section id="kontakt" className="px-6 py-16" style={{ borderTop: `1px solid ${t.line}`, background: t.card }}>
          <div className="mx-auto max-w-xl text-center">
            <h2 className="text-[24px] font-bold tracking-tight">{contact.heading}</h2>
            <p className="mt-2 text-[15px] leading-relaxed" style={{ color: t.soft }}>
              {contact.body}
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
      ) : null}

      <footer className="px-6 py-8 text-center text-[12px]" style={{ color: t.soft, borderTop: `1px solid ${t.line}` }}>
        © {new Date().getFullYear()} {website.businessName} · Org.nr {company.orgNumber} · Hemsida byggd med Driva
      </footer>
    </div>
  );
}
