import { notFound } from "next/navigation";
import { SitePrivacyPolicy } from "@/components/site-privacy";
import { PublicSiteUnavailable } from "@/components/public-site-unavailable";
import { ensureSiteTenant, loadPublicSiteState, publicSiteHost } from "@/lib/public-site";
import { db } from "@/lib/store";
import { lookupBoundPublicSite, resolvePublicSite } from "@/lib/domains";
import { isWebsitePubliclyLive } from "@/lib/features";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/integritetspolicy">) {
  const searchParams = await props.searchParams;
  const host = await publicSiteHost(searchParams);
  if (!(await ensureSiteTenant(host))) return { title: "Integritetspolicy" };
  const mapped = host ? lookupBoundPublicSite(host) ?? resolvePublicSite(host) : null;
  const data = db();
  const preview = searchParams.preview === "1" || searchParams.preview?.[0] === "1";
  if (!isWebsitePubliclyLive(data) && !preview) {
    return { title: "Sidan är tillfälligt inte tillgänglig" };
  }
  const site = mapped?.website ?? data.website;
  const name = mapped?.company.name ?? data.settings.name ?? site?.businessName;
  return {
    title: name ? `Integritetspolicy – ${name}` : "Integritetspolicy",
    description: name
      ? `Så här behandlar ${name} personuppgifter som du lämnar via den här hemsidan.`
      : "Integritetspolicy",
  };
}

export default async function PrivacyPolicyPage(props: PageProps<"/integritetspolicy">) {
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
      <SitePrivacyPolicy
        website={site.website}
        company={site.company}
        design={site.design}
        homeHref={site.homeHref}
      />
    </div>
  );
}
