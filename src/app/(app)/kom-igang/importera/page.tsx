import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";
import { ImportCenter } from "@/components/imports/import-center";
import { PageHeader } from "@/components/ui";
import { ensurePageBusiness } from "@/lib/auth/session";
import { SETTINGS_HREF } from "@/lib/settings-routes";
import { db } from "@/lib/store";

export const metadata: Metadata = { title: "Flytta dina uppgifter till Ferva" };
export const dynamic = "force-dynamic";

/**
 * Gemensam importsida (bokföring, kunder, leverantörer, artiklar/priser).
 * Kräver inte att användaren väljer gammalt system – filerna identifieras
 * på innehållet och visas som kort med förhandsgranskning före import.
 */
export default async function ImportPage() {
  await ensurePageBusiness();
  const imported = (db().dataImports ?? []).filter((i) => i.status === "imported").length;
  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<BackLink fallbackHref={SETTINGS_HREF.komIgang} fallbackLabel="Kom igång" />}
        title="Flytta dina uppgifter till Ferva"
        subtitle="Ladda upp det du har. Ferva hjälper dig att förstå filerna innan något sparas."
      />
      <ImportCenter importedCount={imported} />
    </div>
  );
}
