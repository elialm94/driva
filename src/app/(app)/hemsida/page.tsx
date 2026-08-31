import { ExternalLink, Globe, WandSparkles } from "lucide-react";
import { db } from "@/lib/store";
import { datumTid } from "@/lib/format";
import { DEFAULT_PRIMARY_CTA_LABEL } from "@/lib/types";
import { draftWebsiteDesign, publishedWebsiteDesign } from "@/lib/website-design";
import { draftWebsiteFooter } from "@/lib/website-footer";
import { Badge, Card, PageHeader } from "@/components/ui";
import { GenerateWebsiteForm, PublishWebsiteButton, SectionList } from "@/components/site-widgets";
import { PrivacyPolicySettingsCard } from "@/components/privacy-policy-settings";
import { WebsiteFormRecipientCard } from "@/components/website-form-recipient";
import { FooterSettingsCard } from "@/components/site-footer-settings";
import { draftPrivacyPolicyState, seedCustomPrivacyPolicy } from "@/lib/website-privacy";
import { hasUnpublishedWebsiteDrafts } from "@/lib/website-drafts";
import { SitePreviewFrame, UtseendePanel, WebsiteDesignProvider } from "@/components/site-design-widgets";
import { WebsiteEditorSyncProvider } from "@/components/website-editor-sync";
import { CopyLinkButton } from "@/components/copy-button";
import { DomainSidebarCard } from "@/components/domain-widgets";
import { SiteEditorShell } from "@/components/site-editor-shell";
import { StickyMobileActions } from "@/components/sticky-actions";
import { isMockDomainMode, primaryDomain } from "@/lib/domains";
import { isLiveMailConfigured } from "@/lib/mail";
import { ensurePageBusiness } from "@/lib/auth/session";
import { SECTION_LABELS, stripWebsiteSecrets } from "@/lib/website-sections";
import { resolveSiteContact } from "@/lib/website-contact";
import { resolveOptionalFeatures, shouldShowWebsiteRestoreNotice } from "@/lib/features";
import { redirect } from "next/navigation";

export const metadata = { title: "Hemsida" };

