import { PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { ChartAccountsView } from "@/components/chart-accounts-view";
import { chartAccounts } from "@/lib/accounting/chart";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Konton" };

export default async function KontonPage() {
  await ensurePageBusiness();
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
        back={<SmartBack />}
        title="Kontoregister"
        subtitle="Företagets kontoplan. Lägg till, byt namn eller arkivera. Historiken på arkiverade konton står kvar."
      />
      <ChartAccountsView accounts={accounts} />
    </div>
  );
}
