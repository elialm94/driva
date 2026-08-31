import { notFound } from "next/navigation";
import { SiteRenderer } from "@/components/site-renderer";
import { ensureSiteTenant, loadPublicSite, publicSiteHost } from "@/lib/public-site";
import { db } from "@/lib/store";
import { resolvePublicSite } from "@/lib/domains";
import { stripWebsiteSecrets } from "@/lib/website-sections";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/sajt">) {
  const searchParams = await props.searchParams;
  const host = await publicSiteHost(searchParams);
  if (!(await ensureSiteTenant(host))) return { title: "Hemsida" };
  const mapped = host ? resolvePublicSite(host) : null;
  const site = mapped?.website ?? db().website;
  return {
    title: site ? `${site.businessName} – ${site.tagline}` : "Hemsida",
    description: site?.sections.find((s) => s.type === "hero")?.body,
  };
}

export default async function PublicSitePage(props: PageProps<"/sajt">) {
  const searchParams = await props.searchParams;
  const loaded = await loadPublicSite(searchParams);
  if (!loaded) notFound();

  return (
    <div className="min-h-dvh" data-public-site>
      {loaded.website.status !== "publicerad" && loaded.preview ? (
        <div className="sticky top-0 z-50 bg-warn px-4 py-2 text-center text-[13px] font-medium text-white">
          Förhandsvisning – sajten är inte publicerad ännu
        </div>
      ) : loaded.draftDesignPending || loaded.draftFooterPending || loaded.draftPrivacyPending ? (
        <div className="sticky top-0 z-50 bg-warn px-4 py-2 text-center text-[13px] font-medium text-white">
          Förhandsvisning av opublicerade ändringar – publicera för att uppdatera sajten
        </div>
      ) : null}
      <SiteRenderer
        website={stripWebsiteSecrets(loaded.website)}
        company={loaded.company}
        design={loaded.design}
        preview={loaded.preview}
        privacyHref={loaded.privacyHref}
      />
    </div>
  );
}
