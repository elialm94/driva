import { notFound } from "next/navigation";
import { SiteRenderer } from "@/components/site-renderer";
import { PublicSiteUnavailable } from "@/components/public-site-unavailable";
import { ensureSiteTenant, loadPublicSiteState, publicSiteHost } from "@/lib/public-site";
import { db } from "@/lib/store";
import { lookupBoundPublicSite, resolvePublicSite } from "@/lib/domains";
import { stripWebsiteSecrets } from "@/lib/website-sections";
import { isWebsitePubliclyLive } from "@/lib/features";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/sajt">) {
  const searchParams = await props.searchParams;
  const host = await publicSiteHost(searchParams);
  if (!(await ensureSiteTenant(host))) return { title: "Hemsida" };
  const mapped = host ? lookupBoundPublicSite(host) ?? resolvePublicSite(host) : null;
  const data = db();
  const preview = searchParams.preview === "1" || searchParams.preview?.[0] === "1";
  if (!isWebsitePubliclyLive(data) && !preview) {
    return {
      title: "Sidan är tillfälligt inte tillgänglig",
      robots: { index: false, follow: false },
    };
  }
  const site = mapped?.website ?? data.website;
  return {
    title: site ? `${site.businessName} – ${site.tagline}` : "Hemsida",
    description: site?.sections.find((s) => s.type === "hero")?.body,
  };
}

export default async function PublicSitePage(props: PageProps<"/sajt">) {
  const searchParams = await props.searchParams;
  const loaded = await loadPublicSiteState(searchParams);
  if (loaded.status === "unavailable") return <PublicSiteUnavailable />;
  if (loaded.status === "missing") notFound();
  const site = loaded.site;

  return (
    <div className="min-h-dvh" data-public-site>
      {site.website.status !== "publicerad" && site.preview ? (
        <div className="sticky top-0 z-50 bg-warn px-4 py-2 text-center text-[13px] font-medium text-white">
          Förhandsvisning – sajten är inte publicerad ännu
        </div>
      ) : site.draftDesignPending || site.draftFooterPending || site.draftPrivacyPending ? (
        <div className="sticky top-0 z-50 bg-warn px-4 py-2 text-center text-[13px] font-medium text-white">
          Förhandsvisning av opublicerade ändringar – publicera för att uppdatera sajten
        </div>
      ) : null}
      <SiteRenderer
        website={stripWebsiteSecrets(site.website)}
        company={site.company}
        design={site.design}
        preview={site.preview}
        privacyHref={site.privacyHref}
      />
    </div>
  );
}
