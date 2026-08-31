import { PageHeader } from "@/components/ui";
import { SamarbetaView } from "@/components/samarbeta-view";
import { ensurePageBusiness, getSessionUser, isDemoSession } from "@/lib/auth/session";
import { LOCAL_JSON_BUSINESS_ID } from "@/lib/collaboration/actor";
import { ensureDemoAccountantShown } from "@/lib/collaboration/local-demo";
import {
  hydrateInvitationsFromTenant,
  listFormerSamarbetaPeople,
  listSamarbetaPeople,
} from "@/lib/collaboration/service";
import { tenantContext } from "@/lib/storage/context";
import { requestSlot } from "@/lib/storage/request-scope";
import { isSupabaseMode } from "@/lib/storage/config";
import { db } from "@/lib/store";
import { resolveOptionalFeatures } from "@/lib/features";
import { redirect } from "next/navigation";

export const metadata = { title: "Samarbeta" };

export default async function SamarbetaPage() {
  await ensurePageBusiness();
  const businessId = isSupabaseMode()
    ? requestSlot().businessId ?? tenantContext()?.businessId ?? LOCAL_JSON_BUSINESS_ID
    : LOCAL_JSON_BUSINESS_ID;
  if (!resolveOptionalFeatures(db(), businessId).collaboration) {
    redirect("/installningar?flik=funktioner");
  }
  const demoSession = await isDemoSession();
  // Demon speglar den lokala demons Samarbeta: Anna visas som kopplad konsult.
  if (demoSession) ensureDemoAccountantShown(businessId, db().settings.name);
  hydrateInvitationsFromTenant(businessId);
  const user = await getSessionUser();
  // Den egna sessionens spegling i registret (demo-konsultvyn) är ingen person
  // att hantera här – bara riktiga/kosmetiska samarbetspartners listas.
  const people = listSamarbetaPeople(businessId).filter((p) => !user || p.userId !== user.id);
  const formerPeople = listFormerSamarbetaPeople(businessId).filter((p) => !user || p.userId !== user.id);
  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Samarbeta"
        subtitle="Låt din redovisningskonsult hjälpa till direkt i Driva."
      />
      <SamarbetaView
        people={people}
        formerPeople={formerPeople}
        localDemo={!isSupabaseMode()}
        demoSession={demoSession}
      />
    </div>
  );
}
