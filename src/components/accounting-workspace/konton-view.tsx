import { PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { ChartAccountsView } from "@/components/chart-accounts-view";
import { chartAccounts } from "@/lib/accounting/chart";
import { isOwnerSurface, wsReadOnly, type AccountingWorkspace } from "@/lib/accounting-workspace/shared";

export function KontonView({ ws }: { ws: AccountingWorkspace }) {
  const accounts = chartAccounts({ includeArchived: true }).map((a) => ({
    number: a.number,
    name: a.name,
    section: a.section,
    custom: a.custom,
    archived: a.archived,
  }));
  return (
    <div>
      <PageHeader
        back={isOwnerSurface(ws) ? <SmartBack /> : undefined}
        title="Kontoregister"
        subtitle="Företagets kontoplan. Lägg till, byt namn eller arkivera. Historiken på arkiverade konton står kvar."
      />
      <ChartAccountsView accounts={accounts} readOnly={wsReadOnly(ws, "write_accounting")} />
    </div>
  );
}
