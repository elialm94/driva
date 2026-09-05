import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { ManualVerificationForm } from "@/components/manual-verification-form";
import { loadAccountantClientPage } from "@/lib/collaboration/client-page";
import { can } from "@/lib/collaboration/permissions";
import { accountPickerOptions } from "@/lib/services/manual-verification";
import { lockedThrough } from "@/lib/accounting/fiscal";
import { nextDay, todayDate } from "@/lib/accounting/dates";
import { isSupabaseMode } from "@/lib/storage/config";
import { loadStateSnapshot } from "@/lib/storage/adapter-supabase";
import { runInTenantContext } from "@/lib/storage/context";

export const metadata = { title: "Nytt verifikat" };

/** Kontoregistret och periodlåset är klientens, inte byråns – därför i klientens kontext. */
async function clientChart(businessId: string, userId: string) {
  const read = () => ({ accounts: accountPickerOptions(), lock: lockedThrough(), today: todayDate() });
  if (!isSupabaseMode()) return read();
  const state = await loadStateSnapshot(businessId);
  return runInTenantContext(
    { businessId, userId, writable: false, state, baseline: state, stateVersion: 0, dirty: false },
    read
  );
}

export default async function AccountantNyttVerifikatPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const { access, snap } = await loadAccountantClientPage(businessId);
  if (!can(access.role, "write_accounting")) notFound();
  const { accounts, lock, today } = await clientChart(businessId, access.user.id);
  const firstOpen = lock ? nextDay(lock) : undefined;

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<SmartBack />}
        title="Nytt verifikat"
        subtitle={`Bokförs i ${snap.name}. Verifikatet får serie M och låses när det bokförts – rättelser blir nya verifikationer.`}
      />
      <ManualVerificationForm
        accounts={accounts}
        today={firstOpen && firstOpen > today ? firstOpen : today}
        lockedThrough={lock}
        firstOpenDate={firstOpen}
        businessId={businessId}
        backHref={`/redovisning/k/${businessId}/verifikationer`}
      />
    </div>
  );
}
