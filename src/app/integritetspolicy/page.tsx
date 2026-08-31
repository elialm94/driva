import { notFound } from "next/navigation";
import { SitePrivacyPolicy } from "@/components/site-privacy";
import { ensureSiteTenant, loadPublicSite, publicSiteHost } from "@/lib/public-site";
import { db } from "@/lib/store";
import { resolvePublicSite } from "@/lib/domains";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/integritetspolicy">) {
  const searchParams = await props.searchParams;
  const host = await publicSiteHost(searchParams);
  if (!(await ensureSiteTenant(host))) return { title: "Integritetspolicy" };
  const mapped = host ? resolvePublicSite(host) : null;
  const site = mapped?.website ?? db().website;
  const name = mapped?.company.name ?? db().settings.name ?? site?.businessName;
  return {
    title: name ? `Integritetspolicy – ${name}` : "Integritetspolicy",
    description: name
      ? `Så här behandlar ${name} personuppgifter som du lämnar via den här hemsidan.`
      : "Integritetspolicy",
  };
}

export default async function PrivacyPolicyPage(props: PageProps<"/integritetspolicy">) {
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
      <SitePrivacyPolicy
        website={loaded.website}
        company={loaded.company}
        design={loaded.design}
        homeHref={loaded.homeHref}
      />
    </div>
  );
}
