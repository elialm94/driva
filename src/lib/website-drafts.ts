import { DEFAULT_PRIMARY_CTA_LABEL, type Website, type WebsiteSection } from "./types";
import { draftWebsiteDesign, publishedWebsiteDesign, sameDesign } from "./website-design";
import { draftWebsiteFooter, publishedWebsiteFooter, sameFooter } from "./website-footer";
import {
  draftPrivacyPolicyState,
  publishedPrivacyPolicyState,
  samePrivacyPolicyState,
} from "./website-privacy";

export function publishedWebsiteSections(website: Pick<Website, "sections">): WebsiteSection[] {
  return website.sections;
}

export function draftWebsiteSections(
  website: Pick<Website, "sections" | "draftSections">,
): WebsiteSection[] {
  return website.draftSections ?? website.sections;
}

export function sameSections(a: WebsiteSection[], b: WebsiteSection[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function publishedPrimaryCtaLabel(website: Pick<Website, "primaryCta">): string {
  return website.primaryCta?.label ?? DEFAULT_PRIMARY_CTA_LABEL;
}

export function draftPrimaryCtaLabel(
  website: Pick<Website, "primaryCta" | "draftPrimaryCta">,
): string {
  return website.draftPrimaryCta?.label ?? publishedPrimaryCtaLabel(website);
}

/** Byggarens och ?preview=1-vyn: utkast där det finns, annars publicerat. */
export function websiteDraftView(website: Website): Website {
  return {
    ...website,
    sections: draftWebsiteSections(website),
    primaryCta: { label: draftPrimaryCtaLabel(website) },
  };
}

/**
 * Finns det sparade utkast som inte är publicerade?
 * En aldrig-publicerad sajt räknas inte hit – den är utkast i sin helhet.
 */
export function hasUnpublishedWebsiteDrafts(website: Website): boolean {
  if (website.status !== "publicerad") return false;
  return (
    !sameDesign(draftWebsiteDesign(website), publishedWebsiteDesign(website)) ||
    !sameFooter(draftWebsiteFooter(website), publishedWebsiteFooter(website)) ||
    !samePrivacyPolicyState(draftPrivacyPolicyState(website), publishedPrivacyPolicyState(website)) ||
    !sameSections(draftWebsiteSections(website), publishedWebsiteSections(website)) ||
    draftPrimaryCtaLabel(website) !== publishedPrimaryCtaLabel(website)
  );
}
