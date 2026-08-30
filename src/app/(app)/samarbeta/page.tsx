import { PageHeader } from "@/components/ui";
import { SamarbetaView } from "@/components/samarbeta-view";
import { ensurePageBusiness } from "@/lib/auth/session";
import { LOCAL_JSON_BUSINESS_ID } from "@/lib/collaboration/actor";
import { hydrateInvitationsFromTenant, listSamarbetaPeople } from "@/lib/collaboration/service";
import { tenantContext } from "@/lib/storage/context";
import { requestSlot } from "@/lib/storage/request-scope";
import { isSupabaseMode } from "@/lib/storage/config";

export const metadata = { title: "Samarbeta" };

export default async function SamarbetaPage() {
  await ensurePageBusiness();
  const businessId = isSupabaseMode()
    ? requestSlot().businessId ?? tenantContext()?.businessId ?? LOCAL_JSON_BUSINESS_ID
    : LOCAL_JSON_BUSINESS_ID;
  hydrateInvitationsFromTenant(businessId);
  const people = listSamarbetaPeople(businessId);
  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Samarbeta"
        subtitle="Låt din redovisningskonsult hjälpa till direkt i Driva."
      />
      <SamarbetaView people={people} localDemo={!isSupabaseMode()} />
    </div>
  );
}
