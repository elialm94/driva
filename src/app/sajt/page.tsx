import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/lib/store";
import { SiteRenderer } from "@/components/site-renderer";
import { draftWebsiteDesign, publishedWebsiteDesign, sameDesign } from "@/lib/website-design";
import { stripWebsiteSecrets } from "@/lib/website-sections";
import { isMockDomainMode, resolvePublicSite } from "@/lib/domains";
import { ensurePageBusiness, ensurePublicPage } from "@/lib/auth/session";
import { isSupabaseMode } from "@/lib/storage/config";

export const dynamic = "force-dynamic";

/**
 * Tenantupplösning för den publika sajten: i Supabase-läge löses företaget
 * från värdnamnet (kundens domän). Utan träff (t.ex. appens egen värd vid
 * förhandsvisning) krävs inloggad session. Returnerar false = 404.
 */
async function ensureSiteTenant(host: string | null): Promise<boolean> {
  if (!isSupabaseMode()) return true;
  if (host && (await ensurePublicPage("hostname", host))) return true;
  await ensurePageBusiness(); // redirectar till /login utan session
  return true;
}

export async function generateMetadata(props: PageProps<"/sajt">) {
  const searchParams = await props.searchParams;
  const host = await publicHost(searchParams);
  if (!(await ensureSiteTenant(host))) return { title: "Hemsida" };
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
  if (!(await ensureSiteTenant(host))) notFound();
  const mapped = host ? resolvePublicSite(host) : null;
  const data = db();
  const site = mapped?.website ?? data.website;
  const company = mapped?.company ?? data.settings;
  if (!site) notFound();
  if (host && !mapped && !preview) notFound();
  if (site.status !== "publicerad" && !preview) notFound();

  // Utseendet följer utkast → publicera-modellen: den publika sajten renderas
  // alltid med det PUBLICERADE utseendet; ?preview=1 visar utkastet.
  const design = preview ? draftWebsiteDesign(site) : publishedWebsiteDesign(site);
  const draftDesignPending =
    preview && site.status === "publicerad" && !sameDesign(design, publishedWebsiteDesign(site));

  return (
    <div className="min-h-dvh" data-public-site>
      {site.status !== "publicerad" && preview ? (
        <div className="sticky top-0 z-50 bg-warn px-4 py-2 text-center text-[13px] font-medium text-white">
          Förhandsvisning – sajten är inte publicerad ännu
        </div>
      ) : draftDesignPending ? (
        <div className="sticky top-0 z-50 bg-warn px-4 py-2 text-center text-[13px] font-medium text-white">
          Förhandsvisning av nytt utseende – publicera ändringar för att uppdatera sajten
        </div>
      ) : null}
      <SiteRenderer website={stripWebsiteSecrets(site)} company={company} design={design} />
    </div>
  );
}
