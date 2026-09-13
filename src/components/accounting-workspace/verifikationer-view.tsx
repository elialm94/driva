import { Plus, ReceiptText } from "lucide-react";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { VerifikationerView } from "@/components/verifikationer-view";
import { verifikationerViewModel } from "@/lib/accounting-workspace/view-models";
import { isOwnerSurface, wsCan, wsHref, type AccountingWorkspace } from "@/lib/accounting-workspace/shared";

const PAGE_SIZE = 100;

/** Verifikationslistan – identisk på ägar- och konsultytan. */
export function WorkspaceVerifikationerView({
  ws,
  searchParams,
}: {
  ws: AccountingWorkspace;
  searchParams: { sida?: string; v?: string };
}) {
  const vm = verifikationerViewModel(searchParams, PAGE_SIZE);
  const canWrite = wsCan(ws, "write_accounting");
  const newVerification = canWrite ? (
    <ButtonLink href={wsHref(ws, "/bokforing/verifikationer/nytt")} size="sm">
      <Plus className="size-3.5" /> Nytt verifikat
    </ButtonLink>
  ) : undefined;

  return (
    <div>
      <PageHeader
        back={isOwnerSurface(ws) ? <SmartBack /> : undefined}
        title="Verifikationer"
        subtitle={`${vm.total} bokförda händelser. Varje verifikation är låst när den bokförts – rättelser blir nya verifikationer.`}
        actions={newVerification}
      />

      {vm.total === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title="Inga verifikationer ännu"
          text={
            isOwnerSurface(ws)
              ? "När du skickar fakturor eller får utgifter bokförs de automatiskt här. Något som inte kommer den vägen bokför du som ett manuellt verifikat."
              : "När händelser bokförs syns de här."
          }
          action={newVerification}
        />
      ) : (
        <VerifikationerView
          initial={vm.views}
          page={vm.page}
          totalPages={vm.totalPages}
          total={vm.total}
          initialOpenId={typeof searchParams.v === "string" ? searchParams.v : undefined}
          allowCorrection={wsCan(ws, "correct_voucher")}
        />
      )}
    </div>
  );
}
