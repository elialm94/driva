import { headers } from "next/headers";
import { db } from "./store";
import { draftWebsiteDesign, publishedWebsiteDesign, sameDesign } from "./website-design";
import { isMockDomainMode, resolvePublicSite } from "./domains";
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
  draftPrivacyPending: boolean;
  privacyHref: string;
  homeHref: string;
}

export async function loadPublicSite(
  searchParams: { host?: string | string[]; preview?: string | string[] }
): Promise<LoadedPublicSite | null> {
  const preview = searchParams.preview === "1";
  const host = await publicSiteHost(searchParams);
  if (!(await ensureSiteTenant(host))) return null;
  const mapped = host ? resolvePublicSite(host) : null;
  const data = db();
  const website = mapped?.website ?? data.website;
  const company = mapped?.company ?? data.settings;
  if (!website) return null;
  if (host && !mapped && !preview) return null;
  if (website.status !== "publicerad" && !preview) return null;

  const design = preview ? draftWebsiteDesign(website) : publishedWebsiteDesign(website);
  const draftDesignPending =
    preview && website.status === "publicerad" && !sameDesign(design, publishedWebsiteDesign(website));
  const draftPrivacyPending =
    preview &&
    website.status === "publicerad" &&
    !samePrivacyPolicyState(draftPrivacyPolicyState(website), publishedPrivacyPolicyState(website));

  return {
    website: stripWebsiteSecrets(websiteWithResolvedPrivacy(website, preview)),
    company,
    preview,
    design,
    draftDesignPending,
    draftPrivacyPending,
    privacyHref: privacyPolicyHref(preview),
    homeHref: preview ? "/sajt?preview=1" : "/sajt",
  };
}
