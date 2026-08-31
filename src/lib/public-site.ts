import { headers } from "next/headers";
import { db } from "./store";
import { draftWebsiteDesign, publishedWebsiteDesign, sameDesign } from "./website-design";
import { draftWebsiteFooter, publishedWebsiteFooter, sameFooter } from "./website-footer";
import { isMockDomainMode, lookupBoundPublicSite, resolvePublicSite } from "./domains";
import { ensurePageBusiness, ensurePublicPage } from "./auth/session";
import { isSupabaseMode } from "./storage/config";
import type { CompanySettings, Website, WebsiteDesign } from "./types";
import {
  draftPrivacyPolicyState,
  privacyPolicyHref,
  publishedPrivacyPolicyState,
  samePrivacyPolicyState,
  websiteWithResolvedPrivacy,
} from "./website-privacy";
import { stripWebsiteSecrets } from "./website-sections";
import {
  draftPrimaryCtaLabel,
  draftWebsiteSections,
  publishedPrimaryCtaLabel,
  publishedWebsiteSections,
  sameSections,
  websiteDraftView,
} from "./website-drafts";
import { isWebsitePubliclyLive, resolveOptionalFeatures } from "./features";

/**
 * Tenantupplösning för den publika sajten: i Supabase-läge löses företaget
 * från värdnamnet (kundens domän). Utan träff (t.ex. appens egen värd vid
 * förhandsvisning) krävs inloggad session. Returnerar false = 404.
 */
export async function ensureSiteTenant(host: string | null): Promise<boolean> {
  if (!isSupabaseMode()) return true;
  if (host && (await ensurePublicPage("hostname", host))) return true;
  await ensurePageBusiness();
  return true;
}

export async function publicSiteHost(searchParams: { host?: string | string[] }): Promise<string | null> {
  const h = await headers();
  const fromProxy = h.get("x-driva-public-host");
  if (fromProxy) return fromProxy;
  const fromHeader = h.get("x-forwarded-host") ?? h.get("host");
  const mapped = resolvePublicSite(fromHeader);
  if (mapped) return fromHeader;
  if (isMockDomainMode()) {
    const q = searchParams.host;
    return typeof q === "string" ? q : null;
  }
  return null;
}

export interface LoadedPublicSite {
  website: Website;
  company: CompanySettings;
  preview: boolean;
  design: WebsiteDesign;
  draftDesignPending: boolean;
  draftFooterPending: boolean;
  draftPrivacyPending: boolean;
  /** Opublicerade sektions-/innehållsändringar (bara i preview). */
  draftContentPending: boolean;
  privacyHref: string;
  homeHref: string;
}

export type PublicSiteLoad =
  | { status: "ok"; site: LoadedPublicSite }
  | { status: "unavailable" }
  | { status: "missing" };

export async function loadPublicSiteState(
  searchParams: { host?: string | string[]; preview?: string | string[] }
): Promise<PublicSiteLoad> {
  const preview = searchParams.preview === "1";
  const host = await publicSiteHost(searchParams);
  if (!(await ensureSiteTenant(host))) return { status: "missing" };
  const mapped = host ? lookupBoundPublicSite(host) : null;
  const data = db();
  const website = mapped?.website ?? data.website;
  const company = mapped?.company ?? data.settings;
  if (!website) return { status: "missing" };
  if (host && !mapped && !preview) return { status: "missing" };

  const featureOn = resolveOptionalFeatures(data).website;
  const publiclyLive = isWebsitePubliclyLive(data);

  if (preview) {
    if (!featureOn) return { status: "unavailable" };
  } else if (!publiclyLive) {
    if (website.status === "publicerad" || data.meta.websitePausedAt || !featureOn) {
      return { status: "unavailable" };
    }
    return { status: "missing" };
  }

  const design = preview ? draftWebsiteDesign(website) : publishedWebsiteDesign(website);
  const draftDesignPending =
    preview && website.status === "publicerad" && !sameDesign(design, publishedWebsiteDesign(website));
  const footer = preview ? draftWebsiteFooter(website) : publishedWebsiteFooter(website);
  const draftFooterPending =
    preview && website.status === "publicerad" && !sameFooter(footer, publishedWebsiteFooter(website));
  const draftPrivacyPending =
    preview &&
    website.status === "publicerad" &&
    !samePrivacyPolicyState(draftPrivacyPolicyState(website), publishedPrivacyPolicyState(website));
  const draftContentPending =
    preview &&
    website.status === "publicerad" &&
    (!sameSections(draftWebsiteSections(website), publishedWebsiteSections(website)) ||
      draftPrimaryCtaLabel(website) !== publishedPrimaryCtaLabel(website));

  // Förhandsvisningen visar utkastet (sektioner + CTA); publika sajten det publicerade.
  const resolvedWebsite = preview ? websiteDraftView(website) : website;

  return {
    status: "ok",
    site: {
      website: stripWebsiteSecrets(websiteWithResolvedPrivacy(resolvedWebsite, preview)),
      company,
      preview,
      design,
      draftDesignPending,
      draftFooterPending,
      draftPrivacyPending,
      draftContentPending,
      privacyHref: privacyPolicyHref(preview),
      homeHref: preview ? "/sajt?preview=1" : "/sajt",
    },
  };
}

export async function loadPublicSite(
  searchParams: { host?: string | string[]; preview?: string | string[] }
): Promise<LoadedPublicSite | null> {
  const loaded = await loadPublicSiteState(searchParams);
  return loaded.status === "ok" ? loaded.site : null;
}
