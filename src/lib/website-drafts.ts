import type { Website } from "./types";
import { draftWebsiteDesign, publishedWebsiteDesign, sameDesign } from "./website-design";
import { draftWebsiteFooter, publishedWebsiteFooter, sameFooter } from "./website-footer";
import {
  draftPrivacyPolicyState,
  publishedPrivacyPolicyState,
  samePrivacyPolicyState,
} from "./website-privacy";

/**
 * Finns det sparade utkast (utseende, sidfot, policy) som inte är publicerade?
 * En aldrig-publicerad sajt räknas inte hit – den är utkast i sin helhet.
 */
export function hasUnpublishedWebsiteDrafts(website: Website): boolean {
  if (website.status !== "publicerad") return false;
  return (
    !sameDesign(draftWebsiteDesign(website), publishedWebsiteDesign(website)) ||
    !sameFooter(draftWebsiteFooter(website), publishedWebsiteFooter(website)) ||
    !samePrivacyPolicyState(draftPrivacyPolicyState(website), publishedPrivacyPolicyState(website))
  );
}
