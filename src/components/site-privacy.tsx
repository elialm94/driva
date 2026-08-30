import type { CSSProperties } from "react";
import type { CompanySettings, Website, WebsiteDesign } from "@/lib/types";
import { publishedWebsiteDesign, resolveSiteDesign } from "@/lib/website-design";
import { buildPrivacyPolicy } from "@/lib/website-privacy";

export function SitePrivacyPolicy({
  website,
  company,
  design,
  homeHref,
}: {
  website: Website;
  company: CompanySettings;
  design?: WebsiteDesign;
  homeHref: string;
}) {
  const { theme, vars } = resolveSiteDesign(design ?? publishedWebsiteDesign(website));
  const policy = buildPrivacyPolicy({ company, website });
  const onBand = theme.header === "band";

  return (
    <div
      data-site-theme={theme.id}
      data-privacy-policy
      style={vars as CSSProperties}
      className="@container min-h-dvh bg-(--site-bg) font-sans text-(--site-ink)"
    >
      <header
        className={
          onBand
            ? "bg-(--site-band) text-(--site-band-ink)"
            : theme.header === "quiet"
              ? "border-b border-(--site-line)"
              : "border-b border-(--site-line)"
        }
      >
        <div className="mx-auto flex max-w-(--site-content-w) items-center justify-between gap-3 px-6 py-4">
          <a href={homeHref} className="min-w-0 truncate text-[15px] font-semibold hover:opacity-80">
            {website.businessName}
          </a>
          <a href={homeHref} className="shrink-0 text-[13px] underline decoration-from-font underline-offset-2">
            Till startsidan
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-12 @2xl:py-16">
        <p className={`mb-3 ${theme.eyebrowClass} text-(--site-soft)`}>{policy.controllerName}</p>
        <h1
          className={theme.h2Class}
          style={{
            fontFamily: "var(--site-heading-font)",
            fontWeight: "var(--site-heading-weight)" as CSSProperties["fontWeight"],
            letterSpacing: "var(--site-heading-tracking)",
          }}
        >
          {policy.title}
        </h1>
        <p className={`mt-3 text-[15px] leading-relaxed ${theme.bodyClass} text-(--site-soft)`}>{policy.intro}</p>

        {policy.sections.map((section) => (
          <section key={section.id} className="mt-10">
            <h2 className="text-[16px] font-semibold tracking-tight">{section.heading}</h2>
            {section.paragraphs.map((p) => (
              <p
                key={p.slice(0, 48)}
                className="mt-2 whitespace-pre-line text-[14.5px] leading-relaxed text-(--site-ink)"
              >
                {p}
              </p>
            ))}
          </section>
        ))}
      </main>

      <footer
        className={`px-6 py-8 text-center text-[12px] ${
          onBand ? "bg-(--site-band) text-(--site-band-soft)" : "border-t border-(--site-line) text-(--site-soft)"
        }`}
      >
        <a href={homeHref} className="underline decoration-from-font underline-offset-2 hover:opacity-80">
          Tillbaka till {website.businessName}
        </a>
      </footer>
    </div>
  );
}
