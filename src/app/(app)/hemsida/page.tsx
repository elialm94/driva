import { ExternalLink, Globe, WandSparkles } from "lucide-react";
import { db } from "@/lib/store";
import { datumTid } from "@/lib/format";
import { DEFAULT_PRIMARY_CTA_LABEL } from "@/lib/types";
import { draftWebsiteDesign, publishedWebsiteDesign } from "@/lib/website-design";
import { Badge, Card, PageHeader, SectionTitle } from "@/components/ui";
import { GenerateWebsiteForm, PublishWebsiteButton, SectionList } from "@/components/site-widgets";
import { PrivacyPolicySettingsCard } from "@/components/privacy-policy-settings";
import { WebsiteFormRecipientCard } from "@/components/website-form-recipient";
import { FooterSettingsCard } from "@/components/site-footer-settings";
import { SitePreviewFrame, UtseendePanel, WebsiteDesignProvider } from "@/components/site-design-widgets";
import { CopyLinkButton } from "@/components/copy-button";
import { DomainSidebarCard } from "@/components/domain-widgets";
import { isMockDomainMode, primaryDomain } from "@/lib/domains";
import { isLiveMailConfigured } from "@/lib/mail";
import { ensurePageBusiness } from "@/lib/auth/session";
import { SECTION_LABELS, stripWebsiteSecrets } from "@/lib/website-sections";
import { resolveSiteContact } from "@/lib/website-contact";

export const metadata = { title: "Hemsida" };

export default async function WebsitePage() {
  await ensurePageBusiness();
  const data = db();
  const site = data.website;

  if (!site) {
    return (
      <div className="animate-fade-up">
        <PageHeader title="Hemsida" subtitle="Beskriv ditt företag så bygger AI:n en färdig hemsida på några sekunder." />
        <Card className="px-6 py-8 sm:px-10 sm:py-12">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-3xl bg-accent-soft">
              <WandSparkles className="size-6.5 text-accent" />
            </div>
            <h2 className="mt-5 text-[22px] font-semibold tracking-tight">Vad gör ditt företag?</h2>
            <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-soft">
              AI:n skapar startsida, tjänster, om oss, galleri och ett kontaktformulär som skapar uppdrag rakt
              in i Driva. Du kan ändra allt efteråt.
            </p>
          </div>
          <div className="mx-auto mt-8 max-w-2xl">
            <GenerateWebsiteForm />
          </div>
        </Card>
      </div>
    );
  }

  const published = site.status === "publicerad";
  const domain = primaryDomain();
  const liveHost = domain?.status === "active" ? domain.hostname : null;
  const mailLive = isLiveMailConfigured();

  // Redigeringslistan behöver inte bilddatan (tunga data-URL:er) – bara vetskap om att bild finns.
  // Själva bilderna hämtas när en sektion öppnas för redigering.
  const safeSite = stripWebsiteSecrets(site);
  const listSections = safeSite.sections.map(({ image, items, ...rest }) => ({
    ...rest,
    hasImage: Boolean(image),
    items: items?.map(({ image: itemImage, ...itemRest }) => ({ ...itemRest, hasImage: Boolean(itemImage) })),
  }));
  const businessContact = resolveSiteContact(data.settings, site);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Hemsida"
        subtitle={
          published
            ? `Publicerad ${site.publishedAt ? datumTid(site.publishedAt) : ""} · formuläret skapar uppdrag automatiskt`
            : "Utkast – granska och publicera när du är nöjd"
        }
        actions={
          <div className="flex items-center gap-2">
            <a
              href={published ? "/sajt" : "/sajt?preview=1"}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line-strong bg-card px-3.5 text-[13px] font-medium text-soft transition-colors hover:text-ink"
            >
              <ExternalLink className="size-3.5" /> Öppna i ny flik
            </a>
            <PublishWebsiteButton published={published} />
          </div>
        }
      />

      <WebsiteDesignProvider initial={draftWebsiteDesign(site)}>
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Live-preview */}
        <div className="min-w-0">
          {/* flex-wrap: på smala skärmar lägger sig Kopiera länk under adressen i stället för att spränga bredden. */}
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <div className="flex min-w-0 items-center gap-2 text-[13px] text-muted">
              <Globe className="size-4 shrink-0" />
              <span className="min-w-0 break-all font-mono text-[12px]">
                {liveHost ? liveHost : published ? "driva.site/" + site.slug : "Förhandsvisning"}
              </span>
              {/* Utkast är grått som överallt annars – gult betyder "väntar/uppmärksamhet". */}
              <Badge tone={published ? "ok" : "neutral"}>{published ? "Publicerad" : "Utkast"}</Badge>
            </div>
            <CopyLinkButton path="/sajt" label="Kopiera länk" />
          </div>
          <SitePreviewFrame website={safeSite} company={data.settings} />
          <p className="mt-2 text-[12px] text-muted">
            Det här är exakt vad besökarna ser. Formuläret är aktivt på den publicerade sajten.
          </p>
        </div>

        {/* Sidopanel */}
        <div className="min-w-0 space-y-6">
          <div className="min-w-0">
            <SectionTitle>Utseende</SectionTitle>
            <Card className="min-w-0">
              <UtseendePanel publishedDesign={publishedWebsiteDesign(site)} published={published} />
            </Card>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Välj känslan som passar ditt företag – innehållet är detsamma i alla teman.
            </p>
          </div>

          <div className="min-w-0">
            <SectionTitle>Innehåll</SectionTitle>
            <Card className="min-w-0 overflow-hidden">
              <SectionList
                sections={listSections}
                labels={SECTION_LABELS}
                primaryCtaLabel={site.primaryCta?.label ?? DEFAULT_PRIMARY_CTA_LABEL}
                businessContact={businessContact}
              />
            </Card>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Dra för att ändra ordning. Klicka för att redigera. Dolda sektioner syns inte på sajten, men innehållet
              sparas.
            </p>
          </div>

          <div>
            <SectionTitle>Webbformulär</SectionTitle>
            <Card className="px-5 py-4">
              <WebsiteFormRecipientCard
                companyEmail={data.settings.email}
                storedRecipient={data.settings.websiteNotificationEmail}
                mailLive={mailLive}
              />
            </Card>
          </div>

          <div>
            <SectionTitle>Sidfot</SectionTitle>
            <Card className="min-w-0 px-5 py-4">
              <FooterSettingsCard website={site} company={data.settings} published={published} />
            </Card>
            <Card className="mt-3 min-w-0 px-5 py-4">
              <PrivacyPolicySettingsCard
                company={data.settings}
                businessName={site.businessName}
                supplement={site.privacyPolicySupplement}
              />
            </Card>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Sidfoten fylls i från företagsuppgifter och Tjänster. Integritetspolicy ligger alltid
              längst ner.
            </p>
          </div>

          <div>
            <SectionTitle>Domän</SectionTitle>
            <DomainSidebarCard
              hostname={domain?.hostname}
              live={domain?.status === "active"}
              demo={isMockDomainMode()}
            />
          </div>
        </div>
      </div>
      </WebsiteDesignProvider>
    </div>
  );
}
