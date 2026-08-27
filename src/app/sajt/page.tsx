import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/lib/store";
import { SiteRenderer } from "@/components/site-renderer";
import { isMockDomainMode, resolvePublicSite } from "@/lib/domains";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/sajt">) {
  const searchParams = await props.searchParams;
  const host = await publicHost(searchParams);
  const mapped = host ? resolvePublicSite(host) : null;
  const site = mapped?.website ?? db().website;
  return {
    title: site ? `${site.businessName} – ${site.tagline}` : "Hemsida",
    description: site?.sections.find((s) => s.type === "hero")?.body,
  };
}

async function publicHost(searchParams: { host?: string | string[] }): Promise<string | null> {
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

export default async function PublicSitePage(props: PageProps<"/sajt">) {
  const searchParams = await props.searchParams;
  const preview = searchParams.preview === "1";
  const host = await publicHost(searchParams);
  const mapped = host ? resolvePublicSite(host) : null;
  const data = db();
  const site = mapped?.website ?? data.website;
  const company = mapped?.company ?? data.settings;
  if (!site) notFound();
  if (host && !mapped && !preview) notFound();
  if (site.status !== "publicerad" && !preview) notFound();

  return (
    <div className="min-h-dvh" data-public-site>
      {site.status !== "publicerad" && preview ? (
        <div className="sticky top-0 z-50 bg-warn px-4 py-2 text-center text-[13px] font-medium text-white">
          Förhandsvisning – sajten är inte publicerad ännu
        </div>
      ) : null}
      <SiteRenderer website={site} company={company} />
    </div>
  );
}
