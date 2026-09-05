import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { AccountantClientTabs, accountantStatusText } from "@/components/accountant-workspace";
import { AccountantVerifikationer } from "@/components/accountant-verifikationer";
import { ReceiptText } from "lucide-react";
import { loadAccountantClientPage } from "@/lib/collaboration/client-page";
import { can } from "@/lib/collaboration/permissions";
import { listVerificationViews } from "@/lib/services/verification-correction";
import { isSupabaseMode } from "@/lib/storage/config";
import { loadStateSnapshot } from "@/lib/storage/adapter-supabase";
import { runInTenantContext } from "@/lib/storage/context";

export const metadata = { title: "Verifikationer" };

export default async function AccountantVerifikationerPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const { access, snap } = await loadAccountantClientPage(businessId);
  const views = isSupabaseMode()
    ? await (async () => {
        const state = await loadStateSnapshot(businessId);
        return runInTenantContext(
          { businessId, userId: access.user.id, writable: false, state, baseline: state, stateVersion: 0, dirty: false },
          () => listVerificationViews()
        );
      })()
    : listVerificationViews();
  if (!access) notFound();
  const canWrite = can(access.role, "write_accounting");
  const newVerification = canWrite ? (
    <ButtonLink href={`/redovisning/k/${businessId}/verifikationer/nytt`} size="sm">
      <Plus className="size-3.5" /> Nytt verifikat
    </ButtonLink>
  ) : null;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={snap.name}
        subtitle={accountantStatusText({
          bookedThrough: snap.bookedThrough,
          bankOk: snap.bankOk,
          bankUnexplained: snap.bankUnexplained,
          nextVatDue: snap.nextVat?.dueDate,
        })}
        actions={newVerification}
      />
      <AccountantClientTabs businessId={businessId} active="verifikationer" />
      {views.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title="Inga verifikationer"
          text="När händelser bokförs syns de här."
          action={newVerification}
        />
      ) : (
        <AccountantVerifikationer
          initial={views.slice(0, 200)}
          allowCorrection={can(access.role, "correct_voucher")}
        />
      )}
    </div>
  );
}
