import { notFound } from "next/navigation";
import { db } from "@/lib/store";
import { SiteRenderer } from "@/components/site-renderer";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const site = db().website;
  return {
    title: site ? `${site.businessName} – ${site.tagline}` : "Hemsida",
    description: site?.sections.find((s) => s.type === "hero")?.body,
  };
}

export default async function PublicSitePage(props: PageProps<"/sajt">) {
  const searchParams = await props.searchParams;
  const preview = searchParams.preview === "1";
  const data = db();
  const site = data.website;
  if (!site) notFound();
  if (site.status !== "publicerad" && !preview) notFound();

  return (
    <div className="min-h-dvh">
      {site.status !== "publicerad" && preview ? (
        <div className="sticky top-0 z-50 bg-warn px-4 py-2 text-center text-[13px] font-medium text-white">
          Förhandsvisning – sajten är inte publicerad ännu
        </div>
      ) : null}
      <SiteRenderer website={site} company={data.settings} />
    </div>
  );
}