export default async function WebsitePage(props: PageProps<"/hemsida">) {
  await ensurePageBusiness();
  const data = db();
  if (!resolveOptionalFeatures(data).website) {
    redirect("/installningar?flik=funktioner");
  }
  const site = data.website;
  const searchParams = await props.searchParams;
  const restoredParam = searchParams.aterstalld;
  const restored =
    (typeof restoredParam === "string" ? restoredParam : restoredParam?.[0]) === "1" ||
    shouldShowWebsiteRestoreNotice(data);

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
  const unpublishedDrafts = hasUnpublishedWebsiteDrafts(site);
  const paused = Boolean(data.meta.websitePausedAt);
  const live = published && !paused;
  const dirty = !live || unpublishedDrafts;
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

  const publishedLabel = site.publishedAt ? `Publicerad ${datumTid(site.publishedAt)}` : "Publicerad";
  const subtitle = paused
    ? "Pausad – innehållet är kvar. Publicera när du är redo."
    : live
      ? unpublishedDrafts
        ? `${publishedLabel} · opublicerade ändringar`
        : publishedLabel
      : "Utkast – publicera när du är nöjd";

  return (
    <div className="animate-fade-up">
      {restored ? (
        <div
          role="status"
          className="mb-4 rounded-2xl border border-ok/20 bg-ok-soft px-4 py-3 text-[14px] leading-relaxed text-ok"
        >
          Din tidigare hemsida är återställd. Publicera när du är redo.
        </div>
      ) : null}
      <PageHeader
        title="Hemsida"
        subtitle={subtitle}
        actions={
          <div className="flex items-center gap-2">
            <a
              href={live ? "/sajt" : "/sajt?preview=1"}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line-strong bg-card px-3.5 text-[13px] font-medium text-soft transition-colors hover:text-ink"
            >
              <ExternalLink className="size-3.5" /> Öppna i ny flik
            </a>
            <div className={dirty ? "max-lg:hidden" : undefined}>
              <PublishWebsiteButton published={live} />
            </div>
          </div>
        }
      />

      <WebsiteDesignProvider initial={draftWebsiteDesign(site)}>
        <WebsiteEditorSyncProvider
          initialRevision={Math.max(site.draftRevision ?? 0, site.publishedRevision ?? 0)}
          initialDesign={draftWebsiteDesign(site)}
          initialFooter={draftWebsiteFooter(site)}
          initialPrivacy={draftPrivacyPolicyState(site)}
          initialSectionOrder={site.sections.map((section) => section.id)}
          initialSectionVisibility={site.sections.map((section) => ({
            id: section.id,
            visible: section.visible !== false,
          }))}
          initialPrimaryCtaLabel={site.primaryCta?.label ?? DEFAULT_PRIMARY_CTA_LABEL}
        >
        <SiteEditorShell
          preview={
            <div className="min-w-0">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                <div className="flex min-w-0 items-center gap-2 text-[13px] text-muted">
                  <Globe className="size-4 shrink-0" />
                  <span className="min-w-0 break-all font-mono text-[12px]">
                    {liveHost ? liveHost : live ? "driva.site/" + site.slug : "Förhandsvisning"}
                  </span>
                  <Badge
                    tone={
                      paused ? "warn" : live ? (unpublishedDrafts ? "warn" : "ok") : "neutral"
                    }
                  >
                    {paused
                      ? "Pausad"
                      : live
                        ? unpublishedDrafts
                          ? "Opublicerade ändringar"
                          : "Publicerad"
                        : "Utkast"}
                  </Badge>
                </div>
                <CopyLinkButton path="/sajt" label="Kopiera länk" />
              </div>
              <SitePreviewFrame website={safeSite} company={data.settings} />
            </div>
          }
          innehall={
            <div className="min-w-0 space-y-3">
              <Card className="min-w-0 overflow-hidden">
                <SectionList
                  sections={listSections}
                  labels={SECTION_LABELS}
                  primaryCtaLabel={site.primaryCta?.label ?? DEFAULT_PRIMARY_CTA_LABEL}
                  businessContact={businessContact}
                />
              </Card>
              <Card className="min-w-0 px-4 py-3.5" data-footer-innehall>
                <FooterSettingsCard website={site} company={data.settings} published={live} />
              </Card>
            </div>
          }
          design={
            <Card className="min-w-0">
              <UtseendePanel publishedDesign={publishedWebsiteDesign(site)} published={live} />
            </Card>
          }
          installningar={
            <div className="min-w-0 space-y-3">
              <Card className="min-w-0 px-4 py-3.5">
                <WebsiteFormRecipientCard
                  companyEmail={data.settings.email}
                  storedRecipient={data.settings.websiteNotificationEmail}
                  mailLive={mailLive}
                />
              </Card>
              <Card className="min-w-0 px-4 py-3.5">
                <PrivacyPolicySettingsCard
                  company={data.settings}
                  businessName={site.businessName}
                  draft={draftPrivacyPolicyState(site)}
                  standardSeed={seedCustomPrivacyPolicy({ company: data.settings, website: site })}
                />
              </Card>
              <DomainSidebarCard
                hostname={domain?.hostname}
                live={domain?.status === "active"}
                demo={isMockDomainMode()}
              />
            </div>
          }
        />
        {dirty ? (
          <StickyMobileActions
            summary={
              <p className="text-[13px] text-soft">
                {paused ? "Hemsidan är pausad" : live ? "Opublicerade ändringar" : "Hemsidan är ett utkast"}
              </p>
            }
          >
            <div className="w-full [&_button:first-of-type]:w-full">
              <PublishWebsiteButton published={live} />
            </div>
          </StickyMobileActions>
        ) : null}
        </WebsiteEditorSyncProvider>
      </WebsiteDesignProvider>
    </div>
  );
}
